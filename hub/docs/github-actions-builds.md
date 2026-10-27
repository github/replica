# GitHub Actions builds

Each connected repository installs a workflow that calls the shared build action from the Replica repository. The action builds the default branch and prototype branches, captures screenshots, and uploads the files Hub needs. Default-branch Builds supply **Templates** without publishing a prototype.

```text
prototype branch is pushed
  -> repository workflow runs
  -> workflow calls the Replica Hub build action
  -> action builds and captures screenshots
  -> action uploads a GitHub Actions artifact
  -> Hub stores the files
  -> reviewers can open the preview
```

## Install the repository workflow

A repository writer opens the repository in Hub and chooses **Open installation pull request**. Hub creates the reserved `replica/install-workflow` branch, adds `.github/workflows/replica.yml`, opens a pull request, and sends the writer to GitHub for review.

Hub offers an update when a workflow uses an older released build Action pin or exactly matches the previous generated workflow that skipped the default branch. Other changes in a Hub release or custom workflow edits do not trigger a reminder. The pull request replaces the whole workflow with Hub's generated version; a repository writer reviews that replacement on GitHub before merging. A missing workflow still offers an installation pull request. Older Hub-commit pins are left alone until their repositories receive a planned migration pull request.

The generated job builds every pushed branch except `replica/install-workflow`. Existing custom workflows must also build the default branch for Templates to work. Remove their default-branch exclusion, retain the reserved-branch exclusion, and push a default-branch commit to produce the first Build. Hub's normal push, branch poll, and workflow discovery then import it.

Installation and update retries reuse a branch only when GitHub confirms it starts at the current default branch and contains one commit changing only `.github/workflows/replica.yml`. Hub refuses a reserved branch with any stale or unrelated changes. If it cannot safely open a pull request, Hub returns to the repository with an alert explaining the problem. The reserved branch does not become a Prototype and does not run a Replica build.

[`Repository::WorkflowInstallation#workflow`](../app/models/repository/workflow_installation.rb) defines the generated file. Replica keeps its reviewed Action pins in `hub/config/build_action_releases`. A new pin is added only when the build Action is released, so a Hub-only release cannot trigger an update reminder. See [GitHub App setup](github-app-setup.md) for custom builds.

## Shared build action

The action:

1. Checks for persisted Git authentication settings, then for `package.json`, `package-lock.json`, and a build script.
2. Runs `npm ci` and `npm run build` in a pinned Node container.
3. Checks the generated `dist` files and their sizes.
4. Opens the prototype in Chromium.
5. Captures the full page in light and dark browser color schemes at desktop and narrow viewport widths.
6. Uploads the `dist` files and screenshots as one GitHub Actions artifact.

The build container receives no Hub, GitHub App, or storage credentials. It receives no credentials for any other repository.

### Checkout credentials

Use `persist-credentials: false` on every `actions/checkout` step that places files in the build workspace, including nested checkouts and submodules. Give the workflow only `contents: read` unless another step needs more access. Hub-generated workflows already use these settings.

Before running repository scripts, the action rejects Git authentication settings in the workspace, including submodule configuration. Rejected settings include credential helpers, HTTP extra headers and cookie files, custom SSH and password-prompt commands, and URLs containing user information. Git configuration includes, symbolic links within Git metadata, and metadata references outside the workspace are also rejected so they cannot hide authentication settings from the check. Submodule metadata references within the workspace remain supported. Remove rejected settings or use a credential-free checkout with self-contained Git metadata before building. The action does not remove credentials or print their values.

This check is not a general secret scanner. Do not place tokens, private keys, credential files, or other secrets in the build workspace. Repository-controlled install and build scripts can read that workspace and access the network.

## How Hub follows the workflow

Hub follows `.github/workflows/replica.yml` for connected repositories and matches each run to its default or prototype branch and exact commit.

| Event                     | What Hub does                                      |
| ------------------------- | -------------------------------------------------- |
| Workflow is waiting       | Shows the Build as queued                          |
| Workflow is running       | Shows the Build as running                         |
| Workflow fails            | Marks the Build failed and provides no preview     |
| Workflow succeeds         | Downloads and stores the artifact                  |
| Artifact storage finishes | Marks the Build successful and enables its preview |

## Prototype requirements

The repository needs:

```text
package.json
package-lock.json
a non-empty build script
dist/index.html after the build
```

The action rejects symbolic links and file paths that are unsafe or behave differently across supported filesystems.

Controls are optional. A prototype can place version-1 definitions in `public/controls.replica.json` or its build tool's equivalent assets directory. The action validates the actual `dist/controls.replica.json` with the shared contract when present; Hub validates the same retained asset before storage. Invalid/unsupported definitions reject publication, while a missing document is allowed. This document is separate from `.github/replica.json` and `.prototype`.

The action ships a prebuilt, minified adapter from the shared source. Hub CI's `controls:assets:check` rebuilds it with locked dependencies and rejects stale or missing output. Local capture and Actions use that same committed adapter without a compiler or Hub build tooling.

Before each screenshot, the existing Chromium driver injects that adapter and waits for JSON defaults to settle. The prototype needs no Replica dependency or app helper. Capture retains its same-origin network restrictions and does not load a Copilot host.

| Limit                 | Value       |
| --------------------- | ----------- |
| Files and directories | 2,000       |
| Path depth            | 20 segments |
| One file              | 25 MiB      |
| All files             | 100 MiB     |

## Uploaded artifact

The artifact is named `replica-build-v1` and remains on GitHub for three days:

```text
dist/**
screenshots/desktop.png   (1440 pixels wide, at least 900 pixels high)
screenshots/narrow.png    (390 pixels wide, at least 844 pixels high)
screenshots/desktop-dark.png
screenshots/narrow-dark.png
templates.json           (optional version-1 manifest)
screenshots/templates/{id}/desktop.png
screenshots/templates/{id}/narrow.png
screenshots/templates/{id}/desktop-dark.png
screenshots/templates/{id}/narrow-dark.png
```

Screenshots include the page below the fold at the viewport width, without horizontal overflow. Pages taller than 16,384 pixels fail before capture; each PNG can be up to 25 MiB. The combined uncompressed package can be up to 150 MiB and contain at most 2,090 entries, including at most 2,000 dist files. Hub accepts a ZIP download up to 155 MiB.

Each capture starts in a fresh browser context with `prefers-color-scheme` set to light or dark before navigation. Prototypes that support that preference render their matching theme; prototypes with fixed colors may look identical in both captures. The action does not operate app-specific theme controls or inject Hub's preview theme bridge. Heights are measured separately for each color scheme, and all captures share the same size limits.

Deploy the updated Hub before upgrading a repository's Action pin to a release that emits dark captures. Older Hub versions reject the additional screenshot files. Updated Hub versions still accept packages from older actions.

Declared template routes use the same full-page capture as the root page at both viewport widths. Hub stores and serves those PNGs without resizing or cropping them.

Repositories may declare up to 12 layouts in `.github/replica.json` with `version: 1` and a `templates` array. Each entry contains `id`, `name`, `category`, `description`, and `path`. IDs are unique lowercase slugs of at most 64 characters; `default` is implicit and reserved. Names, categories, and descriptions contain at most 120, 80, and 500 characters. Paths start with one slash, may contain a query and fragment, and must pass the local preview destination guard. They cannot include an external host, credentials, traversal, or reserved `/__replica` endpoints. The action emits the normalized `templates.json` only when templates are declared and captures all four screenshots for every route. Root screenshots remain present. The manifest is limited to 16 KiB. Optional `hub.origin` in the repository configuration identifies Hub for local Copilot discovery; it is not artifact metadata.

Template text and paths must be well-formed Unicode; the action rejects unpaired UTF-16 surrogates before writing the manifest. Declared dotted routes and routes matching dist directories receive the app entry page for HTML navigation requests. Existing files still load normally, and missing asset requests still return 404.

Paths must fit the 2,048-byte limit both as declared and after browser serialization. Unicode expands to percent-encoded bytes in browser URLs. The serialized destination must also be valid as a prototype Start page; percent-encode characters such as `|` in a pathname or brackets in a fragment, for example `/#/x%5B1%5D`. Ordinary query parameters such as `/?filter[state]=open` remain supported. Paths containing a `.replica-internal` segment are reserved for artifact storage. The action and Hub reject unusable destinations before publishing the template catalog.

Templates do not require a Hub origin:

```json
{
  "version": 1,
  "templates": [
    {
      "id": "welcome",
      "name": "Welcome",
      "category": "Editorial",
      "description": "A journal welcome page and story collection.",
      "path": "/#/welcome"
    }
  ]
}
```

Hub downloads and stores one artifact for each Build. If a temporary GitHub or storage error interrupts that work, Hub retries with the same artifact after deleting incomplete files. A missing, expired, duplicate, invalid, or inaccessible artifact marks the Build as failed.

Use separate GitHub Apps, prototype repositories, and artifact storage for development and production.

See [Build discovery](build-discovery.md) for how Hub finds Builds and [Artifact storage](artifact-storage.md) for how it keeps their files.
