// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  Agents20Filled,
  Agents20Regular,
  WrenchScrewdriver20Filled,
  WrenchScrewdriver20Regular,
  Book20Filled,
  Book20Regular,
  ChartMultiple20Filled,
  ChartMultiple20Regular,
  type FluentIcon,
} from '@fluentui/react-icons';
import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  layout('components/shell/NavLayout.tsx', [
    index('routes/home.tsx'),

    route('discover', 'routes/discover/route.tsx', [
      route('tools', 'routes/discover/tools.tsx'),
      route('tools/:tool', 'routes/discover/tool.tsx'),
      route('models', 'routes/discover/models.tsx'),
      route('models/:model', 'routes/discover/model.tsx'),
    ]),

    route('build', 'routes/build/route.tsx', [
      route('agents', 'routes/build/agents.tsx', [
        index('routes/build/agents/all.tsx'),
        route('drafts', 'routes/build/agents/drafts.tsx'),
        route('published', 'routes/build/agents/published.tsx'),
      ]),
      route('agents/:agent', 'routes/build/agent/route.tsx', [
        route('playground', 'routes/build/agent/playground.tsx'),
        route('traces', 'routes/build/agent/traces.tsx'),
        route('monitor', 'routes/build/agent/monitor.tsx'),
        route('evaluation', 'routes/build/agent/evaluation.tsx'),
      ]),
      route('tools', 'routes/build/tools.tsx'),
    ]),

    route('operate', 'routes/operate/route.tsx', [
      route('dashboard', 'routes/operate/dashboard.tsx'),
      route('agents', 'routes/operate/agents.tsx'),
    ]),

    route('docs', 'routes/docs.tsx'),
  ]),
] satisfies RouteConfig;

export const topNavRoutes = [
  { content: 'Home', path: '/' },
  { content: 'Discover', path: '/discover' },
  { content: 'Build', path: '/build' },
  { content: 'Operate', path: '/operate' },
  { content: 'Docs', path: '/docs' },
];

export function getLeftNavRoutes(pathname: string): LeftNavRoute[] {
  // Determine which section we're in
  if (pathname.startsWith('/discover')) {
    return discoverRoutes;
  } else if (pathname.startsWith('/build')) {
    return buildRoutes;
  } else if (pathname.startsWith('/operate')) {
    return operateRoutes;
  } else if (pathname.startsWith('/docs')) {
    return docsRoutes;
  }
  // Home or other routes - no left nav
  return [];
}

export interface LeftNavRoute {
  path: string;
  content: string;
  sectionTitle?: string;
  placement?: 'bottom';
  icon: {
    regular: FluentIcon;
    selected: FluentIcon;
  };
}

// Get left nav routes based on current path section
const discoverRoutes: LeftNavRoute[] = [
  {
    path: '/discover/tools',
    content: 'Tools',
    icon: {
      regular: WrenchScrewdriver20Regular,
      selected: WrenchScrewdriver20Filled,
    },
  },
  {
    path: '/discover/models',
    content: 'Models',
    icon: {
      regular: ChartMultiple20Regular,
      selected: ChartMultiple20Filled,
    },
  },
];

const buildRoutes: LeftNavRoute[] = [
  {
    path: '/build/agents',
    content: 'Agents',
    icon: {
      regular: Agents20Regular,
      selected: Agents20Filled,
    },
  },
  {
    path: '/build/tools',
    content: 'Tools',
    icon: {
      regular: WrenchScrewdriver20Regular,
      selected: WrenchScrewdriver20Filled,
    },
  },
];

const operateRoutes: LeftNavRoute[] = [
  {
    path: '/operate/dashboard',
    content: 'Dashboard',
    icon: {
      regular: ChartMultiple20Regular,
      selected: ChartMultiple20Filled,
    },
  },
  {
    path: '/operate/agents',
    content: 'Agents',
    icon: {
      regular: Agents20Regular,
      selected: Agents20Filled,
    },
  },
];

const docsRoutes: LeftNavRoute[] = [
  {
    path: '/docs',
    content: 'Getting Started',
    icon: {
      regular: Book20Regular,
      selected: Book20Filled,
    },
  },
];
