# Prototype authorization

Hub owns prototype access after authentication and installation admission. A user does not need repository access to use a Hub-managed prototype, and GitHub repository permissions do not grant Hub access.

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

## Direct access and precedence

Hub stores one direct workspace rule and one direct prototype rule per user and scope. A rule is either an explicit deny or an allowed role. Removing a rule restores evaluation from the remaining sources.

The evaluator applies this order:

1. An explicit Hub deny at either the workspace or prototype scope denies access.
2. An explicit prototype role applies, including a lower role that intentionally restricts a stronger workspace role.
3. An explicit workspace role applies.
4. A future optional synchronized baseline may apply.
5. Otherwise Hub denies access.

Every decision reports whether access is allowed, the effective role, the source, and a stable reason. Routes use this evaluator instead of reimplementing precedence. Hub consults an optional baseline only when explicit Hub rules produce no decision, so an unavailable lower-precedence source cannot block an explicit deny or role. Prototype listing accepts that baseline policy source and checks workspace access independently of the current page, so an authorized user receives an empty terminal page instead of an authorization error. This release does not supply a synchronized baseline. Future GitHub synchronization must remain below explicit Hub deny and explicit Hub role rules.

Workspace administrators cannot remove or replace the final active workspace administrator. A prototype access change must also leave at least one active effective prototype administrator. Hub locks the owning records before checking these invariants, so overlapping changes cannot each remove a different final administrator. Suspended and removed users do not satisfy either invariant.

Suspending or removing a membership fails with `product_administration_orphaned` when that user is the final active administrator for a workspace or prototype. An administrator must transfer product administration first. Changing an active installation administrator to a member does not remove an explicit product role, because installation and product authority remain separate.

A workspace administrator can recover prototype access even when a prototype-specific administrator rule does not exist. Explicit prototype deny still blocks that administrator from the denied prototype until another workspace administrator changes the rule. Prototype lists omit prototypes that explicitly deny the requesting user. Workspace list responses contain only workspace fields and never embed prototype or access-rule metadata.

## API and request boundaries

The product API uses:

- `GET` and `POST /api/workspaces`
- `GET /api/workspaces/:workspaceId`
- `PUT` and `DELETE /api/workspaces/:workspaceId/access/:userId`
- `GET` and `POST /api/workspaces/:workspaceId/prototypes`
- `GET /api/prototypes/:prototypeId`
- `POST /api/prototypes/:prototypeId/archive`
- `GET /api/prototypes/:prototypeId/access/explanation`
- `PUT` and `DELETE /api/prototypes/:prototypeId/access/:userId`
- `GET` and `POST /api/prototypes/:prototypeId/versions`
- `GET /api/prototypes/:prototypeId/versions/:versionId`

List routes use an opaque UUID cursor and a limit from 1 through 100. Invalid pagination returns an explicit error. State-changing requests require the configured origin and matching CSRF cookie and header. Product responses are private and non-cacheable, request payloads are omitted from logs, and mutation routes use a bounded rate limit.

Every product route restores the current session and active installation membership before evaluating product access. Workspace creation and direct access changes also require identity verification from the last five minutes. Mutations repeat the membership check inside their database transaction so a suspended or removed actor cannot complete a stale request.

## Audits

Workspace creation, prototype creation and archival, version creation, role grants, explicit denies, and rule removal write structured security audits in the same transaction as the product change. A failed audit rolls back the product change.

Records identify the actor, session, authentication-provider revision, affected product records, target user when applicable, outcome, and a bounded reason. They do not include cookies, provider tokens, host secrets, request bodies, prototype artifacts, or mutable identity labels.

## Deferred policy sources

GitHub repository synchronization, webhooks, reconciliation, and repository-to-role mapping are not implemented. They may later produce an optional baseline role without changing Hub's direct-rule precedence. Source-provider mutations, public links, artifact ingestion, promotion, retention, and rollback remain separate product boundaries.
