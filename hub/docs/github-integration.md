# GitHub integration

GitHub-synchronized authorization uses repository permissions as an opt-in baseline below Hub overrides. It is not repository-gated authorization: Hub links the source, chooses where synchronization applies, maps the permission, enforces staleness, and makes the final admission and prototype decisions.

## Source identity and credentials

A linked source stores GitHub's immutable repository ID, the configured App and installation IDs, the current owner, name, default branch, active or removed state, admission switch, synchronization status, and timestamps. Rename changes mutable fields without replacing the source. Prototype source provenance is separate from build, artifact, manifest, and ingestion records.

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

GitHub does not map to Hub installation administrator or prototype administrator. Explicit Hub deny wins first, followed by explicit prototype and workspace roles, then the synchronized baseline.

## Reconciliation and webhooks

`POST /api/administration/github/repositories/:repositorySourceId/reconcile` confirms repository metadata and every known GitHub identity's current collaborator permission. The API process also reconciles active sources every 15 minutes. Reconciliation repairs missed webhooks and permission changes for collaborators or teams because GitHub does not emit a complete permission-change stream.

`POST /api/github/webhooks` accepts only HMAC-SHA256 verified GitHub App payloads for the configured installation. Relevant installation, installation-repository, repository, member, membership, and team-add events mark affected sources dirty. Repository or installation removal marks synchronized records removed. Delivery IDs are unique, so replayed payloads are harmless. Webhooks do not grant access by themselves; reconciliation confirms it.

## Staleness and outages

A successful confirmation records `lastConfirmedAt`. Failed provider calls record a bounded failure status and leave that time unchanged. Hub permits a last-known-good baseline for one day, then fails closed. Reconciliation also removes synchronized memberships and sessions when no fresh admission-eligible source remains.

Manual Hub grants, denies, membership assignments, and suspensions are separate rows. Synchronization never deletes or rewrites them. Repository unlink, installation removal, and permission loss affect synchronized rows only.

## Administration API

- `GET /api/administration/github/repositories`
- `POST /api/administration/github/repositories`
- `PATCH /api/administration/github/repositories/:repositorySourceId`
- `DELETE /api/administration/github/repositories/:repositorySourceId`
- `POST /api/administration/github/repositories/:repositorySourceId/reconcile`
- `PUT /api/prototypes/:prototypeId/authorization`
- `GET /api/prototypes/:prototypeId/access/explanation`

Administration mutations require an active installation administrator, fresh verification, the configured origin, and matching CSRF cookie and header. Product policy changes require a fresh effective prototype administrator. Request bodies are omitted from logs, responses are private and non-cacheable, and mutations write structured audits in the same transaction.
