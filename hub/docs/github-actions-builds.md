# Hosted Builds from GitHub Actions

Hub polls a connected GitHub App installation for branch heads and Replica Build
results. The repository builds its prototype in GitHub Actions; Hub does not
check out the repository, run its code, or expose a hosted Build webhook.

## Set up the workflow

Keep the repository in Hub's configured GitHub App installation. Grant the App
read access to **Contents** and **Actions** and approve the installation's
permission update. Hub follows push runs of `.github/workflows/replica.yml` in that
repository. Configure that workflow to use a reviewed pin of Replica's
[Build action](../../actions/build/action.yml) and run on the default branch and
other buildable branches. Exclude `replica/install-workflow`. Use
`persist-credentials: false` when checking out the repository. Hub does not
install or update the workflow.

Configure [artifact storage](artifact-storage.md), then install the schedules with
`npm run jobs:setup` and run the [scheduled worker](background-jobs.md). It polls
every five minutes. Without a configured App installation and artifact storage,
the scheduled Build poll does nothing. Local Builds keep their existing worker
and preview behavior.

## How Hub keeps history

Each successfully scanned branch head selects the Build for its exact commit.
The default branch's Builds are internal and supply Templates. Former default
branches stay internal after a rename. Other branches start as unregistered
drafts; discovering or building a branch is not registration.

A branch missing from a complete scan is not retired until its exact ref is
absent and Hub confirms it can still read the same repository. Retired
prototypes keep their Builds and registration. A returning branch that contains
the latest retired head resumes that prototype; unrelated history gets its own
draft. A workflow run cannot restore a retired branch or select the current
Build. A missed push is only discoverable if GitHub still returns its run; the
poll is not a record of every push.

Hub checks the latest 100 runs of the approved workflow and up to 100 saved
unfinished or failed runs per repository. It matches the immutable repository
ID, branch, commit and run ID. A later attempt of that same run can recover from
a failure, but cannot replace accepted successful workflow output. An unseen
run created in the same second as branch retirement cannot be assigned safely.

## How import works

For a successful workflow, Hub reads its exact attempt and selects one
unexpired `replica-build-v1` artifact created during that attempt. Older or
newer attempts' artifacts do not qualify. Hub downloads the ZIP in the worker
and never sends its App token to a redirected download host.

The [Build action](../../actions/build/scripts/create-package/index.mjs) owns
the package format. Hub expects `dist/index.html`, both root screenshots, and,
if `templates.json` declares templates, the corresponding screenshots for each
template. Dark screenshots are optional as a set, not individually. Hub checks
the archive paths, file types and checksums, validates PNGs and any Controls or
Templates metadata, and enforces the action's 25 MiB per-file, 100 MiB `dist/`
and 150 MiB unpacked package limits. GitHub retains the uploaded ZIP for three
days; the retained Build uses Hub's own storage.

The Build remains running until all files are stored and Hub commits their
artifact records and the successful state together. Missing, expired,
ambiguous or invalid packages fail without a preview. Temporary GitHub and
storage failures retry in a later poll; once Hub has selected an artifact, the
retry uses the same ID. Staged bytes are not visible through preview routes.
The existing [Build origins](build-previews.md) and access checks still apply.
