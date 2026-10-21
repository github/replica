// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/* eslint-disable no-restricted-syntax */
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';

import type { Route } from './+types/root';
import './styles/globals.css';
import './styles/fonts.css';
import { AppContent } from './components/shell/AppContent';
import { QueryProvider } from './core/datafetching/QueryProvider';

if (import.meta.env.DEV && typeof window !== 'undefined') {
  import('./dev/reactGrab').catch((error: unknown) => {
    console.error('Failed to configure React Grab:', error);
  });
}

/**
 * Derive a page title from VITE_BASE.
 * e.g. "/jabradford-variants-router-examples/" → "CoreAI Sandbox Prototype | jabradford variants router examples"
 * Falls back to "CoreAI Sandbox" for local dev (base = "/").
 */
function getProtoTitle(): string {
  const base = import.meta.env.BASE_URL;
  const folder = base.replace(/^\/|\/$/g, '');
  if (!folder) return 'CoreAI Sandbox';
  // folder is like "jabradford-variants-router-examples"
  // First segment before hyphen is username, rest is branch name
  const parts = folder.split('-');
  const readable = parts.join(' ');
  return `CoreAI Sandbox Prototype | ${readable}`;
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{getProtoTitle()}</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <AppContent>
        <Outlet />
      </AppContent>
    </QueryProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!';
  let details = 'An unexpected error occurred.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error';
    details =
      error.status === 404 ? 'The requested page could not be found.' : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
