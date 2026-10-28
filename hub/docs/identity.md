# Hub identity

Hub uses GitHub user authorization to prove an external identity and creates provider-neutral browser sessions. Hub installation membership records administrative roles. Later authorization work will let Hub own prototype access independently of repository permissions.

## GitHub user authentication

Set `HUB_ORIGIN`, `HUB_GITHUB_AUTH_CLIENT_ID`, and `HUB_GITHUB_AUTH_CLIENT_SECRET` to enable GitHub sign-in. `HUB_ORIGIN` must be an HTTPS origin, except that local development may use HTTP on loopback. The callback is always `${HUB_ORIGIN}/api/auth/github/callback`.

Hub stores a versioned authentication-provider revision with non-secret configuration and a fingerprint that changes when the client secret changes. The client secret remains in the process environment. Each authorization attempt stores digested state and browser bindings, a PKCE verifier, the provider revision, the current session-revocation generation, its purpose, and a ten-minute expiry.

The callback consumes an attempt once, checks the same-browser binding and current provider and revocation state, exchanges the code with PKCE, and reads the authenticated GitHub profile. Hub maps GitHub's immutable numeric account ID to `ExternalIdentity.subject`. The user access token exists only while requesting that profile; Hub never stores it.

Hub sessions use a random opaque cookie and store only its digest. Authentication and session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` on HTTPS. State-changing routes require the configured origin and a matching CSRF cookie and header. Authentication routes omit request payloads from logs.

`HUB_ADMISSION_POLICY=hub-managed` is the default. GitHub proves identity, and no repository permission check gates sign-in. `legacy-repository` is an explicit compatibility policy that uses the separate GitHub source integration to require access to at least one installed repository. The GitHub authentication adapter never reads installation credentials or performs repository authorization.

Sign-out revokes the current database session. Fresh verification reuses GitHub authorization and must return the same external identity. An active Hub administrator membership with verification less than five minutes old may revoke all sessions; revocation also supersedes callbacks that started earlier.

## Persisted boundaries

- `User` is the Hub-owned account. It does not contain a provider identifier or administrator flag.
- `ExternalIdentity` links a provider, issuer, and subject to one Hub user. One user may link several identities. The issuer is part of uniqueness so separate OIDC tenants may reuse subjects safely.
- `InstallationMembership` stores a user's status, role, and source for this Hub installation.
- `AuthenticationProvider` and its versioned revisions store authentication configuration without tying it to one provider. An OIDC configuration does not require GitHub source credentials.
- `Session` records the Hub user, external identity, and authentication provider revision that established it. Rotating GitHub source credentials does not change session identity context.
- `AuthorizationAttempt` stores digested state and browser bindings, a PKCE verifier, an optional OIDC nonce, provider revision, purpose, optional originating session, and expiry. Consumption deletes the record in the same transaction so concurrent callbacks cannot reuse it.
- `SecurityAudit` stores the event and minimal optional identity context.

Queries are available without a lock. Mutations run through one database transaction that locks a fixed store row. Related records and audit events therefore commit or roll back together, and overlapping mutations observe committed state.

Security audit queries return at most 100 records from the previous 90 days. Each new audit write deletes records older than 90 days. Operators who require a longer security history must export records before that limit.

## GitHub source credentials

GitHub source access is an optional integration boundary, not the global identity boundary. Set `HUB_GITHUB_CREDENTIAL_PROVIDER` in the [environment example](../.env.example):

| Provider | Credentials |
| --- | --- |
| `database` (default) | Generate `HUB_GITHUB_CREDENTIAL_KEY` with `openssl rand -hex 32`. The provider encrypts GitHub integration credentials before storage and authenticates their context when reading. |
| `environment` | Set every `GITHUB_*` value, including `GITHUB_INSTALLATION_ID`. This provider is read-only and ignores database credentials. |

Both providers currently validate an App ID, installation ID, client ID, client secret, and RSA private key. IDs are positive decimal strings. The key must contain at least 2048 bits. A deployment may use the same GitHub App for user authorization and source integration, but it supplies and rotates the two configurations independently.

Database credentials use AES-256-GCM with contextual additional authenticated data. Keep the encryption key outside the database and back it up separately. Losing or replacing it makes saved credentials unreadable. Invalid provider settings or unreadable ciphertext cause errors. Hub never falls back to another provider.

## Current scope

This layer adds GitHub sign-in, session restoration, sign-out, fresh verification, global session revocation, and the minimal frontend needed to use them. It does not add invitations or membership administration, prototype authorization, GitHub permission synchronization, artifact ingestion, OIDC, account linking, SCIM, or product APIs.

Apply the rewritten initial migration with `npm run db:deploy`. See [Database](database.md) for setup and schema rules.
