# Hub identity

Hub persists a provider-neutral identity foundation. User authentication proves an external identity. Hub installation membership records whether that user belongs to this Hub and whether they are an administrator. This persistence layer does not define prototype access rules.

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

Both providers currently validate an App ID, installation ID, client ID, client secret, and RSA private key. IDs are positive decimal strings. The key must contain at least 2048 bits.

Database credentials use AES-256-GCM with contextual additional authenticated data. Keep the encryption key outside the database and back it up separately. Losing or replacing it makes saved credentials unreadable. Invalid provider settings or unreadable ciphertext cause errors. Hub never falls back to another provider.

## Foundation scope

This layer provides persistence only. It does not add HTTP sign-in routes, production OIDC or SCIM flows, prototype or product models, an authorization evaluator, GitHub permission synchronization, artifact ingestion, or UI. GitHub authentication configuration and GitHub source credentials remain separate so either capability can change without redefining Hub identity.

Apply the rewritten initial migration with `npm run db:deploy`. See [Database](database.md) for setup and schema rules.
