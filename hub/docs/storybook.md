# Storybook

Storybook is the workbench for retained Hub and prototype canvas presentation. It runs independently of the API and does not restore removed product workflows.

From `hub/`, run `npm run storybook` and open <http://localhost:6006>. Build the static catalogue with `npm run storybook:build`.

## Interface layers

Stories follow `Pages -> Features -> Components`. Components are reusable interface elements, Features compose one responsibility, and Pages accept typed presentation data. Keep application requests, access checks, persistence, and external services out of stories.

Preserve the catalogue groups: `Components/Name`, `Prototype canvas/Name`, `Hub/Design/Name`, `Hub/Pages/Name`, and `Hub/Features/Name`. These organize the workbench without changing the production import direction.

Keep `stories.tsx` beside its implementation. Catalogue-only inventories live under `app/storybook/`. Use local state and isolated TypeScript fixtures from that directory; production code must not depend on story fixtures. The canonical synthetic personas remain `octocat`, `mona`, `github/prototype`, and `github/empty`.

Collection surfaces normally need Empty, Single, and Multiple stories. Add cases only for distinct product states such as loading, failure, permissions, draft protection, or recovery. Use the existing theme and viewport controls instead of duplicating light, dark, or narrow stories.

The top-level decorator uses `HubThemeProvider` so portals inherit Brand and Hub theme tokens. Retained pages are presentation examples, not evidence that their old links or server actions are implemented.

## Component usage

The **Used in** panel analyzes production TypeScript JSX consumers under `app/` and follows them to pages and application surfaces. Counts represent source locations, not runtime instances. It excludes stories, fixtures, test support, and tests. Missing metadata and unused components have distinct empty states.

The Storybook-only Vite plugin updates the report without reloading the preview. The production app does not load the analyzer or usage panel. GitHub source links target `main` and may differ from this rebuild branch.

## Template fixtures

Retain the authored HTML and PNG fixtures under `.storybook/preview-fixtures/templates/`. Their TypeScript and CSS sources now live in `.storybook/template-sources/`; they are not backend seed data. The Default fixture uses the starter's home page.

Regeneration uses `node script/build-template-story-fixtures.mjs` and requires the build action's installed Playwright dependency and `/usr/bin/chromium`. Follow the root browser workflow for interactive inspection; the existing reproducible fixture generator keeps its configured driver.

## UI changes and pull request evidence

Hub and canvas UI changes are complete only when their Storybook coverage and PR screenshots match the final change, including changes through shared styles, copy, or fixtures.

1. Compare the PR with its base and identify every affected presentation surface, including indirectly changed stories.
2. Update or add colocated stories for meaningful new states. Reuse production presentation and isolated fixtures rather than implementing a second application.
3. Remove stories for deleted or replaced UI, unreachable states, and duplicates with equivalent props and interactions. Remove orphaned story-only fixtures, but preserve distinct supported fallback and permission states.
4. Render every added or changed story from the final code, reach its intended state, and inspect the result before capturing it. Follow the root browser workflow. An unintended blank, loading, or error screen is a blocker, not evidence.
5. Use the `github-pr-media` skill to upload screenshots as GitHub attachments and embed every affected story in a final `## Storybook screenshots` PR section. Label each image with its full story title/name, theme, and viewport. Use collapsible groups for large sets rather than representative samples.
6. Refresh screenshots after UI revisions and reconcile coverage, removed stories, and image captions before requesting review. Name every missing story and its rendering or upload blocker; incomplete evidence remains incomplete.

Deleted stories need no after screenshot; explain removed UI in the PR. Omit the screenshot section when no story presentation changes. A successful Storybook build does not prove state coverage or screenshot completeness.
