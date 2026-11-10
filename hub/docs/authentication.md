# Authentication and Hub sessions

Hub exposes same-request GitHub and Microsoft Entra sign-in flows. An installation may configure either or both providers. The provider proof remains internal; each callback immediately rereads authoritative records, applies current provider evidence, decides admission, and issues a Hub session when access is allowed. Hub never falls back from one provider to another.

## Proof flow

The start primitive selects the configured provider revision, snapshots the global session revocation revision, creates opaque state, browser binding, PKCE verifier, and nonce, and persists one short-lived authorization attempt. PostgreSQL owns attempt creation, expiry, locking, and one-use consumption time. The stored attempt contains digests plus encrypted verifier and nonce state, not raw state, browser binding, or provider tokens.

GitHub and Entra adapters are defined in code, not discovered from database records. Startup validates every configured adapter before one serializable transaction creates, selects, enables, or disables provider revisions. Operators do not seed provider rows. Failed validation or reconciliation leaves every current provider selection unchanged. Removing a previously selected provider disables its authority and advances the global session revocation revision. Re-enabling it requires the next consecutive provider revision, even when its validated configuration is otherwise unchanged, so previous-version replicas also reject pre-removal attempts.

Increment `GITHUB_PROVIDER_REVISION` when an intentional provider configuration or credential generation change must invalidate in-flight attempts and stale replicas, and before re-enabling a removed provider. Keep the revision unchanged for an ordinary restart with the same validated enabled provider settings.

The completion primitive consumes the browser-bound attempt before provider work, confirms that the selected provider revision and digest match the local validated adapter, and requires the attempt's global revocation revision to remain current before and after the provider exchange. It then validates provider evidence. External identity resolution runs in a serializable transaction that locks the provider, global revocation state, and consumed attempt in admission order before creating identity records. GitHub's numeric user ID is its immutable subject. Entra uses canonical issuer plus `sub`; signed tenant `oid` is assignment provenance. Profile and presentation data are outside this foundation.

Completion returns a minimal provider-neutral proof value in memory containing only the consumed authorization attempt ID and resolved external identity ID. This value is internal-only, is not a session or authority, and is never reconstructed from browser request data.

The callback passes that value directly to admission in the same process. Entra completion passes current app-role evidence and the signed token issue time beside the minimal proof, not inside it. Admission rereads the immutable external identity and locks the consumed attempt, selected provider revision, global session revocation state, provider-evidence order, membership, and active assignments before changing authority or creating a session. Older signed evidence is denied before authority mutation or session issuance. Evidence with the same issue time is accepted only when it strictly reduces authority; identical evidence, conflicting evidence, and authority increases are denied, including after assignment revocation or supersession.

## Admission

Normal GitHub sign-in requires an active membership with an active assignment. Entra may create an active membership and provider-owned assignment from exact `Hub.User` or `Hub.Administrator` evidence. `Hub.Administrator` wins when both values are present. Suspended and removed memberships remain denied.

One provider assignment is active for an external identity. Hub persists the newest signed evidence marker independently from assignment lifecycle so stale callbacks cannot recreate revoked or downgraded authority. When revocation leaves no authority, the ordering marker, transition, session termination, and denial audit commit together without a new session. Bootstrap assignments remain separate, and provider evidence never rewrites Hub-owned provenance. See [Microsoft Entra OIDC](entra-oidc.md#app-roles-and-membership) for the assignment-version triggers, when role changes become observable, when bootstrap authority may still admit the user, and how long sessions can remain valid.

The administrator enrollment start requires `HUB_BOOTSTRAP_SECRET` before OAuth begins. The configured secret must contain at least 32 characters and is compared in constant time. The secret authorizes each browser-bound, one-use authorization attempt; it is not stored, audited, logged, or globally consumed.

A started enrollment stores only a digest of the configured bootstrap secret. Rotating the secret automatically invalidates enrollment attempts that have not completed, while normal sign-in attempts remain unaffected.

A successful enrollment creates or restores an active administrator assignment owned by the verified external identity. The same secret can enroll another administrator or restore a previous administrator, including when another administrator still exists. Repository permissions do not affect Hub admission.

Membership lifecycle and assignment provenance are separate. The schema supports active, suspended, and removed memberships, bootstrap-owned administrators, administrator-managed designations, and Entra-owned member or administrator assignment versions. Hub does not provide generic manual assignment administration.

Membership ownership and creation history are immutable. Bootstrap enrollment writes a separate membership-created or membership-restored audit whenever it changes membership lifecycle; an already active membership creates no duplicate lifecycle audit.

## Administrator management authority

An effective administrator may designate one to 50 existing active Hub memberships as administrators. Hub records each designation as a separate `HUB_ADMINISTRATOR` assignment, without changing bootstrap or authentication-provider assignments. Revocation ends only the active administrator-managed assignment, so another active source can continue to provide administrator authority.

The domain accepts membership UUIDs, rereads provider and actor authority inside a serializable transaction, and rejects missing or inactive targets, targets without an external identity, repeated role changes, and removal of the final effective administrator. Bulk designation, assignment changes, target-session termination, and their success audits commit atomically. Self-removal is allowed when another effective administrator remains. Terminal denials and failures are audited only after the rejected transaction rolls back.

Effective administrator listing, counting, admission, and session restoration include active administrator-managed assignments. Authentication-provider assignments count only while their provider revision remains selected and enabled.

Administrator role changes use the provider recorded on the current Hub session. A five-minute sensitive authorization binds that live session, its external identity, the exact operation, and the ordered target membership UUIDs to one normal authorization attempt. GitHub and Entra reuse the existing state, browser binding, PKCE, nonce, provider revision, callback, and rate-limit machinery. Entra requires a new provider login; GitHub repeats its user authorization flow. Hub does not fall back to another configured provider.

The callback must receive the original Hub session cookie and prove the same external identity. It rereads the session, provider selection, global revocation revision, membership lifecycle, and effective administrator authority before marking the authorization verified. Continuing rereads and locks the server-owned authorization, requires an exact operation and target match, consumes it once, and runs the administrator mutation in the same serializable transaction. Expired, cancelled, reused, stale-role, and final-administrator cases return explicit conflicts. Browser timestamps and submitted operation details never establish freshness or authority.

## Browser session

Hub creates a fresh opaque session value only after admission succeeds. The browser receives the value in an `HttpOnly`, `SameSite=Lax` cookie with a bounded lifetime; HTTPS origins also set `Secure`. The database stores only its SHA-256 digest.

Every current-session restore rereads the global revocation revision, session expiry and termination state, membership lifecycle, and active assignments, then returns the current effective member or administrator role. Provider-owned authority is active only while its provider remains enabled and its revision remains selected. A retained cookie stops authorizing access after sign-out, expiry, suspension, removal, assignment revocation, provider removal, or a global revision change. Provider revision replacement removes authority from the old revision and stops the cookie only when no other active authority remains.

These expiry, lifecycle, assignment, provider, and global-revision checks are enforced when read. Current Entra evidence may supersede or revoke its own provider assignment and end that membership's sessions; this version does not expose general membership lifecycle operations. The [Entra operator guide](entra-oidc.md#app-roles-and-membership) owns the provider-specific observation and revocation contract.

The migration owns the single global revocation row. Its identity and history are immutable, its revision can only increment by one, and runtime code never recreates a missing row. Admission and restoration fail closed when that authority is missing. Admissions use shared locks for provider selection and revocation authority so unrelated users can proceed concurrently while authority mutations wait.

`GET /api/auth/session` restores the current session. `POST /api/auth/session/sign-out` ends it and clears the cookie. Hub does not issue refresh tokens, perform provider logout, or support step-up authentication.

## HTTP boundary

`POST /api/auth/github/start` begins normal sign-in. `POST /api/auth/github/admin-enrollment/start` verifies the reusable bootstrap secret before beginning administrator enrollment. `GET /api/auth/github/callback` consumes GitHub's callback and redirects with a generic success or denial result.

`POST /api/auth/entra/start`, `POST /api/auth/entra/admin-enrollment/start`, and `GET /api/auth/entra/callback` provide the equivalent explicit Entra flow. Entra administrator enrollment requests a fresh provider login and requires signed `auth_time` evidence from after the saved attempt start.

Administrator management exposes:

- `GET /api/administrators?limit=&before=` for a maximum of 50 effective administrators. `before` is the opaque cursor returned by the previous response.
- `GET /api/administrators/candidates?query=&limit=` for a maximum of 50 active non-administrators matched against their latest authenticated provider login or name.
- `POST /api/administrators/authorizations/start` with an operation and one to 50 target membership UUIDs. It returns the current session provider's `authorizationUrl`, the authorization UUID and expiry while setting the existing browser-binding cookie. The browser navigates to that URL.
- `GET /api/administrators/authorizations/:id` for the verified, unconsumed confirmation contract.
- `POST /api/administrators/authorizations/continue` with the authorization UUID and the exact operation and targets.
- `POST /api/administrators/authorizations/cancel` with the authorization UUID.

All administrator routes require a live effective-administrator session. Mutations require the exact configured application origin. The start and provider callback use the existing database-backed authentication rate limits. Responses use `400` for invalid bounded input, `403` for missing current authority, `409` for stale or conflicting operations, `410` for an unavailable confirmation, and `429` for exhausted authorization attempts.

Start and sign-out requests require the exact configured application origin. Authentication routes use database-backed per-address-digest rate limits, disable response storage, and omit query, form, and cookie payloads from request completion logs. Callback rate limiting runs before callback parsing.

The address digest uses the trusted client address. Behind a protected proxy, configure `HUB_TRUSTED_PROXY_HOPS` to the exact proxy-chain length; leaving it at zero intentionally treats the proxy as the client and shares one rate-limit budget across traffic from that proxy.

Consumed attempts remain available as short-lived protocol state for ten minutes after consumption so a trusted same-request consumer can reread them. Cleanup removes expired unconsumed attempts and consumed attempts after that fixed retention window; this is not authentication history.

Administrator-enrollment rate limits write at most one durable denial audit for each address-digest window. The first-denial marker, capacity decision, and audit commit atomically; an audit failure rolls them back so a later denial can retry while the response remains `429`.

## Database enforcement

Database guards cover invariants that application validation alone cannot protect across concurrent writers or future code paths. They keep membership ownership and history immutable, keep assignment ownership, provenance, and role immutable, allow only one active administrator-managed assignment per membership, prevent reactivation of revoked administrator-managed assignments, require an assignment identity to belong to the membership user, keep external evidence ordering state immutable and monotonic, permit only first session termination, protect the global revocation identity and exact revision increment, and keep an authorization attempt's server-selected purpose, bootstrap-secret generation, nonce, and revocation generation immutable. Ordinary value-shape and time-order checks remain in the application contracts.

## Safety boundaries

GitHub and Entra configuration are explicit and independently revisioned. Only the public github.com endpoints and the exact configured single-tenant Entra issuer are accepted. Provider requests have fixed deadlines, reject redirects, and discard provider tokens and client assertions after validation.

## Not implemented

Hub does not provide invitations, general member administration, recovery secrets, setup-only bootstrap consumption, background provider synchronization, repository admission, refresh tokens, provider logout, account linking, generic OIDC, multi-tenant OIDC, or Entra tenant setup automation. The retained administrator frontend is not connected to these APIs yet.
