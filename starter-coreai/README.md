# CoreAI Prototype

A React Router single-page app for prototyping experiences with
`@coreai-ds/react-components`. It uses local mock data by default and does not require
authentication or private package access.

## Run locally

From the repository root:

```sh
npm install
npm run prototype
```

Open <http://127.0.0.1:5174>.

## Validate changes

From the repository root:

```sh
npm --workspace apps/prototype run type-check
npm --workspace apps/prototype run lint
npm run build:prototype
npm --workspace apps/prototype run preview
```

The production build is written to `build/client`. A production host must serve
`index.html` as the fallback for application routes.

This package does not have automated tests. Validate changes with the commands above
and manual browser checks.

## Features and variants

Use [app/features.json](app/features.json) to register prototype features and design
variants. The file starts with an empty feature list.

Each feature has a unique `id`, a `label`, and one or more matching `routes`. A feature
can also define `variants`, a `defaultRoute`, and route parameters. Components read the
active selection with `useFeature`:

```tsx
import { useFeature } from '~/features/FeatureContext';

const variant = useFeature('agent-layout');
```

Selections are stored in the URL as `variant` query parameters so a specific design can
be shared and revisited. See the prototype feature skills in
[.github/skills](.github/skills) for the full schema and workflow.

## Optional Azure OpenAI connection

The prototype works without Azure OpenAI. A user can optionally enter an Azure OpenAI
endpoint, deployment name, and API key to enable chat-related interactions.

These values are stored unencrypted in the browser's local storage. When the user tests
the connection or uses an enabled interaction, the browser sends the request directly
to the Azure OpenAI endpoint that the user configured. The app does not send these
values or requests to a repository-owned intermediary service.

Use only development credentials with the minimum required access. Clear the saved
settings from the Azure OpenAI settings dialog when they are no longer needed. **Do not enable this browser-based credential flow for a production deployment without replacing it with an approved authentication and server-side request design.**

## Development tools

React Grab is available only in development builds. Hover over an element and press
**Ctrl+C** on Windows or **Cmd+C** on macOS to copy component and source context for a
coding assistant. It does not load in production builds or connect to an external
service.

The app uses CSS Modules and an app-owned Griffel renderer. Follow the scoped guidance
in [AGENTS.md](AGENTS.md) and [.github/skills](.github/skills) when changing components,
styles, routing, state, icons, or variants.

## Portability

The package is isolated under `apps/prototype`, but it currently consumes the design
system from this monorepo. To move it to another repository:

1. Copy this directory.
2. Replace the `@coreai-ds/react-components` workspace dependency with a published or
   otherwise approved package version.
3. Remove the local `@coreai-ds/react-components` alias from `vite.config.ts`.
4. Provide an equivalent ESLint configuration or replace the root configuration import.
5. Install dependencies and run the validation commands in the new repository.

Hosted fonts are optional. The app falls back to system fonts when they are unavailable,
and no font binaries are included in this package.
