---
name: react-components
description: 'CoreAI Sandbox component usage: import boundaries, CoreAI MCP documentation, and local adapter inspection. USE WHEN: editing any `*.tsx` file, picking a component, or writing component imports.'
---

# CoreAI Sandbox Component Usage

## Import Boundary

Import CoreAI components, styling APIs, and tokens directly from
`@coreai-ds/react-components`.

```tsx
import { Button, Dropdown, Spinner } from '@coreai-ds/react-components';
```

Import CoreAI-Sandbox-owned components and adapters from `~/components/common`.

```tsx
import { Card, ExternalLink, Image, Link, TabLinkList } from '~/components/common';
```

The app barrel exports only repository-owned behavior. It does not re-export CoreAI. Never import
components from `@fluentui/react-components` directly. Direct imports from
`@fluentui/react-icons` remain supported.

Use the local `Link` for React Router navigation, `ExternalLink` for external URLs, `Card` for all
cards, and `Image` for theme-aware and deployment-safe image sources. ESLint restricts direct
`Link`, `Card`, and `Image` imports from `@coreai-ds/react-components`; only the local adapter
implementations may import those underlying CoreAI components.

## Skill Boundary

- This skill owns CoreAI Sandbox's repository boundary: decide whether the need is satisfied by
  CoreAI or by an existing app-owned adapter, composition, hook, theme utility, or asset.
- `coreai-ds-fluentui-react` owns the external package API and its mandatory CoreAI-first MCP
  workflow. Invoke it for every CoreAI component or prop decision instead of restating its catalog
  here.
- Local source under `app/components/common/**` is authoritative only for CoreAI-Sandbox-owned behavior;
  it is not a substitute for CoreAI documentation.

## Choose and Verify Components

1. Invoke the `coreai-ds-fluentui-react` skill and successfully call the CoreAI MCP
   before selecting, changing, or reviewing a component or its props. Do not infer APIs
   from stock Fluent behavior.
2. If the CoreAI MCP tools are missing or a call fails, stop CoreAI-dependent work. Tell
   the user the MCP is required, ask them to start or reconnect `coreai-ds-docs-localhost`, help
   them troubleshoot it, and retry the call after they respond. Do not silently substitute
   package source, prior knowledge, or Fluent component documentation.
3. Check `app/components/common/index.ts` for an existing CoreAI-Sandbox-owned export only when the
   requested behavior is product-specific or integrates an app concern such as React Router.
4. When a local export exists, read its source under `app/components/common/**` before using it.
   The CoreAI MCP cannot document CoreAI-Sandbox-owned behavior.
5. Prefer an existing documented component or template over recreating the same
   interaction with custom markup and CSS.

Do not maintain a static component catalog in this skill. CoreAI's MCP is the
source of truth for CoreAI components, and the app barrel and local source are the
source of truth for repository-owned exports.

## Semantics

Use links for navigation and buttons for actions. Do not make a `Button` navigate
or use a link to perform an action. Use `Link` for app routes and `ExternalLink` for URLs outside
the app.

## Related skills

- `css-styling` — required when writing styles for the component
- `icons` — for icon selection and bundling
- `coreai-ds-fluentui-react` — required for CoreAI component documentation and API decisions
