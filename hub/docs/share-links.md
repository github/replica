# Local Build share links

Local-mode sharing lets a signed-in local developer create an opaque public URL for one successful immutable Build. It does not require a GitHub App, discover hosted repositories, or grant access to repository pages, Build history, reviews, or Hub navigation.

## Deployment setting

Public sharing is disabled by default. The local developer is a Hub administrator and can enable it from **Public sharing** at `/settings/sharing`. The API checks the live administrator session again before changing the setting.

Disabling sharing increments the saved policy revision and permanently revokes every existing link in the same database transaction. Public pages, pending preview grants, existing public preview cookies, files, browser routes, and Controls stop working when they next check the saved link. Enabling sharing later permits new links only.

Creation captures the current policy revision before it validates the Build, then verifies that same enabled revision in the creation transaction. A disable and re-enable cycle cannot authorize a request that began under the earlier policy. Public preview authorization checks the link again, and artifact serving checks it before and after reading saved bytes. Bytes already returned cannot be recalled.

## Link lifecycle

A signed-in local-mode user can manage links from a prototype's **Share links** page. Only successful Builds with a saved `dist/index.html` artifact are available. Each link:

- uses a random UUID that reveals no repository or Build identity;
- remains pinned to the selected Build when newer Builds arrive;
- stores a trimmed label of at most 100 UTF-8 bytes;
- expires after an allowed lifetime;
- retains a revocation tombstone so it cannot return.

The default maximum lifetime is seven days. Set `HUB_SHARE_LINK_MAX_DAYS` to `1`, `7`, or `30` before startup to change the allowed choices. Invalid values stop startup. Startup permanently shortens saved deadlines that exceed the configured maximum, measured from the original creation time; a later increase never extends them.

Known links can report expired, revoked, or disabled presentation states. Unknown opaque IDs and unavailable saved Builds return not found. While sharing is enabled, the management page keeps expired and revoked rows for local visibility. Disabled sharing removes creation controls and remembered public URLs.

## Public preview boundary

`GET /api/shared/:shareId` requires no Hub session. An active response contains only the saved label, prototype display name, Build number, expiration, Controls identity, and a preview authorization URL. It never includes repository identifiers, navigation, comments, screenshots, users, or Hub-session data.

The authorization URL redirects to the existing Build-specific preview origin. A two-minute encrypted public grant is bound to the share link and Build. The preview origin exchanges it for a separate `replica_share_preview` cookie, limited to eight hours or the link deadline, whichever comes first. The authenticated `replica_preview` cookie is not accepted as public authorization, and the public cookie does not authorize signed-in Hub routes.

Public previews reuse the same artifact lookup, path validation, content types, SPA fallback, security headers, HTML bridge injection, and Controls runtime as signed-in previews. The serving path rechecks the share link and deployment setting for every request and after artifact storage returns, so revocation, expiration, disablement, Build removal, and artifact unavailability stop later responses without a second file-serving implementation.

## Not included

This local flow does not implement GitHub authorization, creator permission monitoring, review comments, Canvas share APIs, notifications, repository discovery, or hosted deployment sharing.
