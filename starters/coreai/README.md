# CoreAI Prototype

A React Router single-page app for prototyping experiences with `@coreai-ds/react-components`.

The profile displays a sample identity. Theme and Azure OpenAI settings are available from its menu.

Choose `--starter coreai` when creating a repository with Replica. See [prototype repository setup](https://github.com/github/replica/blob/main/docs/prototype-repository-setup.md) for installation. The copied app includes [Replica setup and workflows](REPLICA.md) for canvas activation, Controls, optional product guidance and publishing.

## Run locally

Run commands from this app's directory:

```sh
npm ci
npm run dev
```

Use a Node.js version matching `engines.node` in [package.json](package.json). In Copilot, complete the [canvas preflight](REPLICA.md#canvas-preflight) before starting a preview. Open the URL printed by the server; the default port is `5174`.

## Validate changes

From this app's directory:

```sh
npm run type-check
npm run lint
npm run build
npm run preview
```

The preview command builds the app before serving it from `dist`. A production host must serve
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
[.agents/skills](.agents/skills) for the full schema and workflow.

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
in [AGENTS.md](AGENTS.md) and [.agents/skills](.agents/skills) when changing components,
styles, routing, state, icons, or variants.

## Design-system documentation

Use the [CoreAI documentation index](https://microsoft.github.io/coreai-design-system/index.md) for component guidance, APIs, patterns, and example source. Agents follow the [documentation skill](.agents/skills/coreai-ds-fluentui-react/SKILL.md) to discover current links and compare documented APIs with the installed package.

Hosted fonts are optional. The app falls back to system fonts when they are unavailable.
