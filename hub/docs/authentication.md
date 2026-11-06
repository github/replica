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

One Entra assignment is active for an external identity. A role, assignment subject, or provider-revision change supersedes that immutable version and ends the membership's open sessions. Hub observes role loss only when a later Entra authentication emits updated role-free evidence; once observed, losing accepted roles revokes provider-owned authority and ends open sessions atomically. Entra may briefly return cached role claims even during a fresh login. Without Graph or SCIM lifecycle sync, an existing Hub cookie can remain valid until updated evidence is observed, its 12-hour expiry, provider removal or revision change, global session revocation, or Hub membership suspension or removal. Hub persists the newest signed evidence marker independently from assignment lifecycle so stale callbacks cannot recreate revoked or downgraded authority. When revocation leaves no authority, the ordering marker, transition, session termination, and denial audit commit together without a new session. Bootstrap assignments remain separate and may continue to admit the user; provider evidence never rewrites Hub-owned provenance.

The administrator enrollment start requires `HUB_BOOTSTRAP_SECRET` before OAuth begins. The configured secret must contain at least 32 characters and is compared in constant time. The secret authorizes each browser-bound, one-use authorization attempt; it is not stored, audited, logged, or globally consumed.

A started enrollment stores only a digest of the configured bootstrap secret. Rotating the secret automatically invalidates enrollment attempts that have not completed, while normal sign-in attempts remain unaffected.

A successful enrollment creates or restores an active administrator assignment owned by the verified external identity. The same secret can enroll another administrator or restore a previous administrator, including when another administrator still exists. Repository permissions do not affect Hub admission.

Membership lifecycle and assignment provenance are separate. The schema supports active, suspended, and removed memberships, bootstrap-owned administrators, and Entra-owned member or administrator assignment versions. Hub does not provide generic manual assignment administration.

Membership ownership and creation history are immutable. Bootstrap enrollment writes a separate membership-created or membership-restored audit whenever it changes membership lifecycle; an already active membership creates no duplicate lifecycle audit.

## Browser session

Hub creates a fresh opaque session value only after admission succeeds. The browser receives the value in an `HttpOnly`, `SameSite=Lax` cookie with a bounded lifetime; HTTPS origins also set `Secure`. The database stores only its SHA-256 digest.

Every current-session restore rereads the global revocation revision, session expiry and termination state, membership lifecycle, and active assignments, then returns the current effective member or administrator role. Provider-owned authority is active only while its provider remains enabled and its revision remains selected. A retained cookie stops authorizing access after sign-out, expiry, suspension, removal, assignment revocation, provider removal or revision replacement, or a global revision change.

Suspension, removal, assignment revocation, and global revision changes are enforced when read. Current Entra evidence may supersede or revoke its own provider assignment and end that membership's sessions; this version does not expose general membership lifecycle operations.

Disabling a provider, selecting a new provider revision, or advancing global session revocation are revoke-all controls. Hub does not implement immediate per-user Entra lifecycle synchronization.

The migration owns the single global revocation row. Its identity and history are immutable, its revision can only increment by one, and runtime code never recreates a missing row. Admission and restoration fail closed when that authority is missing. Admissions use shared locks for provider selection and revocation authority so unrelated users can proceed concurrently while authority mutations wait.

`GET /api/auth/session` restores the current session. `POST /api/auth/session/sign-out` ends it and clears the cookie. Hub does not issue refresh tokens, perform provider logout, or support step-up authentication.

## HTTP boundary

`POST /api/auth/github/start` begins normal sign-in. `POST /api/auth/github/admin-enrollment/start` verifies the reusable bootstrap secret before beginning administrator enrollment. `GET /api/auth/github/callback` consumes GitHub's callback and redirects with a generic success or denial result.

`POST /api/auth/entra/start`, `POST /api/auth/entra/admin-enrollment/start`, and `GET /api/auth/entra/callback` provide the equivalent explicit Entra flow. Entra administrator enrollment requests a fresh provider login and requires signed `auth_time` evidence from after the saved attempt start.

Start and sign-out requests require the exact configured application origin. Authentication routes use database-backed per-address-digest rate limits, disable response storage, and omit query, form, and cookie payloads from request completion logs. Callback rate limiting runs before callback parsing.

The address digest uses the trusted client address. Behind a protected proxy, configure `HUB_TRUSTED_PROXY_HOPS` to the exact proxy-chain length; leaving it at zero intentionally treats the proxy as the client and shares one rate-limit budget across traffic from that proxy.

Consumed attempts remain available as short-lived protocol state for ten minutes after consumption so a trusted same-request consumer can reread them. Cleanup removes expired unconsumed attempts and consumed attempts after that fixed retention window; this is not authentication history.

Administrator-enrollment rate limits write at most one durable denial audit for each address-digest window. The first-denial marker, capacity decision, and audit commit atomically; an audit failure rolls them back so a later denial can retry while the response remains `429`.

## Database enforcement

Database guards cover invariants that application validation alone cannot protect across concurrent writers or future code paths. They keep membership ownership and history immutable, keep assignment ownership, provenance, and role immutable, require an assignment identity to belong to the membership user, keep external evidence ordering state immutable and monotonic, permit only first session termination, protect the global revocation identity and exact revision increment, and keep an authorization attempt's server-selected purpose, bootstrap-secret generation, nonce, and revocation generation immutable. Ordinary value-shape and time-order checks remain in the application contracts.

## Safety boundaries

GitHub and Entra configuration are explicit and independently revisioned. Only the public github.com endpoints and the exact configured single-tenant Entra issuer are accepted. Provider requests have fixed deadlines, reject redirects, and discard provider tokens and client assertions after validation.

## Not implemented

Hub does not provide invitations, member administration, recovery secrets, setup-only bootstrap consumption, background provider synchronization, repository admission, refresh tokens, provider logout, account linking, generic OIDC, multi-tenant OIDC, or Entra tenant setup automation.
