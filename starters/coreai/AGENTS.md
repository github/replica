# CoreAI Prototype — AI Coding Assistant Instructions

Read the [shared Replica instructions](REPLICA-AGENTS.md) before prototype work. They own task scope, component preflight, canvas setup, publishing and browser validation. This file and the CoreAI skills own app-specific conventions.

The CoreAI Prototype is a React Router single-page app for exploring agent and design-system experiences with local mock data.

## Project context

- React 18, React Router v7 framework mode, Vite, and TypeScript
- Client-side rendering only (`ssr: false`)
- `~/` resolves to `app/`
- CSS Modules for component and page styles
- TanStack Query over mock JSON in `app/data/`
- URL-driven prototype features and design variants
- Optional browser-to-Azure OpenAI requests configured by the user

## Run and validate

Run commands from this app's directory:

```sh
npm ci
npm run dev
```

The app runs at <http://127.0.0.1:5174>.

```sh
npm run type-check
npm run lint
npm test
npm run build
npm run preview
```

Vitest runs hook tests in jsdom with React Testing Library. Keep the hook real and mock settings and the client network boundary; tests must not contact Azure or use real credentials. Run a focused file with `npm test -- app/hooks/useChat.test.ts`. Verify visual changes in a browser.

## Skill index

Detailed working conventions live in `.agents/skills/`. Load the matching skill before
making a change. Treat the skill as the source of truth instead of duplicating its
instructions here.

| Task or area                                           | Skill                      |
| ------------------------------------------------------ | -------------------------- |
| Start or open the app                                  | `start-app`                |
| Format, lint, or type-check                            | `lint`                     |
| Choose CoreAI components, APIs, templates, or patterns | `coreai-ds-fluentui-react` |
| Edit TSX or component imports                          | `react-components`         |
| Edit CSS Modules or debug style precedence             | `css-styling`              |
| Add or change icons                                    | `icons`                    |
| Add routes or change navigation                        | `routing`                  |
| Change query hooks, mock data, or data state           | `state-management`         |
| Configure or consume features and variants             | `features-variants`        |
| Create a new design alternative                        | `new-variant`              |
| Interpret rendered HTML or generated class names       | `interpreting-html`        |

When more than one row applies, load each relevant skill. In particular, component work
often requires both `coreai-ds-fluentui-react` and `react-components`, plus a styling,
icon, routing, state, or variant skill when applicable.

For design-system reference, follow the `coreai-ds-fluentui-react` skill from the [CoreAI documentation index](https://microsoft.github.io/coreai-design-system/index.md).

## Baseline boundaries

- Import product-facing components from `@coreai-ds/react-components`.
- Import app-owned adapters from `~/components/common`.
- Import Fluent icons from `@fluentui/react-icons`.
- Do not import components directly from `@fluentui/react-components`.
- Keep component styles in colocated `*.module.css` files.
- Register routes in `app/routes.ts`.
- Put mock records in `app/data/`.
- Register prototype options in `app/features.json`; do not build a second feature
  system.
- Keep copyright and MIT license headers on source files.
- Do not commit generated `build/`, `dist/`, or `.react-router/` output.

## Data and credentials

The prototype must work without Azure OpenAI. Do not commit credentials, endpoints, real
customer data, prompts, or responses.
