# GitHub Actions Builds

Hub imports Builds that prototype repositories produce in `.github/workflows/replica.yml`. The workflow uploads static output with the [publish action](../../actions/build/publish/action.yml) and captures screenshots in a dependent job with the [screenshots action](../../actions/build/screenshots/action.yml). Hub pulls each package through the GitHub API. It imports the dist when the publish job finishes, without waiting for screenshots. A failed or missing screenshot job does not fail an already imported Build.

## Requirements

The Hub that imports a repository's Builds is the Hub whose GitHub App is installed on that repository. The App needs **Actions: read** and **Contents: read** and must subscribe to the **Workflow runs**, **Workflow jobs**, **Push**, and **Branch or tag deletion** webhook events. Hub imports `push` runs of `.github/workflows/replica.yml` in connected repositories. To exclude tag runs, the workflow must restrict its trigger to branches. The installer branch is excluded. Imports never create repositories.

Create the App manually and connect it with the `setup:post` wizard. If the App was created before these settings were required, open its **Permissions & events** settings, confirm **Actions: read** and **Contents: read**, select these four events under **Subscribe to events**, and save. If either permission was added, each installation must accept the updated permissions.

Webhooks give the fastest import. Without webhook reachability, [recovery](#recovery) still imports retained artifacts by polling, typically within about five minutes after Hub is available. Workflows do not contact Hub directly or need publishing credentials.

## Configure the prototype workflow

Save this as `.github/workflows/replica.yml` in a connected prototype repository. Replace the build steps with the repository's own build; they must write static output, with an `index.html`, to `dist` or to the directory set in `output-directory`.

The example runs on every pushed branch, including nested `proto/` branches, and not on tag pushes. Use a branch filter in existing workflows too: GitHub's workflow run data does not reliably distinguish a tag from a same-named branch. If you restrict workflow branches, include `branches: ['proto/**']` to cover names such as `proto/settings/mobile`. Add patterns for any other branches users track manually; a branch without a workflow run cannot produce an imported Build.

The example pins both Replica actions to the same implementation revision. That revision must be available on GitHub before enabling the workflow in another repository. When upgrading, replace both references with the same reviewed commit.

```yaml
name: Replica

on:
  push:
    branches: ["**"]

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
      - run: npm ci
      - run: npm run build
      - uses: github/replica/actions/build/publish@5ec2d4ad6d5343b61684ba2c7a1c8c82e2914565

  screenshots:
    needs: publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: github/replica/actions/build/screenshots@5ec2d4ad6d5343b61684ba2c7a1c8c82e2914565
```

The publish action validates and packages the output and uploads `replica-build-v1`. It installs no npm packages and no browser. Its completed-job event queues the Hub import while the dependent screenshot job downloads that exact artifact and uploads `replica-screenshots-v1`. The preview becomes available after webhook delivery, queue processing, and artifact import, not immediately on upload. If the build or artifact upload fails, GitHub skips screenshots and Hub records the failed Build.

Keep publish last in its job: later steps delay the completed-job event used for import. Putting screenshots in that same job delays import until they finish. Keep checkout credentials disabled and pin actions to reviewed commits.

The optional [build action](../../actions/build/action.yml) is still available. It runs `npm ci` and `npm run build` as a non-root user in a Node container. With `screenshots: separate`, it uploads the same dist package as the publish action and can replace the build steps and publish action above. Existing single-job workflows remain compatible: `screenshots` defaults to `inline`, which uploads one package containing the dist and screenshots, so Hub imports it only after screenshots finish.

To use the build and publish actions as separate steps, set `build-only: 'true'` on the build action, then call the publish action. Build-only mode leaves the static output in the workspace without packaging, uploads, browser installation, or screenshot capture. Without this option, both actions upload `replica-build-v1`, and GitHub rejects the duplicate artifact name.

If Hub is offline during an update, the workflow can still upload both artifacts to GitHub. GitHub does not automatically retry failed webhook deliveries. Once Hub returns, polling or requested redelivery can import the retained packages. Hub still needs GitHub API and artifact-download access. Recovery is bounded by the three-day artifact retention and polling window; expired packages cannot be recovered automatically. Re-running the workflow is safe because successful Builds and artifacts are never replaced.

## Flow

```mermaid
sequenceDiagram
  participant GA as GitHub Actions
  participant W as Webhook route
  participant Q as on-demand queue
  participant I as Import worker
  GA->>W: workflow_run requested/in_progress
  W->>Q: enqueue (job ID per delivery), then record delivery
  Q->>I: import run → queued/running Build
  GA->>GA: retain replica-build-v1
  GA->>W: workflow_job completed (publish job)
  W->>Q: enqueue
  Q->>I: download replica-build-v1 → successful Build, preview ready
  GA->>GA: capture and retain screenshots
  GA->>W: workflow_run completed (after screenshots)
  W->>Q: enqueue
  Q->>I: download replica-screenshots-v1 → attach if digest matches
```

The webhook accepts `workflow_run` (`requested`, `in_progress`, `completed`) for the Replica workflow path, and every completed `workflow_job`, because job events are the earliest signal that the dist artifact exists. `workflow_run.completed` arrives only after every job, including screenshots, so it cannot provide early preview availability.

The route enqueues before recording the delivery receipt. A queue failure therefore leaves the delivery unrecorded, so [recovery](#recovery) can redeliver it. Each delivery gets its own job ID, so an event that arrives while an earlier import of the same run is active still triggers another pass.

## Import worker

`import-github-workflow-run` runs on the on-demand queue with five attempts and exponential backoff from 15 seconds. It reads the run through the GitHub API rather than trusting the webhook payload, and ignores runs that are not `push` runs of the Replica workflow, the installer branch, or unconnected repositories.

One Build exists per prototype identity and commit. Each pass is idempotent:

- Without a dist artifact, an in-progress run marks the Build `running`; a completed run fails it with the run conclusion.
- With the newest unexpired `replica-build-v1` artifact, Hub downloads at most 160 MiB, validates and extracts up to 150 MiB of package files, writes files to [artifact storage](artifact-storage.md), and commits the successful Build with its `distDigest` and artifact records in one transaction.
- Invalid, expired, or oversized packages fail the Build with a summary. Network, storage, and database errors throw so the job retries.
- A successful Build is never re-imported, replaced, or deleted.

GitHub lists named artifacts across rerun attempts. Hub prefers packages created at or after the current attempt's `run_started_at`. If that attempt has no dist package, Hub reuses an unexpired dist from an earlier attempt of the same run only when the Build already has that digest or the current attempt's screenshots name it. This supports **Re-run failed jobs** when only screenshots failed and GitHub keeps the successful publish job's artifact. During a full rerun, the current attempt has no screenshots yet, so Hub waits for that attempt's own dist instead of fixing the Build to the earlier one. If the run completes without a matching dist, the Build fails without storing the earlier package. The first successful dist import fixes the Build's digest; subsequent attempts never replace it, and screenshots attach only when their digest matches that Build.

Hub records the completed workflow pass only after author resolution, registration, and screenshot processing finish. A provider, transport, or storage error leaves a new pass pending for recovery even if the dist preview is already available.

Storage keys derive from the Build, file path, and content. Retries reuse identical objects, a key with different bytes stops the import, and keys are never deleted. Unreferenced keys left by an interrupted import are harmless.

### Commit authors

Hub resolves the linked GitHub account from the imported commit SHA, not the workflow actor or free-text commit name/email. Builds retain that provider identity and login. A matching existing Hub identity can fill an unset Prototype owner; imports never create Hub users or replace an existing owner. Without an owner, the index and detail header use the current Build's GitHub author snapshot (or the latest Build when none is current). Bots remain bot accounts, and a commit response without a linked account remains unknown with a warning. Failed commit lookups, including HTTP 404 or 422, are reported and retried instead of being treated as an unlinked author. Available artifacts still import; recovery can requeue eligible Builds while their completed import pass remains unrecorded. Later passes reuse an existing GitHub identity without another commit lookup.

Builds whose completed import pass was already recorded are not automatically revisited solely for missing author metadata. From `hub/`, use the existing configured App and database connection to inspect one retained Build:

```sh
npm run github:repair-author -- --repository-id GITHUB_NUMERIC_REPOSITORY_ID --build-id BUILD_UUID
```

The default only resolves the saved commit. `available` means GitHub returned a linked account, not that a write occurred. After approving the target, add `--apply` to fill missing identity metadata and an unset mapped Prototype owner. Repeated application returns `unchanged`; an existing different or incomplete author snapshot returns `preserved`. The write rechecks the connected repository, Build, commit, and run after the provider lookup. No artifacts, Build state, workflow ownership, or current selection are replaced. This command can repair older retained Builds outside the polling window. Applying it to production requires separate approval; do not paste credentials into arguments.

## Automatic prototype registration

A successful imported Build on a branch starting with `proto/` automatically registers that branch's Prototype. The rule is case-sensitive and includes nested names such as `proto/settings/mobile`. Both webhook imports and recovery use the same registration path. Queued or failed Builds do not register a new Prototype.

Registration sets the existing `Prototype.registeredAt` timestamp and uses the branch name only when no name has been saved. Repeated imports preserve that timestamp and never replace a saved name, description, or other prototype metadata. Repository and prototype locks serialize registration with metadata edits.

Other branches still import Builds but remain unregistered until a user tracks them manually in Hub. The default branch, reserved `replica/install-workflow` branch, internal replica owners, and deleted branches never auto-register. Stale imports cannot recreate a retired branch's Prototype. Existing registrations are not removed or reclassified.

Branch `delete` events and `push` events with `deleted: true` retire the branch without deleting its metadata, Builds, or artifacts. Hub keeps a retirement record even if deletion arrives before the first workflow import. Branch polling never infers deletion from a missing branch; the App's deletion-event subscription and webhook recovery provide that evidence.

A returning branch resumes its latest retired Prototype only when its saved head is unchanged or GitHub confirms that head is an ancestor of the returning head. A shared ancestor is not enough. Hub saves the deleted head only from GitHub's evidence: the `before` SHA of a branch-deleting push, accepted only when it is that Prototype's last observed head or the commit of one of its Builds. A `delete` event carries no SHA, so it never sets the saved head; a later push can fill a missing head but never replace one. An unrelated history, or a retirement with no proven head, gets a separate, initially unregistered Prototype. The retired Prototype keeps its name, description, reviews, share links, and Builds. None of those relationships transfers to the replacement.

Hub captures the owning Prototype and a revision before listing branches or comparing commits. It applies the result only while both still match, under the same repository lock used by deletion and workflow preparation. A newer observation, retirement, or replacement invalidates an older result even when the head SHA repeats. GitHub failures and invalid or contradictory ancestry responses leave the retired identity untouched and are logged for the next recovery pass. The migration does not backfill saved heads, because a selected Build does not prove which head GitHub deleted. Branches retired before it get a separate identity when they return.

Replacement histories reject workflow runs created at or before the recorded deletion, except for the exact head confirmed by the new listing. This lets a retained workflow for the replacement's current head import without admitting an old history's delayed workflow. Retired Builds cannot suppress recovery for the replacement.

Deletion events are still recorded when received, rather than confirmed synchronously against GitHub. A delayed delete can temporarily retire a live branch; the next poll checks continuity before resuming the latest identity. A delete received after restoration causes another such check. When only a SHA-less `delete` event arrives, continuity is lost, but every retained relationship stays on the retired identity. Deletion events missed beyond the recovery window cannot establish a lifecycle boundary. A replacement's intermediate workflow runs that predate a delayed deletion receipt are conservatively skipped unless their commit is its confirmed current head; re-running the full workflow on the current head remains safe.

Gallery and prototype-list queries are unchanged. `registeredAt !== null` remains the registration contract, alongside their existing repository, branch, and visibility checks.

## Artifact contracts

`replica-build-v1` contains `dist/**` and an optional `templates.json` (version 1, at most 12 entries, at most 16 KiB). Hub extracts and validates templates with the dist; the templates API is separate.

`replica-screenshots-v1` contains `screenshots/**` and `screenshots.json`, `{ "version": 1, "distDigest": "sha256:…" }`. `distDigest` is the SHA-256 of the sorted `path\0sha256\n` lines for every dist file and `templates.json`.

Both packages use the same path, size, and entry-count limits as local Builds.

## Screenshots

Each pass after the dist import also looks for screenshots. Hub attaches them only when their `distDigest` matches the successful Build. Repeated passes add no duplicates and never replace existing artifact records. Invalid packages are logged and ignored; a digest mismatch leaves screenshots unattached. A Build whose screenshots never arrive stays successful and previewable without them.

## Recovery

GitHub does not retry failed webhook deliveries, so scheduled jobs recover missed events and stalled imports. Each job is idempotent, and none deletes Builds or artifacts.

| Schedule         | Job                                   | Purpose                                                                                                                                                           |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every minute     | `recover-github-webhook-deliveries`   | Scans the App's recent webhook deliveries from a saved checkpoint and asks GitHub to redeliver workflow, installation, and access events that Hub never recorded. |
| Every 5 minutes  | `discover-github-workflow-runs`       | Polls branch heads and recent Replica workflow runs for connected repositories and enqueues unsettled runs, so Builds arrive even without webhooks.               |
| Every 5 minutes  | `retry-github-builds-awaiting-import` | Re-enqueues recent GitHub Builds whose dist import or final author and screenshot pass is still owed.                                                             |
| Every 15 minutes | `reconcile-github-installation`       | Refreshes the installation's repository list.                                                                                                                     |

Webhook redelivery covers deliveries from the past three days, the limit of GitHub's delivery history. It retries unrecorded deliveries with status 0, 401, 403, 404, 429, or 5xx, including access-removal events rejected during an authentication or routing outage. A lease lets one worker run at a time. Each missed delivery is retried at most 12 times, with backoff from one minute to one hour, and settled records are removed after 30 days. Redelivery cannot help while Hub is unreachable; discovery and retry then import the Build once Hub is back, as long as its artifact has not expired.

Discovery and retry look back three days, matching the artifacts' retention. Runs older than that, or whose artifacts expired, are not imported.

Branch polling selects a matching existing Build when a branch returns to an earlier commit; it does not invent a Build without a workflow package or delete branches. Poll observations do not replace workflow creation times or rewrite an unchanged prototype selection. Reselection retains the latest workflow timestamp and run ID so a known run's redelivery cannot undo it, while a new run can still become current. When an older installation has a selection timestamp but no saved run ID, runs with the same timestamp do not replace the selection because their order is unknown; a later timestamp can still select a Build.

Each poll bounds branch listing to ten pages of 100. Workflow discovery pages through recent runs within the recovery window, up to GitHub's 1,000-result filtered-search limit; reaching that limit reports an error instead of silently accepting a truncated list. Saved unfinished Builds are retried separately. A very busy repository can therefore outrun discovery of previously unseen runs; recovery is a safety net, not an unlimited delivery guarantee. Runs that reuse an immutable Build or have lost ownership to a newer run do not keep queuing redundant imports. Webhook imports and polling share immutable Build ownership, so whichever valid dist import commits first wins.

### Verify webhook communication

From `hub/`, using an existing authorized runtime environment:

```sh
npm run github:check-webhooks -- --repository-id GITHUB_NUMERIC_REPOSITORY_ID --run-id WORKFLOW_RUN_ID
```

This command checks App JWT signing/identity, installation access, repository-scoped Actions/Contents token access, the exact webhook URL (`HUB_APPLICATION_ORIGIN/api/github/webhooks`), JSON/TLS settings, required event subscriptions, and App delivery-history reads. It issues a short-lived installation token but does not send an event, request redelivery, change settings, or write database records. It never outputs tokens, the webhook secret, response payloads, or configured URLs.

App delivery-history endpoints use an **App JWT**, not an installation token. A successful artifact download therefore does not prove delivery-recovery access. Recovery errors distinguish HTTP rejection (including the status), transport failure, and an invalid successful response; none is silently treated as success. HTTP 401 requires checking App ID/key validity and clock, while 403 requires checking App authority and provider policy. Those statuses are evidence to investigate, not proof of one particular configuration fault.

Delivery IDs are positive int64 values and can exceed JavaScript's safe integer range. Hub preserves those JSON integer tokens as decimal strings through database storage and redelivery URLs, rather than rounding them. A schema rejection on a successful delivery-history response is not an authentication failure.

To inspect a real delivery, obtain its GUID from this repository's GitHub App delivery history and add `--delivery-guid DELIVERY_UUID`. The command only reads receipts after finding that GUID for the selected installation and repository in the latest 100 App deliveries. It uses a read-only database transaction with a five-second statement timeout. Missing or older provider history is `unknown`, not a pass. A receipt proves Hub accepted the signature and handled/enqueued the event, not that import finished. The separate repository/run Build check shows import-pass completion and Build state; polling can also have processed that run. Neither check associates the delivery with the supplied run. A `succeeded` recovery record may be settled from an existing receipt or provider delivery, so it does not prove a redelivery occurred.

For end-to-end testing, use a dedicated test installation/repository and a normal signed `workflow_run` or `workflow_job` event from its prototype workflow. Verify the GUID receipt, Build commit/run/artifact linkage, and any recovery state. GitHub's **Redeliver** action sends a real event and can enqueue imports; it needs separate production approval. A webhook ping alone does not establish workflow import or recovery. Local route and recovery tests cover signature rejection, queue failure, receipts, and redelivery without production traffic.

## Not yet implemented

Workflow-installation UI, Build start pages, and the templates API are later increments.
