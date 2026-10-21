# CoreAI Prototype — AI Coding Assistant Instructions

The CoreAI Prototype is a React Router single-page app for exploring agent and design
system experiences. It uses local mock data by default and consumes
`@coreai-ds/react-components` from this monorepo.

## Project context

- React 18, React Router v7 framework mode, Vite, and TypeScript
- Client-side rendering only (`ssr: false`)
- `~/` resolves to `app/`
- CSS Modules for component and page styles
- TanStack Query over mock JSON in `app/data/`
- URL-driven prototype features and design variants
- Optional browser-to-Azure OpenAI requests configured by the user

## Run and validate

From the repository root:

```sh
npm install
npm run prototype
```

The app runs at <http://127.0.0.1:5174>.

```sh
npm --workspace apps/prototype run type-check
npm --workspace apps/prototype run lint
npm run build:prototype
npm --workspace apps/prototype run preview
```

The package has no automated tests. Run the relevant checks and verify changed behavior
in a browser.

## Skill index

Detailed working conventions live in `.github/skills/`. Load the matching skill before
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
- Keep prototype-specific code inside `apps/prototype`.
- Keep copyright and MIT license headers on source files.
- Do not commit generated `build/` or `.react-router/` output.

The lint configuration enforces many of these boundaries. Follow the applicable skill
instead of working around a rule.

## Data and credentials

The prototype must work without Azure OpenAI. Do not commit credentials, endpoints, real
customer data, prompts, or responses.

## Portability

This package currently relies on monorepo TypeScript, Vite, ESLint, and workspace
dependency configuration. Keep those dependencies explicit and contained so the package
can be moved by replacing the local links. See `README.md` for the portability steps.
