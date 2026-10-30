# Authentication proof

Hub can prove a GitHub user identity without admitting that user to Hub. The proof flow creates a short-lived admission handoff for the next identity layer. It does not create a usable session, membership, role, invitation, or product authority.

## Current flow

`POST /api/auth/github/start` accepts requests only from the configured Hub origin. Hub reserves capacity in a database-backed rate-limit window for the trusted request address, selects the configured GitHub provider revision, stores a one-use authorization attempt, sets an HTTP-only browser-binding cookie, and redirects to GitHub with state and PKCE. The callback reserves its separate database-backed budget before parsing callback values, so every Hub replica enforces the same limits.

GitHub returns to `GET /api/auth/github/callback`. Hub consumes the attempt before exchanging the bounded authorization code. It uses GitHub's current-user endpoint and binds the immutable external identity to the numeric GitHub user ID. Login, name, avatar URL, and email remain display attributes.

A successful callback returns `authentication_proved` with `admission: "pending"` and a short-lived opaque handoff token. The handoff is bound to the browser, selected provider revision, and global revocation generation. It is not a Hub session and cannot access product routes.

## Stored data

Hub stores SHA-256 digests of state, browser binding, request address, and handoff token. The PKCE verifier is encrypted with the configured authentication encryption key. Provider access tokens are used only for the current-user lookup and are never saved, logged, or audited.

Authorization attempts and admission handoffs can transition from unconsumed to consumed once. Their identity, provider revision, expiry, and evidence cannot change. Admission-handoff consumption uses PostgreSQL's current clock after acquiring its transaction locks, so callers cannot choose the expiry-check time. The global revocation generation can only increase.

The C1 identity kernel continues to own users, immutable external identity mappings, provider revision digests, and security audits. Provider requests and validation run outside C1 database transactions.

## Configuration

Authentication routes are disabled unless `AUTHENTICATION_PROVIDER=github` is set. When enabled, startup requires the GitHub client, endpoint, callback, revision, cookie, origin, and encryption settings listed in [.env.example](../.env.example). Hub validates the strict public configuration allowlist and selects its explicit revision through the identity kernel. Unknown fields and revision drift fail closed; Hub never falls back to another provider.

Set `HUB_TRUSTED_PROXY_HOPS` only to the exact number of protected proxies in front of Hub. The default is `0`, so forwarded client addresses are ignored.

## Not implemented

This layer does not consume a handoff through an HTTP route or issue a usable Hub session. It does not evaluate installation membership, invitations, bootstrap or recovery state, roles, repository permissions, or product authorization. Entra OIDC, account linking, synchronized access, SCIM, publishing, and migration from old Hub instances are also not implemented.
