# CoreAI Sandbox repository

This context describes the included example. Follow [app instructions](../../AGENTS.md), [shared Replica instructions](../../REPLICA-AGENTS.md) and the applicable local skills. It does not define a consuming team's product policy.

## Where UI lives

React Router registers routes in `app/routes.ts`; route modules live in `app/routes/`. The shell lives in `app/components/shell/`, app-owned component adapters in `app/components/common/`, and mock data in `app/data/`. `~/` resolves to `app/`.

## Commands

Use the declared Node.js runtime in [package.json](../../package.json). Run `npm ci`, then `npm run dev`. Use the printed URL and verify the intended app before reusing a server.

Run `npm run type-check`, `npm run lint`, `npm test` and `npm run build` for affected code. `npm run preview` serves `dist`. Chat tests cover the local reply cycle and cancellation. See [the app guide](../../README.md#validate-changes).

## Constraints

Keep React Router, CSS Modules, mock-data ownership and the feature system described in app instructions. Do not copy another starter's router or scaffolder. Builds must produce `dist/index.html`; static hosts must serve `index.html` as the fallback for application routes.

Keep credentials and real customer data out of source. Chat uses local canned replies only, without API-key settings or model requests.
