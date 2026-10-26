# CoreAI Prototype

A React Router single-page app for prototyping experiences with `@coreai-ds/react-components`.

The profile displays a sample identity. Theme settings are available from its menu.

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
npm test
npm run build
npm run preview
```

The preview command builds the app before serving it from `dist`. A production host must serve
`index.html` as the fallback for application routes.

Vitest runs automated hook tests in jsdom with React Testing Library. Chat tests exercise the local reply cycle and cancellation with simulated timers. Run only chat tests with `npm test -- app/hooks/useChat.test.ts`. `npm run check:starter` runs type checks, lint, tests and the build. Use manual browser checks for visual changes.

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

## Simulated chat

Chat cycles through three generic replies from `app/data/chat-replies.json`, with a short simulated loading state. Replies do not depend on the message, selected model, or instructions. The app makes no model requests and has no API-key settings or live-model integration.

Starting a new chat clears the conversation, cancels any pending reply, and restarts the reply cycle. Leaving the chat cancels its pending reply.

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
