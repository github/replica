# Prototype authorization

Hub owns prototype access after authentication and installation admission. A user does not need repository access to use a Hub-managed prototype. A prototype can explicitly select a linked GitHub repository as a synchronized baseline, but Hub remains the final evaluator.

## Product records

A workspace owns prototypes. A prototype owns an ordered history of immutable versions.

- An active installation administrator may create a workspace. Creation also writes an explicit workspace `administrator` grant for that user in the same transaction.
- A workspace `editor` or `administrator` may create a prototype.
- A prototype `editor` or `administrator` may create its next version.
- A version cannot move to another prototype or be changed after creation.
- Archiving a prototype keeps its versions readable but prevents new versions. Archive and version creation lock and re-read the prototype so overlapping requests cannot add a version after archival.

Artifact payloads are not part of this layer. A version identifies immutable prototype history without storing a build, manifest, or upload.

## Roles

| Role | Product authority |
| --- | --- |
| `viewer` | Read the authorized workspace, prototype, and versions. |
| `commenter` | Includes viewer authority and reserves the role for future review comments. |
| `editor` | Includes commenter authority, creates prototypes within an authorized workspace, creates versions, and archives prototypes. |
| `administrator` | Includes editor authority and changes direct access rules. |

Installation membership and installation administrator status do not grant access to existing workspaces or prototypes. The workspace-creation rule is the only installation-administrator product rule in this layer. After creation, the user's explicit workspace grant supplies authority.

## Hub overrides, synchronized baselines, and precedence

Hub stores one direct workspace rule and one direct prototype rule per user and scope. A rule is either an explicit deny or an allowed role. Removing a rule restores evaluation from the remaining sources.

Each prototype starts in `hub-managed` mode. An administrator may explicitly select `github-synchronized` mode and one active linked repository source. There is no implicit fallback from missing Hub access to GitHub.

The evaluator applies this order:

1. An explicit Hub deny at either the workspace or prototype scope denies access.
2. An explicit prototype role applies, including a lower role that intentionally restricts a stronger workspace role.
3. An explicit workspace role applies.
4. A fresh GitHub-synchronized baseline may apply.
5. Otherwise Hub denies access.

Every decision reports whether access is allowed, the effective role, the source, and a stable reason. GitHub baseline decisions also report the repository source, immutable GitHub repository ID, raw permission, last confirmation time, and synchronization status. Routes use this evaluator instead of reimplementing precedence. Hub consults the synchronized baseline only when explicit Hub rules produce no decision, so an unavailable lower-precedence source cannot block an explicit deny or role. Prototype listing checks workspace access independently of the current page, so an authorized user receives an empty terminal page instead of an authorization error.

The fixed mapping is:

| GitHub permission | Hub prototype baseline |
| --- | --- |
| `admin`, `maintain`, `write` | `editor` |
| `triage` | `commenter` |
| `read` | `viewer` |
| `none` or missing collaborator | No access |

GitHub never supplies Hub `administrator` authority. Manual workspace and prototype grants and denies live in separate tables and synchronization does not update or delete them. Converting a synchronized member to manual membership because a Hub administrator grants product administration writes a structured membership-preservation audit in the same transaction.

Workspace administrators cannot remove or replace the final active workspace administrator. A prototype access change must also leave at least one active effective prototype administrator. Hub locks the owning records before checking these invariants, so overlapping changes cannot each remove a different final administrator. Suspended and removed users do not satisfy either invariant.

Suspending or removing a membership fails with `product_administration_orphaned` when that user is the final active administrator for a workspace or prototype. An administrator must transfer product administration first. Changing an active installation administrator to a member does not remove an explicit product role, because installation and product authority remain separate.

A workspace administrator can recover prototype access even when a prototype-specific administrator rule does not exist. Explicit prototype deny still blocks that administrator from the denied prototype until another workspace administrator changes the rule. Prototype lists omit prototypes that explicitly deny the requesting user. A workspace reachable through a direct prototype rule or synchronized prototype baseline is also readable, unless an explicit workspace deny blocks it. Workspace list responses contain only workspace fields and never embed prototype or access-rule metadata.

## API and request boundaries

The product API uses:

- `GET` and `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId`
- `PUT` and `DELETE /api/workspaces/:workspaceId/access/:userId`
- `GET` and `POST /api/workspaces/:workspaceId/prototypes`
- `GET /api/prototypes/:prototypeId`
- `POST /api/prototypes/:prototypeId/archive`
- `PUT /api/prototypes/:prototypeId/authorization`
- `GET /api/prototypes/:prototypeId/access/explanation`
- `PUT` and `DELETE /api/prototypes/:prototypeId/access/:userId`
- `GET` and `POST /api/prototypes/:prototypeId/versions`
- `GET /api/prototypes/:prototypeId/versions/:versionId`

List routes use an opaque UUID cursor and a limit from 1 through 100. Prototype and version cursors belong to their owning workspace or prototype; a cursor from another scope is invalid. Invalid pagination returns `422 invalid_pagination`, while malformed or missing path resources return their resource-specific `404` error. State-changing requests require the configured origin and matching CSRF cookie and header. Product responses are private and non-cacheable, request payloads are omitted from logs, and mutation routes use a bounded rate limit.

Every product route restores the current session and active installation membership before evaluating product access. Workspace creation and direct access changes also require identity verification from the last five minutes. Mutations repeat the membership check inside their database transaction so a suspended or removed actor cannot complete a stale request.

## Audits

Workspace creation, prototype creation and archival, version creation, role grants, explicit denies, and rule removal write structured security audits in the same transaction as the product change. A failed audit rolls back the product change.

Records identify the actor, session, authentication-provider revision, affected product records, target user when applicable, outcome, and a bounded reason. They do not include cookies, provider tokens, host secrets, request bodies, prototype artifacts, or mutable identity labels.

## Synchronization lifecycle

The [GitHub integration](github-integration.md) confirms permissions with installation credentials. Webhooks only mark relevant sources dirty or removed; periodic or manual reconciliation repairs missed events and confirms current permissions. A failed provider call does not refresh confirmation. Baselines remain usable only inside the configured one-day last-known-good window and fail closed afterward.

Repository rename changes mutable owner, name, and default-branch fields without changing the immutable source identity. Repository removal, installation removal, and permission loss update synchronized baselines only. Direct Hub overrides remain intact.

Source mutation, public links, artifact ingestion, promotion, retention, and rollback remain separate product boundaries.
