# Storybook

Storybook is the workbench for retained Hub and prototype canvas presentation. It runs independently of the API and does not restore removed product workflows.

From `hub/`, run `npm run storybook` and open <http://localhost:6006>. Build the static catalogue with `npm run storybook:build`.

## Interface layers

Stories follow `Pages -> Features -> Components`. Components are reusable interface elements, Features compose one responsibility, and Pages accept typed presentation data. Keep application requests, access checks, persistence, and external services out of stories.

Preserve the catalogue groups: `Components/Name`, `Prototype canvas/Name`, `Hub/Design/Name`, `Hub/Pages/Name`, and `Hub/Features/Name`. These organize the workbench without changing the production import direction.

Keep `stories.tsx` beside its implementation. Catalogue-only inventories live under `client/storybook/`. Use local state and isolated TypeScript fixtures from that directory; production code must not depend on story fixtures. The canonical synthetic personas remain `octocat`, `mona`, `github/prototype`, and `github/empty`.

For Hub pages, use a story's own state and callbacks to exercise actions such as paging, editing, and retrying. When a story uses a native form only to show a confirmation or other form state, prevent it from submitting to the Storybook host. Do not start a second API, replace global `fetch`, or share saved state across stories. Request and integration tests verify routing, authorization, and persistence.

Collection surfaces normally need Empty, Single, and Multiple stories. Add cases only for distinct product states such as loading, failure, permissions, draft protection, or recovery. Use the existing theme and viewport controls instead of duplicating light, dark, or narrow stories.

The top-level decorator uses `HubThemeProvider` so portals inherit Brand and Hub theme tokens. Retained pages are presentation examples, not evidence that their old links or server actions are implemented.

## Route-to-story map

Start Storybook before opening these links. Each row points to an example of a distinct app screen. Look in the same story group for other states. Redirects and action-only URLs do not need stories.

| App route                                                                      | Storybook example                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, signed out                                                                | [Sign-in](http://localhost:6006/?path=/story/hub-pages-home--default)                                                                                                           |
| `/`, `/repositories`, no readable repository                                   | [Empty workspace](http://localhost:6006/?path=/story/hub-pages-repositories--real-empty-workspace)                                                                              |
| `/signed-in/no-access`                                                         | [Account recovery](http://localhost:6006/?path=/story/hub-pages-security-no-repository-access--signed-in-account)                                                               |
| `/welcome`                                                                     | [Introduction](http://localhost:6006/?path=/story/hub-pages-welcome--introduction)                                                                                              |
| `/repositories/:repositoryId`                                                  | [Gallery](http://localhost:6006/?path=/story/hub-pages-repositories-show--real-index)                                                                                           |
| `/repositories/:repositoryId/new`                                              | [Create](http://localhost:6006/?path=/story/hub-pages-repositories-create--multiple)                                                                                            |
| `/repositories/:repositoryId/templates/:templateId`                            | [Template preview](http://localhost:6006/?path=/story/hub-pages-replica-browse--template)                                                                                       |
| `/repositories/:repositoryId/prototypes/manage`                                | [Edit prototype listings](http://localhost:6006/?path=/story/hub-pages-prototypes-manage--multiple)                                                                             |
| `/repositories/:repositoryId/prototypes/:prototypeId`                          | [Review conversation](http://localhost:6006/?path=/story/hub-pages-prototype-review--conversation)                                                                              |
| `/repositories/:repositoryId/prototypes/:prototypeId/builds`                   | [Build history](http://localhost:6006/?path=/story/hub-pages-builds-index--real-history)                                                                                        |
| `/repositories/:repositoryId/prototypes/:prototypeId/share-links`              | [Share links](http://localhost:6006/?path=/story/hub-pages-share-links--multiple)                                                                                               |
| `/repositories/:repositoryId/analytics`                                        | [Analytics](http://localhost:6006/?path=/story/hub-pages-repositories-analytics--configured)                                                                                    |
| `/repositories/:repositoryId/learnings`                                        | [Learnings](http://localhost:6006/?path=/story/hub-pages-learnings--default)                                                                                                    |
| `/notifications`                                                               | [Inbox](http://localhost:6006/?path=/story/hub-pages-inbox--cached-refresh)                                                                                                     |
| `/canvas/connections`                                                          | [Canvas connections](http://localhost:6006/?path=/story/hub-pages-canvas-connection--connected)                                                                                 |
| `/canvas/pair/:userCode`                                                       | [Approve a connection](http://localhost:6006/?path=/story/hub-pages-canvas-connection--approval)                                                                                |
| `/shared/:shareId`                                                             | [Shared Build](http://localhost:6006/?path=/story/hub-pages-shared-build--default)                                                                                              |
| `/admin-enrollment`                                                            | [Administrator enrollment](http://localhost:6006/?path=/story/hub-pages-security-administrator-enrollment--enrollment)                                                          |
| `/settings/administrators`                                                     | [Administrator roster](http://localhost:6006/?path=/story/hub-pages-security-hub-administrators--multiple)                                                                      |
| `/settings/administrators/:membershipId/:operation`                            | [Removal confirmation](http://localhost:6006/?path=/story/hub-pages-security-hub-administrator-confirmation--remove)                                                            |
| `/settings/administrators/confirm`                                             | [Administrator continuation](http://localhost:6006/?path=/story/hub-pages-security-fresh-authorization--continuing)                                                             |
| `/settings/copilot`                                                            | [Copilot connection](http://localhost:6006/?path=/story/hub-pages-security-copilot--connected)                                                                                  |
| `/settings/copilot/confirm`                                                    | [Copilot continuation](http://localhost:6006/?path=/story/hub-pages-security-fresh-authorization--copilot-connection-confirmation)                                              |
| `/settings/sessions`                                                           | [End all Hub sessions](http://localhost:6006/?path=/story/hub-pages-security-end-all-sessions--confirmation)                                                                    |
| `/settings/sessions/confirm`                                                   | [Session revocation continuation](http://localhost:6006/?path=/story/hub-pages-security-end-all-sessions--provider-verified)                                                    |
| `/settings/sharing`                                                            | [Public sharing](http://localhost:6006/?path=/story/hub-pages-security-public-sharing--disable-confirmation)                                                                    |
| `/settings/audit?scope=hub`, `/settings/audit?scope=repository&repositoryId=…` | [Hub audit](http://localhost:6006/?path=/story/hub-pages-security-audit--multiple), [repository audit](http://localhost:6006/?path=/story/hub-pages-security-audit--repository) |
| `/settings/github/setup`                                                       | [Guided GitHub App setup](http://localhost:6006/?path=/story/hub-pages-github-setup-setup--configured)                                                                          |
| Unknown route                                                                  | [Not found](http://localhost:6006/?path=/story/hub-pages-route-feedback--not-found)                                                                                             |

**Hub / Design / Legacy GitHub App** contains one non-submitting design reference each for settings, manual registration, and installation. Hub does not serve those screens. Use guided GitHub App setup in the app.

## Component usage

The **Used in** panel analyzes production TypeScript JSX consumers under `client/` and follows them to pages and application surfaces. Counts represent source locations, not runtime instances. It excludes stories, fixtures, test support, and tests. Missing metadata and unused components have distinct empty states.

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
