# GitHub integration

GitHub-synchronized authorization uses repository permissions as an opt-in baseline below Hub overrides. It is not repository-gated authorization: Hub links the source, chooses where synchronization applies, maps the permission, enforces staleness, and makes the final admission and prototype decisions.

## Source identity and credentials

A linked source stores GitHub's immutable repository ID, the configured App and installation IDs, the current owner, name, default branch, visibility, active, suspended, or removed state, admission switch, synchronization status, and timestamps. Admission resolves current metadata from that immutable ID before checking a user permission, so a renamed repository cannot be confused with a replacement at its old name. Public and internal sources additionally require GitHub to confirm that the user is an actual collaborator before their permission can supply admission or a prototype baseline. Rename changes mutable fields without replacing the source. Prototype source provenance is separate from build, artifact, manifest, and ingestion records.

All permission checks use an installation token created from the configured GitHub source-integration credentials. GitHub user authorization proves identity only. Hub does not retain or reuse the user's transient token for synchronization.

## Opt-in policies

`HUB_ADMISSION_POLICY=hub-managed` is the default. Select `github-synchronized` to permit linked sources to participate, then enable admission on each intended repository through the administration API. No linked or opted-in source means no synchronized admission.

Each prototype separately selects `hub-managed` or `github-synchronized`. The synchronized mode also requires one active repository source. Unlinking a source removes its synchronized baselines and leaves the prototype without a usable baseline until an administrator selects another source or returns it to Hub-managed mode.

`legacy-repository` is a compatibility policy for current Replica behavior. It scans installation repositories during sign-in and is intentionally not the default or the normal synchronized source model.

## Permission mapping

| Raw GitHub permission | Admission | Prototype baseline |
| --- | --- | --- |
| `admin`, `maintain`, `write` | Member | `editor` |
| `triage` | Member | `commenter` |
| `read` | Member | `viewer` |
| `none` or missing | Denied | None |

GitHub does not map to Hub installation administrator or prototype administrator. GitHub's built-in `role_name` takes precedence over its legacy base `permission` field, so `role_name: triage` maps to commenter even when the base permission is `read`; unknown custom roles fall back to the base permission. Explicit Hub deny wins first, followed by explicit prototype and workspace roles, then the synchronized baseline.

## Reconciliation and webhooks

`POST /api/administration/github/repositories/:repositorySourceId/reconcile` confirms repository metadata and every known GitHub identity's current collaborator permission. The API process also reconciles active sources every 15 minutes. Reconciliation repairs missed webhooks and permission changes for collaborators or teams because GitHub does not emit a complete permission-change stream.

Each reconciliation claims a monotonically increasing source generation while holding the repository row lock. Live admission permission requests use a separate generation per repository and immutable GitHub subject, so an older response cannot overwrite that user's newer positive or negative confirmation without invalidating reconciliation or another user's sign-in. After GitHub replies, Hub locks and re-reads the relevant generation and applies results only when it is still current. Unlinking, removal webhooks, relinking, dirty webhooks, and newer reconciliation or same-user admission attempts invalidate older in-flight results, so stale replies cannot reactivate a source or replace newer permissions.

`POST /api/github/webhooks` accepts only HMAC-SHA256 verified GitHub App payloads for the configured installation. An irrelevant signed event such as GitHub's initial `ping` is ignored before installation-specific validation. Relevant installation, installation-repository, repository, member, membership, and team-add events mark affected sources dirty. Repository deletion or installation removal marks synchronized records removed immediately. Installation suspension preserves linked source configuration and admission switches while revoking synchronized state; unsuspension marks those sources active and dirty for reconciliation without restoring old baselines. Delivery IDs are unique, so replayed payloads are harmless. Webhooks do not grant access by themselves; reconciliation confirms it.

## Staleness and outages

A successful confirmation records `lastConfirmedAt`, including a confirmed negative permission that invalidates an older positive cache. Credential and configuration failures record an explicit failed status without refreshing that time. Hub permits a last-known-good baseline for one day, then fails closed. Admission evaluates live and cached results per repository: a fresh denial or repository 404 removes that source's old cache, while a token-service outage may use only the still-fresh cache for a source whose configured App and installation IDs still match. Source credential failures never block an already active manual Hub member or a usable Hub invitation, but synchronized members remain fail-closed. Reconciliation bounds concurrent GitHub permission requests, treats an immutable-identity mismatch as denial for only that identity, and serializes membership removal with sign-in and administrator changes.

Scheduled reconciliation has a single-flight guard. A slow periodic run completes before another scheduled run starts; manual reconciliation still uses source generations to supersede older results safely.

Manual Hub grants, denies, membership assignments, and suspensions are separate rows. Synchronization never deletes or rewrites them. Repository unlink, installation removal, and permission loss affect synchronized rows only.

## Administration API

- `GET /api/administration/github/repositories`
- `POST /api/administration/github/repositories`
- `PATCH /api/administration/github/repositories/:repositorySourceId`
- `DELETE /api/administration/github/repositories/:repositorySourceId`
- `POST /api/administration/github/repositories/:repositorySourceId/reconcile`
- `PUT /api/prototypes/:prototypeId/authorization`
- `GET /api/prototypes/:prototypeId/access/explanation`

Administration mutations require an active installation administrator, fresh verification, the configured origin, and matching CSRF cookie and header. Repository listing requires the active administrator role but not a fresh verification because it is read-only. Product policy changes require a fresh effective prototype administrator. Request bodies are omitted from logs, responses are private and non-cacheable, and mutations write structured audits in the same transaction.
