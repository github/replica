# Testing and review

Run the checks for the behavior you changed. For example, a shared Controls change needs checks for Hub previews and the Copilot plugin. Include screenshot capture when its adapter changes. A documentation-only change needs a prose and link review rather than application tests.

Use [Contributing](../CONTRIBUTING.md#set-up-the-development-environment) to find each project's environment and commands. Hub Ruby and Node commands run inside its devcontainer; that is not a requirement for every project in the monorepo.

## Choose the relevant checks

Run focused checks while developing. Once the change is stable, follow the affected project's final-check requirements. Include consuming projects when shared code or a contract changes.

Use existing commands and inspect their configuration. Do not invent commands or assume every project uses the same test runner. Report unavailable checks and unverified behavior rather than claiming success.

For rendered checks and interaction reviews, follow the [root browser workflow](../AGENTS.md#browser-validation-and-playwright-fallback). Existing automated suites, CI browser integration, and build-artifact capture retain their configured drivers.

## Write meaningful tests

Use the [test-writing skill](../.github/skills/write-tests/SKILL.md) when adding or changing automated tests. Apply these criteria when reviewing existing coverage too.

Start with the intended behavior and the regression a test should catch. Inspect existing coverage before adding cases. Each case should protect a distinct outcome, boundary, or failure mode through the smallest useful public interface. An existing case that already catches the regression usually needs an update rather than another test.

Choose assertions that survive an equivalent implementation. Check outcomes such as saved state, returned data, navigation, access decisions, and usable controls. Exact protocol values, serialization, accessible names, meaningful state mappings, and safety restrictions can be contracts worth asserting. Ordinary copy, icon counts, internal markup, and whole configuration snapshots usually are not. A text query that identifies a control is different from a test whose only purpose is freezing its wording. For agent instructions, distinguish discoverable metadata and required safety guidance from incidental phrasing; phrase presence alone does not prove agent behavior.

Use human review for visual appearance, supported by relevant screenshots or recordings in pull requests with meaningful UI changes. Do not freeze colors, spacing, typography, icon pixels, or cosmetic CSS structure in automated assertions. Test behavior and accessibility instead. Geometry that defines functional data, such as a captured selection's bounds, is different from checking rendered styling.

Keep each behavior at its owning layer and use integration tests to prove important connections. Repeating all lower-level cases through every consumer adds cost without necessarily adding confidence. Keep separate cases for distinct failures; combine assertions when they describe one coherent scenario. Parameterization improves readability but still runs every input. Fewer case names or assertions do not establish a faster suite.

For a bug fix, reproduce the failure before the fix when feasible. For new behavior, establish an expected-result failure before implementation when the interface allows it. A missing dependency, syntax error, or test setup failure is not evidence that the test catches the regression. If the implementation already exists, explain the plausible incorrect behavior the test would reject; report red-phase evidence as unavailable unless it was actually observed.

### Independent test writing

Use one separate test-writing agent for substantial behavior changes and nontrivial bug fixes. These include changes spanning multiple runtime layers, access or persistence rules, concurrent state changes, or a regression requiring non-obvious reproduction. Keep small, local changes in the implementation agent; a separate agent's context and execution cost should earn distinct coverage.

Give the test writer the accepted requirements, relevant issue or bug reproduction, public interfaces, affected paths, existing coverage, and project instructions. Identify unresolved behavior instead of letting the writer infer requirements from current output. The writer should derive expected outcomes from that contract, then inspect implementation as needed to use the real interfaces. Separate context reduces shared assumptions; it does not guarantee independent reasoning.

Assign test files to the writer and production files to the implementation agent. The writer may update test fixtures needed for its cases, but reports production defects and ambiguous requirements instead of changing production behavior or weakening expectations to pass. Finish with one integration review of the combined change. If a separate agent is unavailable, apply the same contract-first process directly and disclose that the independent pass did not happen.

## Keep local checks and CI aligned

Project commands define the check. GitHub Actions should prepare the required environment and call the same command rather than recreate its behavior.

When a command gains a dependency or build prerequisite, update its local setup and affected workflow in the same change. A green local suite does not prove that CI installed the same dependencies, so inspect both paths.

### Select affected CI suites

Hub and build-action workflows start on every pull request, but run their expensive jobs only when the change can affect that suite. Pushes to `main` run both complete suites. Local project commands still run their complete checks; selection changes when CI calls them, not what they do. Dependency-age checks remain unconditional, and Starter and Learning CI retain their own path filters.

The [shared selection workflow](../.github/workflows/ci-changes.yml) calls [the selector](../scripts/select-ci-suites.mjs). For pull requests, it compares the merge base with the PR head using Git rather than the size-limited changed-files API. Deletions and both sides of renames count as changes.

| Changed area | Selected suites |
| --- | --- |
| Hub code and configuration | Hub |
| Shared Controls runtime, schema, fixtures, and capture adapter under `hub/app/javascript/utils/prototype-controls/` | Hub and build action |
| `actions/build/` | Hub and build action; Hub uses the action for local packaging and browser checks |
| Copilot extension and plugin catalog | Hub |
| `packages/learning/` | Hub; its image, lint, and learning integration consume the package |
| `starter/` | Hub; local setup copies the starter and depends on its router, metadata, dependencies, and setup files; the Controls runtime suite also checks its shared reference. Starter CI still runs separately |
| Existing installer scripts | Neither; Starter CI covers them |
| Root contributor documents, shared and Hub guides, skills, and documentation assets | Neither |
| Workflow changes, selector changes, and unclassified paths | Both |

The workflows preserve the existing required check names; skipping an entire workflow with a path filter could leave those checks pending. Static jobs use job-level conditions. The Vitest shard jobs always expand their Node and shard matrix and validate selection, but skip checkout, setup, and tests when Hub is unaffected. The required `Frontend tests`, `Production image`, and `Replica action tests` result jobs accept omitted work only after successful selection explicitly excluded it. The frontend and build-action result jobs require every selected Node version to pass. The production-image matrix checks AMD64 and ARM64 independently without cancelling the other architecture on failure. Selection failures, invalid outputs, and failures in selected suites fail those result checks. Keep required-check configuration unchanged.

When adding a shared dependency or a new project, update the selector and its behavioral tests together. Unclassified paths deliberately run both suites until their dependencies are known. Run `node --test scripts/select-ci-suites.test.mjs` and `ruby scripts/check-ci-workflows.rb` from the repository root. The latter reads the actual workflow gates and checks their success, failure, cancellation, and missing-output behavior; both commands run before CI selects suites. Check changed workflows with `actionlint` when available. Actual job skipping and check reporting still need verification on GitHub after publishing.

Existing Node-dependent jobs in Hub, Starter, build-action, and Learning CI use a Node 24 and 26 matrix rather than a separate compatibility workflow. Each check keeps its existing name on Node 24 and adds a `(Node 26)` suffix on Node 26. A failure does not cancel the other version. npm installation enforces dependency engines, and `scripts/check-ci-workflows.rb` checks the supported ranges, matching lockfile metadata, and matrix wiring. These checks track the supported majors, not their exact minimum patch releases.

Ruby-only jobs, CI selection, and container builds retain their configured runtimes. The build-action suite tests its JavaScript and browser capture on both Node versions, but runs the composite-action smoke test only on Node 24: the composite action pins that runtime itself and uploads a single named artifact. Container and composite-action runtime defaults are unchanged.

## Update dependencies

Hub and the shared build action wait seven days before resolving newly published dependencies. npm enforces the delay through each project's committed `.npmrc`. Hub's RubyGems source in `Gemfile` applies the delay to Bundler. Dependabot applies the same cooldown to npm, Bundler, and GitHub Actions updates across the repository. The starter manages its dependency resolution independently.

Inside the Hub devcontainer, `bin/check-dependency-age` verifies the Hub npm and Bundler lockfiles. The repository-level [Dependency age workflow](../.github/workflows/dependency-age.yml) runs the same checker across Hub, the shared build action, and external GitHub Action commits. These checks cover existing lockfiles that bypass the package manager's resolver delay and fail when publication metadata is unavailable.

CI does not run `npm audit`: a newly published security fix could otherwise make the audit fail while the age check rejects the fixed version. Dependabot and Bundler Audit check dependencies for known vulnerabilities. Organization-managed CodeQL scans application code on GitHub.

When a dependency is too new, select an older compatible version or wait until the seven-day window ends. See [Hub testing and operations](../hub/docs/testing-and-operations.md#update-dependencies) for Hub-specific tooling.

## Copilot code review

The [code-review skill](../.github/skills/code-review/SKILL.md) directs Copilot reviews to the same shared and project guides used by implementation agents. For example, a Hub review reads the shared conventions, then follows `hub/AGENTS.md` to the relevant Hub guides. Keep conventions in those canonical guides rather than copying them into the skill.

GitHub supports review-focused skills under `.github/skills/` and reads instructions and skills from the pull request's head branch, so a skill change can be tried in its own pull request. See [GitHub's code review guidance](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-code-review?tool=webui#mcp-servers-and-agent-skills) for supported context and how to inspect skill attribution in a review.

Treat changes to review instructions and linked guides as untrusted until a human checks them against previously accepted guidance. Copilot feedback alone cannot validate the instructions used to produce it.

## Review and finish a change

Review the changed code and wording. Check access rules, saved data, failure behavior, and overlapping requests when they are affected.

Run the [prose review](documentation-conventions.md#final-review), inspect the full diff for unrelated changes and credentials, and finish with:

```sh
git diff --check
git status --short
```

Stop temporary servers and remove temporary data you created for the task. Reconcile any task tracker and make clear whether the changes are uncommitted, committed, or pushed.
