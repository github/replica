# Build discovery

Hub records each non-default branch as a Prototype candidate and builds the repository's default branch for **Templates**. When either branch points to a new commit, Hub creates one Build record for the exact commit. In the GitHub-backed flow, Hub follows the matching GitHub Actions run and stores its output. Only prototype branches registered by a repository writer appear in the gallery. Production usually learns about branch changes from GitHub notifications; GitHub-backed development and recovery use polling.

```text
New commit on a prototype branch
        |
        v
Hub creates a Build for that exact commit
        |
        v
Hub finds the matching GitHub Actions run
        |
        +-- run fails ----> Hub marks the Build failed
        |
        +-- run succeeds -> Hub stores its files -> reviewers can open the preview
```

## Matching Builds

Hub gives each Prototype a stable identity and records each commit within that identity as one Build. When a webhook or poll reports the same commit again for that Prototype, Hub reuses its Build. A branch name is a reusable label, with at most one active Prototype for that name in a repository.

Renaming a branch creates a new Prototype. For GitHub repositories, confirmed branch deletion retires its Prototype from Prototypes and the registered management list. Hub keeps its metadata and registration. It also retains Builds, comments, and share links. Existing review and history URLs still refer to that exact Prototype under their usual access and retention rules. Merging or closing a pull request without deleting its branch does not retire it. Local-mode behavior is unchanged.

For example, if Hub retires `prototype/welcome` at commit A and that name returns at A or a descendant of A, Hub resumes its previous identity and registration. If the new head does not contain A, Hub creates a separate unregistered Prototype. A shared ancestor alone is insufficient. Rebased or rewritten history that no longer contains A is separate, even if it looks similar. A new history follows the existing registration rules. Automatic registration still requires its own successful Build.

Hub compares the confirmed current GitHub head only with the saved head of the most recently retired Prototype for that branch name. It never searches older histories for a match. If the latest retired record never had an observed branch head, the returning branch starts separately. If a known head cannot be checked because GitHub fails or returns malformed data, discovery reports an error and leaves ownership unchanged.

This split happens only after Hub records retirement. Ordinary force pushes on an active Prototype keep its identity. A delete and recreation entirely between Hub observations can be missed. An old head inherited through the default branch still qualifies as ancestry; Hub does not infer human intent.

Until a reviewable Prototype has a start-page setting, discovery queues a separate metadata lookup for `.prototype` at the Build's exact commit SHA. Default-branch Builds never read `.prototype` and always open at `/`. GitHub repositories use the existing installation-scoped contents API; local-mode repositories read the committed Git blob, not working-tree changes. This needs no build Action or artifact-format update.

Only a bounded JSON file (16 KiB maximum) with a valid local `startPage` route is imported. Missing or invalid files are checked once per commit; later commits can correct them. Temporary lookup failures retry. A delayed lookup from an older branch head cannot win over a newer head, and an explicit Hub edit wins over an in-flight lookup. Once Hub owns a value, including an explicit clear, discovery stops requesting metadata.

## Discovery rules

Hub records Builds only for active repositories. Every branch except the reserved `replica/install-workflow` installation branch can have Builds. Non-default branches stay out of the gallery until someone with repository write access adds them to Hub. Hub still discovers their Builds and allows access through direct links under the usual repository access checks. To add a branch, Hub checks current write access and that the branch still exists, not who authored its commits. See [Gallery](gallery.md#add-a-prototype-to-the-gallery).

The default branch uses an internal, unregistered branch record to own its immutable Builds. It is not a user-facing Prototype. Hub excludes it from registration, gallery, candidates, prototype pages, review requests, canvas status, public shares, and prototype publication analytics. A default-branch rename selects a different Build owner. Hub does not show the old default's successful Build while waiting for the new default's first Build. Former default owners remain internal even if their branches still exist; a previously registered branch that becomes the default loses its registration. Repository synchronization saves internal owners for both names during a rename, even before either branch has a Build, so delayed discovery cannot turn the former default into a prototype.

GitHub notifications are also called webhooks.

| Source                   | What it tells Hub                           |
| ------------------------ | ------------------------------------------- |
| Push webhook             | A default or prototype branch moved, or a prototype branch was deleted |
| Branch poll              | The current commit on each buildable branch |
| Workflow webhook or poll | The status of a GitHub Actions run          |

Production and GitHub-backed development poll every five minutes as a fallback. Each poll refreshes installed repositories, then reads branch heads and recent workflow runs.

Deletion notifications and polls require a complete, validated branch scan. Hub corroborates an omitted active prototype with an exact reference lookup and confirms the readable repository's identity after a reference 404. Failed requests, malformed data, or lost access are not branch deletion. Captured Prototype identities and head-observation revisions prevent delayed scans from changing a newer accepted owner or head.

[Automatic webhook redelivery](security-rate-limits.md#automatic-github-redelivery) separately recovers supported failed deliveries within GitHub's three-day window. Polling reports current state, not a complete history of missed events.

A recovered push records the original commit in history. It changes the current Build only when a fresh GitHub branch lookup still reports that commit and no later local head observation was recorded during the lookup. A live push or poll blocks that promotion even if it repeats the same commit or moves away and back to an existing Build. Hub counts each accepted head observation separately from Build identities; historical discoveries and rejected recovery promotions do not advance that count.

After retirement, push discovery verifies the current reference before changing branch ownership. A historical push can update a known retained Build but cannot select a replacement Prototype merely by branch name. A matching commit alone does not prove that a push belongs to the active history. Hub records its predecessor only when the push matches an accepted head change within that history; the change still skips its proven older queued Builds.

Workflow events remain attached to their saved run identity. A newer attempt of a saved run stays on that run's Build and history; see [GitHub Actions builds](github-actions-builds.md#how-hub-follows-the-workflow) for how it recovers a failed Build. Previously unseen historical runs use their GitHub creation time to select the retained history. Hub selects that history together with the Build so a concurrent branch replacement cannot claim an older run. A workflow event alone never revives a retired Prototype. Branch-based canvas status selects only the active Prototype, while links by Prototype identity keep their original history.

GitHub reports workflow creation times to the second. If an unseen run falls in the same second as retirement, Hub cannot safely tell which history created it, even when its commit matches the active head. Hub reports an error and leaves both histories unchanged. Webhook processing stays retryable, but retrying the same ambiguous run does not resolve its ownership. A saved run identity still selects its original Build; later unambiguous runs can build normally.

Hub keeps Build numbers stable as identifiers, even when GitHub reports an older workflow after a newer one. The observed branch head decides the current Build, and GitHub's workflow creation time orders Build history and successful previews. Builds without a recorded workflow use the time Hub first discovered them until GitHub reports the matching run.

Build history and Build details open inside the prototype workspace, with the same branch header and repository navigation as the preview. History uses the Activity timeline in chronological order. Its Build links, pagination links, and header actions navigate without replacing the workspace chrome.

## When a newer commit arrives

If another commit reaches a prototype branch before its previous Build starts, Hub skips the older queued Build and queues a Build for the new commit. The skipped Build stays in the history with the `superseded` state.

```text
Older Build is queued
        |
New commit is pushed to the same branch
        |
        +-- older Build -> superseded and kept in history
        |
        +-- new Build ----> queued
```

A Build that has already started continues running.

## Operations

Run a poll immediately:

```sh
bin/devcontainer exec bin/rails replica:github:poll
```

Repository writers can also request a poll from the repository page. Hub checks their current GitHub access first.

Hub follows the GitHub Actions workflow for each Build. If the workflow fails, Hub marks the Build failed and provides no preview. If it succeeds, Hub downloads the artifact and stores its files for the preview. See [GitHub Actions builds](github-actions-builds.md).

In [development-only local mode](local-development.md), a recurring scan reads default and other local Git branch heads once a minute and builds new commits without a GitHub workflow. Unchanged heads do not queue more Builds. Hub keeps the resulting Builds and previews in local storage.
