# Testing and operations

Follow the [shared testing and review guide](../../docs/testing-and-review.md). Run every Hub Ruby and Node command inside the devcontainer.

| Goal                  | Command                                                   |
| --------------------- | --------------------------------------------------------- |
| Complete Hub suite    | `bin/devcontainer exec bin/ci`                            |
| Rails test            | `bin/devcontainer exec bin/rails test PATH`               |
| TypeScript test       | `bin/devcontainer exec npm test -- PATH`                  |
| Extension Node test   | `bin/devcontainer exec npm run extension:test`            |
| Type check            | `bin/devcontainer exec npm run typecheck`                 |
| Extension build       | `bin/devcontainer exec npm run extension:build`           |
| Extension asset check | `bin/devcontainer exec npm run extension:assets:check`    |
| Build controls iframe | `bin/devcontainer exec npm run controls:test`            |
| Controls bridge build | `bin/devcontainer exec npm run controls:build`           |
| Controls asset check  | `bin/devcontainer exec npm run controls:assets:check`    |
| Authored-source lint  | `bin/devcontainer exec npm run lint`                      |
| Storybook build       | `bin/devcontainer exec npm run storybook:build`           |
| Hub dependency age    | `bin/devcontainer exec bin/check-dependency-age`          |
| Prose review          | `bin/review-prose`                                        |
| GitHub App status     | `bin/devcontainer exec bin/rails replica:github:diagnose` |

To rerun focused Rails integration tests after Vite reports a missing test manifest, run `bin/devcontainer exec env RAILS_ENV=test bundle exec vite build` before retrying.

`bin/ci` runs the Hub test suites, style checks, dependency security and age checks, browser builds, seeds, queue checks, and annotations. The repository-level build-action workflow validates the shared action separately.

Security-limit tests use real Solid Cache database counters, including atomic increments and counter expiry. Cache housekeeping uses Solid Cache's existing expiry job on the test adapter so background workers cannot outlive transactional fixtures. Production housekeeping is unchanged.

For Copilot extension changes, follow the [prototype canvas contributor workflow](prototype-canvas.md#contributor-workflow). `extension:test` runs Node tests; `npm test` includes renderer tests, and `npm test -- PATH` selects a path. `npm run lint` checks authored source. Build renderer assets, commit them with source changes, then run `extension:assets:check` to rebuild and catch changed, missing, or unexpected files. Local `bin/ci` and GitHub CI run the extension checks.

Hub owns the canonical validator and injected adapter in `app/javascript/utils/prototype-controls/`. Its normal locked dependencies include AJV for generation; the generated validator bundles its runtime helpers so Build and retained-asset validation need no dependency install. `controls:runtime:test` checks the shared runtime, public JSON contract and bindings, including dependency-free retained validation. See [Controls development](prototype-controls.md) for schema commands. Regenerate the committed minified screenshot adapter, controls-only bridge and Storybook fixture with `controls:build`; `controls:assets:check` rebuilds in memory and rejects stale or missing output. Local `bin/ci` and the Hub CI workflow run that check, including the adapter consumed by the Build action. Capture itself needs no compiler. `extension:test` checks the Copilot plugin; there is no npm plugin distribution.

`controls:test` bundles the real Hub panel and an ordinary app into separate jsdom frames. The app serves static public definitions and owns its native fields. Checks cover all eleven types, injected defaults, container lifetimes, conditions, reset of inactive sets and copied-link restoration. URL checks preserve router state and Back/Forward without extra history entries. Frame, origin, epoch and binding checks reject stale commands while keeping healthy controls usable. Missing delivery leaves the standalone app usable without a Replica dependency. jsdom proves integration, not browser isolation or visual fidelity. Rails preview, share and review tests cover the existing access boundaries; real-browser and authenticated Build checks remain separate.

After an app-side controls update, integration tests wait for both URL persistence and the rendered field value before editing that field. Persistence can finish before React commits the updated input.

After a panel edit, wait for Reset to become enabled before clicking it. The app value can change before the panel receives and renders the settled update.

The dated browser records below predate the static JSON replacement and do not verify its current bindings or persistence.

The Ready and Minimized Build Controls fixtures were checked on 2026-10-02 in an agent-owned browser through the official isolated Playwright MCP. Shared-first ordering, live title/description/item changes, fold/value retention, unchanged iframe identity and URL through toolbar dismissal, 10-pixel/Shift-1-pixel movement, narrow-view reclamping, browser-local reload restoration and Reset passed. The owned browser was closed afterward. These are static-fixture results, not deployed signed-in or public Build authorization evidence; those authenticated browser checks remain unverified.

The scripted same-origin sandbox warning belongs only to the trusted Storybook fixture, whose synthetic parent and child share a local origin. Production signed-in and public Builds retain their existing separate `b{build_id}` and `s{build_id}` preview origins, the unchanged iframe sandbox, and existing authorization checks. Fixture checks do not establish that production boundary or canvas visual fidelity.

The alternative `Pages/Prototype Review/Hub Toolbar Controls` workspace was also checked on 2026-10-02 through the official isolated Playwright MCP. Exactly one Controls toggle appeared in the higher Hub header and none in the address bar; Copy prototype link and Minimize Hub UI stayed below it. Live title changes, group/panel folds, dismissal/reopen and actual minimize/maximize transitions retained values, panel position and the same iframe object and URL. At a 390-by-844 viewport, the header toggle and lower actions remained visible with no horizontal document overflow, and the 268-pixel panel fit within the 300-pixel preview. The owned browser was closed. Development-only mapped-port HMR errors and the fixture's same-origin sandbox warning did not indicate controls failures; the comparison preview subsequently served the static Storybook build without HMR. These checks do not establish deployed authorization or canvas fidelity.

The standard-button follow-up was checked in a fresh isolated browser on that same static workspace story. Controls and the adjacent theme button matched in 32-pixel size, border, colors, shadow, rest/hover/pointer-pressed styling and keyboard focus ring. Expanded Controls used Primer Brand's normal `aria-expanded` active styling without ghost overrides. The sliders icon, accessible name, sole higher-header placement, live title effect and iframe/value/fold retention through dismissal and minimize/maximize remained intact. The owned browser was closed; there were no controls, Tooltip or HMR errors. Only the fixture's favicon and same-origin sandbox warnings remained.

## Update dependencies

Follow the [shared dependency policy](../../docs/testing-and-review.md#update-dependencies), including the seven-day publication delay and security checks. Run `bin/devcontainer exec bin/check-dependency-age` for Hub lockfiles.

The production [Dockerfile](../Dockerfile) pins the official Ruby and Node images to SHA-256 image index digests. Each index includes Linux AMD64 and ARM64 images. When refreshing a pin, resolve its tag from Docker Hub's official `library/ruby` or `library/node` repository, verify both architectures with `docker buildx imagetools inspect`, and update the tag and its matching index digest together. Do not use a single-architecture manifest digest. Keep `RUBY_VERSION` and `.ruby-version` aligned with the Ruby image; overriding the version alone does not change the pinned image.

The existing [Dependabot configuration](../../.github/dependabot.yml) updates Bundler, npm, and GitHub Actions dependencies, but not Docker images. Rebuilding with a pinned digest does not pick up upstream base-image security fixes. Maintainers must refresh those pins to receive them. Adding Docker updates to Dependabot requires approval; do not introduce another updater. Before shipping refreshed pins, build both release architectures with the learning build context, run the production-image CI checks, and verify that the app starts.

Hub CI runs the same production-image checks in parallel on native AMD64 and ARM64 runners. Each job builds and loads its image without publishing, checks secret cleanup and deployment configuration, and requires the production app's `/up` health endpoint to succeed. It removes the test container and generated configuration afterward. The required `Production image` result passes only when both architectures succeed, or when suite selection explicitly excludes Hub and the image jobs are skipped.

`BUNDLE_DEPLOYMENT=1` makes Bundler installs frozen unless explicitly overridden by `BUNDLE_FROZEN=false`. The production build inherits deployment mode and copies `Gemfile.lock` before installing gems, so missing or inconsistent lockfiles fail rather than being rewritten. Scanner rules checking for frozen installs should recognize deployment mode, not require a redundant `BUNDLE_FROZEN` setting.

Hub uses the native TypeScript compiler through `@typescript/native` for the `tsc` command and maps the `typescript` package name to a compiler-API compatibility package for tools such as typescript-eslint. Keep both aliases in [package.json](../package.json) until those tools support the native compiler's API.

## Keep local and GitHub CI aligned

Follow the [shared CI alignment rules](../../docs/testing-and-review.md#keep-local-checks-and-ci-aligned).

A Rails test job that renders Vite pages must:

1. Set up Ruby and Node.
2. Install gems and Node packages.
3. Build test Vite assets.
4. Prepare the test database.
5. Run Rails tests.

When a Hub command gains a new dependency or build prerequisite, update `config/ci.rb` and the [Hub CI workflow](../../.github/workflows/hub-ci.yml) in the same change.

When Hub is affected, GitHub CI splits `npm test` across four Vitest shards and runs controls and extension integration tests in a separate parallel job. The `Frontend tests` check requires every selected shard and integration job to pass. Unrelated pull requests omit that work through the [shared suite-selection policy](../../docs/testing-and-review.md#select-affected-ci-suites). Local `bin/ci` still runs the complete suites without sharding or selection.

Vitest runs explicitly listed browser-independent tests in its `node` project without DOM setup. Other tests stay in the `browser` project with jsdom and shared browser cleanup. Both projects retain mock and global resets and test isolation. Add a test to the Node list in `vitest.config.ts` only after checking its imports and runtime dependencies; a `.ts` extension does not establish browser independence. `npm test` and path selectors cover both projects, while `npm test -- --project=node` selects the Node tests.

## Review interface changes

Use the browser canvas first for agent-driven rendered checks, interaction tests, screenshots and reviews, following the [root browser validation policy](../../AGENTS.md#browser-validation-and-playwright-fallback). Use configured isolated Playwright MCP only for checks the canvas cannot perform. Automated suites, CI browser integration and build-artifact capture retain their configured drivers because they run without the Copilot canvas host.

Review presentation changes in Storybook before checking the complete flow in the running application. Use the theme and viewport controls, then inspect default and narrow widths with representative data.

The `Pages/Security/End all sessions` stories were checked on 2026-10-06 in an owned isolated Playwright browser against the static Storybook build. Confirmation, only-your-session, challenged, denied, ended, and disconnect-delivery-failed states rendered with explicit own-session and public-share outcomes. Desktop and 390-by-844 confirmation layouts had no horizontal overflow; keyboard Space selected the required checkbox and Tab reached both actions with a visible focus ring. No forms were submitted, and the browser was closed afterward. The only console error was the fixture's missing favicon. These are synthetic UI checks, not live OAuth, deployed authenticated Build, production cable-adapter, or native canvas evidence; canvas inspection was unavailable because the runtime exposed no page-acquisition tool.

Check these states when they apply:

- Empty and populated.
- Short and long content.
- Selected, resolved, expired, or deleted.
- Validation and service failures.
- Destructive confirmations.

Compare typography, spacing, labels, and control order with adjacent pages. Confirming that controls render is not a visual review.

## Review a change

Follow the [shared review process](../../docs/testing-and-review.md#review-and-finish-a-change). For Hub code changes, run a focused test while iterating, then run `bin/review-prose` and `bin/devcontainer exec bin/ci` once the change is stable.

RuboCop does not enforce the repository's multiline Ruby and Jbuilder call style, so inspect those lines yourself.

After changing the database schema or Rails routes, update and check annotations:

```sh
bin/devcontainer exec bundle exec annotaterb models
bin/devcontainer exec bundle exec chusaku
bin/devcontainer exec bin/check-annotations
```

Oaken defines test defaults and shared scenarios. WebMock prevents tests from reaching external services; use the GitHub request stubs when the HTTP request itself matters.

`bin/devcontainer exec bin/rails test test/integration/solid_cable_delivery_test.rb` exercises the production Solid Cable adapter against a temporary SQLite database with the existing cable schema and production batching defaults. It checks persisted review notices, cross-server disconnect notices, shutdown flushing, and Rails error reporting for failed writes. Ordinary channel tests use the test adapter and do not establish these delivery checks.

Keep `db/seeds/test/setup.rb` record-free. It defines model defaults and helpers for common valid states. Stable repository personas live under `db/seeds/test/repositories` and are loaded explicitly by the tests that need them:

```ruby
setup { seed "repositories/github_prototype" }
```

Use named persona records as a starting point, then make the behavior under test explicit in the test body. Keep failures, removed or expired records, pagination data, and other edge conditions local to the test.

Before a release, run the production image and manually verify GitHub setup, sign-in, Build storage, previews, and review collaboration.

Also verify public share links with a signed-out browser:

- The shared Build loads with nested assets and browser routes.
- Newer Builds do not change an existing link.
- Expired and deleted links return not found.
- Repository removal makes links unavailable without a GitHub request.
- Public previews contain no review bridge or private Hub data.

Solid Queue removes expired share links daily and expired preview grants hourly.
It also removes repository activity events older than 90 days hourly.
Security audit records expire after 90 days and are removed hourly by a separate cleanup operation. Expired and consumed operator-enrollment proofs are also cleaned up hourly; see [Security audit](security-audit.md).
Expired fresh-authorization challenges are removed hourly; the five-minute identity window is checked before every sensitive request, independently of cleanup.
It recovers pending analytics deliveries every minute; see [Repository activity events](analytics.md) for provider credentials, retries, and explicit backfill.
It also recovers failed GitHub webhook deliveries every minute and cleans bounded receipt/recovery metadata. See [Shared request limits](security-rate-limits.md#operations-and-retention) for the offline status command, recovery window, and unresolved failures.

## Publish a release

Create a GitHub release from a Hub semantic version tag in the form `hub-v<major>.<minor>.<patch>`. Publishing the release builds AMD64 and ARM64 images, pushes the applicable tags to `ghcr.io/github/replica-hub`, and uploads the deployment bundle and its checksum.

The workflow builds each architecture in parallel on its native runner, using the same source revision, version, and image labels. Build jobs push immutable image digests without updating release tags. Only after both builds succeed does the publication job combine their digests into one multiarchitecture image and apply the release tags. If either build fails, no release tags or deployment bundle are published.

A stable release updates the exact, minor, major, and `latest` image tags. A prerelease updates only its exact version tag.

After the first publication, a repository administrator must confirm that the package is linked to this repository and set its visibility to **Public**. Confirm that a signed-out user can pull the image before announcing the release.
