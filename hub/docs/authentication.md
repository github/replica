# Authentication proof

Hub has internal GitHub authentication proof primitives. No public authentication flow is registered.

## Proof flow

The start primitive selects the configured GitHub provider revision, creates opaque state, browser binding, and a PKCE verifier, and persists one short-lived authorization attempt. PostgreSQL owns attempt creation, expiry, locking, and one-use consumption time. The stored attempt contains digests plus the encrypted verifier, not raw state, browser binding, or provider tokens.

The completion primitive consumes the browser-bound attempt before provider work, confirms that the selected provider revision and digest match the local validated adapter, exchanges the bounded authorization code, reads the public github.com current user, and resolves the immutable external identity through the identity kernel. GitHub's numeric user ID is the immutable subject. Profile and presentation data are outside this foundation.

Completion returns a minimal provider-neutral proof value in memory containing only the consumed authorization attempt ID and resolved external identity ID. This value is internal-only, is not a session or authority, and must never be reconstructed from browser request data.

A later same-request consumer must reread the referenced authoritative records before deciding anything.

## Safety boundaries

GitHub configuration is explicit and revisioned. Only the public github.com authorization, token, and user endpoints are accepted. Provider requests have fixed deadlines, reject redirects, and discard access tokens after the user lookup.

## Not implemented

This layer does not expose a sign-in route or create product authority.
