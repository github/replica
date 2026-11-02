# Authentication proof

Hub has internal GitHub authentication proof primitives for a future complete sign-in callback. This layer does not register public start or callback routes and does not issue a session, membership, admission decision, or product authority.

## Proof flow

The start primitive selects the configured GitHub provider revision, creates opaque state, browser binding, and a PKCE verifier, and persists one short-lived authorization attempt. PostgreSQL owns attempt creation, expiry, locking, and one-use consumption time. The stored attempt contains digests plus the encrypted verifier, not raw state, browser binding, or provider tokens.

The completion primitive consumes the browser-bound attempt before provider work, confirms that the selected provider revision and digest match the local validated adapter, exchanges the bounded authorization code, reads the public github.com current user, and resolves the immutable external identity through the identity kernel. GitHub's numeric user ID is the immutable subject. Preferred username, name, avatar URL, and email are nullable presentation data and never identity, admission, or authorization keys.

Completion returns a minimal provider-neutral proof value in memory containing only the consumed authorization attempt ID and resolved external identity ID. This value is internal-only and must be passed directly to C3 in the same callback request; it must never be reconstructed from browser request data.

C3 rereads the consumed attempt and external identity with their user and immutable provider tuple. Its accepted transaction design will own provider/revocation rechecks, admission, session issuance, and the final success audit. Any mismatch or denial creates no session and requires the user to restart sign-in.

If admission or session issuance fails, the user must restart sign-in in this version. Hub does not persist a bearer proof, pending enrollment, handoff token, or half-signed-in browser state. A future asynchronous approval flow would need its own domain-specific pending-enrollment contract.

## Safety boundaries

GitHub configuration is explicit and revisioned. Only the public github.com authorization, token, and user endpoints are accepted. Provider requests have fixed deadlines, reject redirects, and discard access tokens after the user lookup.

## Not implemented

This layer does not expose a complete sign-in route, set a usable session cookie, evaluate installation membership, invitations, bootstrap or recovery state, roles, repository permissions, or product authorization. Entra OIDC, account linking, synchronized access, SCIM, publishing, and migration from old Hub instances are also not implemented.
