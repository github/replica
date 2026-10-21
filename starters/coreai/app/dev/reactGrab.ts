// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  getDisplayName,
  getFiberFromHostInstance,
  isCompositeFiber,
  isInstrumentationActive,
  type Fiber,
} from 'bippy';
import { getSource, normalizeFileName, type FiberSource } from 'bippy/source';
import { registerPlugin, unregisterPlugin, type Plugin } from 'react-grab';

const FRAMEWORK_COMPONENTS = new Set([
  'RouterProvider',
  'HydratedRouter',
  'Router',
  'DataRoutes',
  'RenderedRoute',
  'Outlet',
  'ScrollRestoration',
  'Scripts',
]);
const NOISY_PROPS = new Set(['children', 'params', 'loaderData', 'matches', 'ref', 'className']);
const CSS_MODULE_CLASS = /^_([a-zA-Z][a-zA-Z0-9]*)_[a-z0-9]+(?:_\d+)?$/;
const GRIFFEL_CLASS = /^[fr][a-z0-9]{5,7}$/;

interface ComponentContext {
  name: string;
  fiber: Fiber;
  source: FiberSource | null;
}

function includeComponent(name: string): boolean {
  const unnumbered = name.replace(/\d+$/, '');
  return (
    !name.startsWith('_') &&
    !name.startsWith('Anonymous') &&
    !name.startsWith('WithComponentProps') &&
    !['Provider', 'Context', 'Consumer', 'ErrorBoundary', 'Trigger'].some((suffix) =>
      unnumbered.endsWith(suffix),
    ) &&
    !FRAMEWORK_COMPONENTS.has(unnumbered)
  );
}

function sourcePath(source: FiberSource): string {
  const path = normalizeFileName(source.fileName).replace(/\\/g, '/');
  const workspacePath = /(?:^|\/)((?:apps\/prototype|packages\/react-components)\/.*)$/.exec(path);
  return workspacePath?.[1] ?? path;
}

function isProjectComponent(
  component: ComponentContext,
): component is ComponentContext & { source: FiberSource } {
  if (!component.source?.fileName) return false;
  const path = sourcePath(component.source);
  return !path.includes('node_modules') && !path.includes('chunk-') && !path.startsWith('../../');
}

function describeElement(element: Element): string {
  const classes = Array.from(element.classList)
    .filter(
      (name) => !name.startsWith('fui-') && !name.startsWith('___') && !GRIFFEL_CLASS.test(name),
    )
    .map((name) => CSS_MODULE_CLASS.exec(name)?.[1] ?? name);
  const parts = [element.tagName.toLowerCase() + (classes.length ? `.${classes.join('.')}` : '')];
  if (element.children.length) {
    parts.push(`${element.children.length} child${element.children.length === 1 ? '' : 'ren'}`);
  }
  const text = (element instanceof HTMLElement ? element.innerText : element.textContent)
    ?.replace(/\s+/g, ' ')
    .trim();
  if (text) parts.push(JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text));
  return parts.join(', ');
}

function describeProps(fiber: Fiber): string | null {
  const props: unknown = fiber.memoizedProps;
  if (!props || typeof props !== 'object') return null;
  const entries = Object.entries(props)
    .filter(
      ([key, value]) =>
        !NOISY_PROPS.has(key) &&
        value !== '' &&
        ['string', 'number', 'boolean'].includes(typeof value),
    )
    .map(([key, value]) => {
      const display =
        typeof value === 'string' && value.length > 100 ? `${value.slice(0, 100)}...` : value;
      return `${key}: ${JSON.stringify(display)}`;
    });
  return entries.length ? `props: { ${entries.join(', ')} }` : null;
}

async function elementContext(element: Element): Promise<string | null> {
  let host: Fiber | null = null;
  for (let current: Element | null = element; current && !host; current = current.parentElement) {
    host = getFiberFromHostInstance(current);
  }
  if (!host) return null;

  const ancestors: { name: string; fiber: Fiber }[] = [];
  for (let fiber: Fiber | null = host; fiber && ancestors.length < 25; fiber = fiber.return) {
    if (!isCompositeFiber(fiber)) continue;
    const name = getDisplayName(fiber.type);
    if (name && includeComponent(name)) ancestors.push({ name, fiber });
  }
  const resolved = await Promise.all(
    ancestors.map(async (component) => {
      const source = await getSource(component.fiber, true).catch((error: unknown) => {
        console.warn(`[React Grab] Could not resolve source for ${component.name}:`, error);
        return null;
      });
      return { ...component, source };
    }),
  );
  // Keep the outer call site when Fluent and router wrappers share a component name.
  const tree = resolved
    .filter(isProjectComponent)
    .filter((component, index, components) => components[index + 1]?.name !== component.name);
  const nearest = tree[0];
  if (!nearest) return null;

  const intermediate = resolved
    .slice(0, resolved.indexOf(nearest))
    .find((component) => !isProjectComponent(component));
  const names = [nearest.name];
  if (intermediate && intermediate.name !== nearest.name) names.push(intermediate.name);
  const lines = [`${names.join(' > ')} > ${describeElement(element)}`];
  const props = describeProps(nearest.fiber);
  if (props) lines.push(props);
  for (const component of tree) {
    const source = component.source;
    const location =
      sourcePath(source) +
      (source.lineNumber ? `:${source.lineNumber}` : '') +
      (source.lineNumber && source.columnNumber ? `:${source.columnNumber}` : '');
    lines.push(`in ${component.name} (${location})`);
  }
  return lines.join('\n');
}

export async function transformCopyContent(content: string, elements: Element[]): Promise<string> {
  if (!isInstrumentationActive() || !elements.length) {
    console.warn('[React Grab] Component inspection is unavailable; keeping the original context.');
    return content;
  }
  const contexts = await Promise.all(elements.map(elementContext));
  if (contexts.some((context) => !context)) {
    console.warn(
      '[React Grab] Project source was not resolved for every selection; keeping the original context.',
    );
    return content;
  }
  return contexts.join('\n\n---\n\n');
}

const plugin: Plugin = {
  name: 'coreai-copy-context',
  hooks: { transformCopyContent },
};

registerPlugin(plugin);
import.meta.hot?.dispose(() => unregisterPlugin(plugin.name));
