# Authentication and Hub sessions

Hub exposes a same-request GitHub sign-in flow. The provider proof remains internal; the callback immediately rereads authoritative records, decides admission, and issues a Hub session when access is allowed.

## Proof flow

The start primitive selects the configured GitHub provider revision, creates opaque state, browser binding, and a PKCE verifier, and persists one short-lived authorization attempt. PostgreSQL owns attempt creation, expiry, locking, and one-use consumption time. The stored attempt contains digests plus the encrypted verifier, not raw state, browser binding, or provider tokens.

GitHub and future provider adapters are defined in code, not discovered from database records. On the first configured start, Hub validates the adapter's public configuration and creates and selects revision 1 through the identity kernel. A later configuration uses the next accepted revision. Operators do not seed provider rows. Failed validation or replacement leaves the current selected revision usable, while older replicas and attempts fail closed when their local revision no longer matches the selected revision.

Increment `GITHUB_PROVIDER_REVISION` when an intentional provider configuration or credential generation change must invalidate in-flight attempts and stale replicas. Keep the revision unchanged for an ordinary restart with the same validated provider settings.

The completion primitive consumes the browser-bound attempt before provider work, confirms that the selected provider revision and digest match the local validated adapter, exchanges the bounded authorization code, reads the public github.com current user, and resolves the immutable external identity through the identity kernel. GitHub's numeric user ID is the immutable subject. Profile and presentation data are outside this foundation.

Completion returns a minimal provider-neutral proof value in memory containing only the consumed authorization attempt ID and resolved external identity ID. This value is internal-only, is not a session or authority, and is never reconstructed from browser request data.

The callback passes that value directly to admission in the same process. Admission rereads the immutable external identity and locks the consumed attempt, selected provider revision, global session revocation state, membership, and active assignments before creating a session.

## Admission

Normal sign-in requires an active membership with an active assignment. Unknown identities, suspended memberships, removed memberships, and identities without active assignments are denied without creating a session.

The administrator enrollment start requires `HUB_BOOTSTRAP_SECRET` before OAuth begins. The configured secret must contain at least 32 characters and is compared in constant time. The secret authorizes each browser-bound, one-use authorization attempt; it is not stored, audited, logged, or globally consumed.

A started enrollment stores only a digest of the configured bootstrap secret. Rotating the secret automatically invalidates enrollment attempts that have not completed, while normal sign-in attempts remain unaffected.

A successful enrollment creates or restores an active administrator assignment owned by the verified external identity. The same secret can enroll another administrator or restore a previous administrator, including when another administrator still exists. Repository permissions do not affect Hub admission.

Membership lifecycle and assignment provenance are separate. The schema supports active, suspended, and removed memberships, and freezes administrator and member role values for compatibility. This version creates and admits only bootstrap-owned administrator assignments; member admission, member UI, and provider-owned assignment synchronization remain deferred.

Membership ownership and creation history are immutable. Bootstrap enrollment writes a separate membership-created or membership-restored audit whenever it changes membership lifecycle; an already active membership creates no duplicate lifecycle audit.

## Browser session

Hub creates a fresh opaque session value only after admission succeeds. The browser receives the value in an `HttpOnly`, `SameSite=Lax` cookie with a bounded lifetime; HTTPS origins also set `Secure`. The database stores only its SHA-256 digest.

Every current-session restore rereads the global revocation revision, session expiry and termination state, membership lifecycle, and active assignment. A retained cookie stops authorizing access after sign-out, expiry, suspension, removal, assignment revocation, or a global revision change.

Suspension, removal, assignment revocation, and global revision changes are enforced when read, but this version does not expose runtime operations that initiate them.

The migration owns the single global revocation row. Its identity and history are immutable, its revision can only increment by one, and runtime code never recreates a missing row. Admission and restoration fail closed when that authority is missing. Admissions use shared locks for provider selection and revocation authority so unrelated users can proceed concurrently while authority mutations wait.

`GET /api/auth/session` restores the current session. `POST /api/auth/session/sign-out` ends it and clears the cookie. Hub does not issue refresh tokens, perform provider logout, or support step-up authentication.

## HTTP boundary

`POST /api/auth/github/start` begins normal sign-in. `POST /api/auth/github/admin-enrollment/start` verifies the reusable bootstrap secret before beginning administrator enrollment. `GET /api/auth/github/callback` consumes GitHub's callback and redirects with a generic success or denial result.

Start and sign-out requests require the exact configured application origin. Authentication routes use database-backed per-address-digest rate limits, disable response storage, and omit query, form, and cookie payloads from request completion logs. Callback rate limiting runs before callback parsing.

The address digest uses the trusted client address. Behind a protected proxy, configure `HUB_TRUSTED_PROXY_HOPS` to the exact proxy-chain length; leaving it at zero intentionally treats the proxy as the client and shares one rate-limit budget across traffic from that proxy.

Consumed attempts remain available as short-lived protocol state for ten minutes after consumption so a trusted same-request consumer can reread them. Cleanup removes expired unconsumed attempts and consumed attempts after that fixed retention window; this is not authentication history.

Administrator-enrollment rate limits write at most one durable denial audit for each address-digest window. The first-denial marker, capacity decision, and audit commit atomically; an audit failure rolls them back so a later denial can retry while the response remains `429`.

## Database enforcement

Database guards cover invariants that application validation alone cannot protect across concurrent writers or future code paths. They keep membership ownership and history immutable, keep assignment ownership, provenance, and role immutable, require an assignment identity to belong to the membership user, permit only first session termination, protect the global revocation identity and exact revision increment, and keep an authorization attempt's server-selected purpose and bootstrap-secret generation immutable. Ordinary value-shape and time-order checks remain in the application contracts.

## Safety boundaries

GitHub configuration is explicit and revisioned. Only the public github.com authorization, token, and user endpoints are accepted. Provider requests have fixed deadlines, reject redirects, and discard access tokens after the user lookup.

## Not implemented

Hub does not provide invitations, member administration, recovery secrets, setup-only bootstrap consumption, provider assignment synchronization, repository admission, refresh tokens, or provider logout.
