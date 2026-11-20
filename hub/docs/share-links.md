# Build share links

Public share links open one successful, immutable Build without sign-in. They do not grant access to repository pages, Build history, reviews, or Hub navigation.

## Local mode

Public sharing is disabled by default. The local developer is a Hub administrator and can enable it from **Public sharing** at `/settings/sharing`. The API checks the live administrator session again before changing the setting.

Local mode does not require a GitHub App. Its policy and links are separate from hosted sharing.

## Hosted opt-in

Hosted public sharing is off by default. It requires configured Build storage and an isolated preview origin, GitHub sign-in, and a fresh GitHub repository-permission lookup. To opt in, set `HUB_HOSTED_PUBLIC_SHARING_ENABLED=true` on every API instance before starting them. To turn sharing off, restart the API instances with the setting unset or set to `false`. A hosted deployment has no browser switch: a live Hub administrator session alone is not fresh authorization to make this change.

The prototype's **Share links** action requires a GitHub session and one of these permissions:

- GitHub currently reports repository administrator permission.
- The signed-in user is the prototype's stored owner, at least one successful Build records that GitHub identity as its commit author, and GitHub currently reports at least read access.

Hub matches the recorded provider, issuer, and immutable GitHub user ID, not the login. Commit attribution alone does not assign ownership or authorize sharing. Ownerless imported prototypes therefore require repository administrator permission. Existing owners are retained; the schema does not independently record or re-attest the source of historical owner assignments. Repository write access, a Hub administrator role, or an Entra session does not substitute for either rule. The API rechecks permission for each list, create, and revoke request. The browser lists only active hosted links.

An explicit `none` result for the expected GitHub identity permanently revokes only that creator's links in that repository. Confirmed GitHub App disconnection revokes all hosted links for the affected repositories. Unavailable or ambiguous evidence denies management without revoking links. Public visits do not call GitHub, and some webhook events narrow signed-in access without proving a creator lost all access. Sharing does not promise immediate detection of creator access loss.

## Permanent revocation

Disabling a policy advances its revision and permanently revokes its links in one database transaction. Public pages, pending preview grants, existing public preview cookies, files, browser routes, and Controls stop working when they next check the saved link. Enabling sharing later permits new links only.

Creation verifies the policy again before saving. Hosted creation also checks that no confirmed access change invalidated the earlier GitHub lookup. A disable and re-enable cycle cannot authorize a request that began under the earlier policy. Bytes already returned cannot be recalled.

## Link lifecycle

An authorized user can manage links from a prototype's **Share links** page. Only successful Builds with a saved `dist/index.html` artifact are available. Each link:

- uses a random UUID that reveals no repository or Build identity;
- remains pinned to the selected Build when newer Builds arrive;
- stores a trimmed label of at most 100 UTF-8 bytes;
- expires after an allowed lifetime;
- retains a revocation tombstone so it cannot return.

The default maximum lifetime is seven days. Set `HUB_SHARE_LINK_MAX_DAYS` to `1`, `7`, or `30` before startup to change the allowed choices. Invalid values stop startup. Startup permanently shortens saved deadlines that exceed the configured maximum, measured from the original creation time; a later increase never extends them.

Expired, revoked, disabled, or unavailable hosted links return not found. Local mode keeps its expired, revoked, and disabled presentation states and lists inactive rows while sharing is enabled.

## Public preview boundary

Public shares still require `HUB_PREVIEW_ORIGIN` and its wildcard DNS/TLS configuration. Private [path-based previews](build-previews.md) do not replace this flow or make it available without that configuration. Moving public sharing to a separate service is outside the private-preview change. A fixed-base package is not automatically portable to a wildcard root or another pathname; share such a Build only when its app supports that address.

`GET /api/shared/:shareId` requires no Hub session. An active response contains only the saved label, prototype display name, Build number, expiration, Controls identity, and a preview authorization URL. It never includes repository identifiers, navigation, comments, screenshots, users, or Hub-session data.

The authorization URL redirects to the existing Build-specific preview origin. A two-minute encrypted public grant is bound to the share link and Build. The preview origin exchanges it for a `replica_share_preview` cookie, limited to eight hours or the link deadline, whichever comes first. Hub sessions do not authorize that public preview, and the public cookie does not authorize signed-in Hub routes or private preview paths.

Public previews reuse the same artifact lookup, path validation, content types, SPA fallback, security headers, HTML bridge injection, and Controls runtime as signed-in previews. The serving path rechecks the share link and deployment setting for every request and after artifact storage returns, so revocation, expiration, disablement, Build removal, and artifact unavailability stop later responses without a second file-serving implementation.

## Not included

This flow does not add GitHub account monitoring, Canvas share APIs, notifications, or new deployment infrastructure. Publishing a Build can expose sensitive content included in its files; check the Build itself before creating a public link.
