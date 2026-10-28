# Hub identity

Hub uses GitHub user authorization to prove an external identity. Hub then applies its own installation admission and membership rules before creating a provider-neutral browser session. Repository permissions do not grant installation membership.

## GitHub user authentication

Set `HUB_ORIGIN`, `HUB_GITHUB_AUTH_CLIENT_ID`, and `HUB_GITHUB_AUTH_CLIENT_SECRET` to enable GitHub sign-in. `HUB_ORIGIN` must be an HTTPS origin, except that local development may use HTTP on loopback. The callback is always `${HUB_ORIGIN}/api/auth/github/callback`.

Hub stores a versioned authentication-provider revision with non-secret configuration and a fingerprint that changes when the client secret changes. The client secret remains in the process environment. Each authorization attempt stores digested state and browser bindings, a PKCE verifier, the provider revision, the current session-revocation generation, its purpose, and a ten-minute expiry.

The callback consumes an attempt once, checks the same-browser binding and current provider and revocation state, exchanges the code with PKCE, and reads the authenticated GitHub profile. Hub maps GitHub's immutable numeric account ID to `ExternalIdentity.subject`. The user access token exists only while requesting that profile; Hub never stores it.

Hub sessions use a random opaque cookie and store only its digest. Authentication and session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` on HTTPS. State-changing routes require the configured origin and a matching CSRF cookie and header. Authentication routes omit request payloads from logs.

`HUB_ADMISSION_POLICY=hub-managed` is the default. GitHub proves identity, then Hub admits only an active member, an exact provider assignment with a usable invitation, or an authorized bootstrap or recovery enrollment. `legacy-repository` is an explicit compatibility policy that uses the separate GitHub source integration to create a member assignment after repository admission. The GitHub authentication adapter never reads installation credentials or performs repository authorization.

Sign-out revokes the current database session. Every restored session requires an active installation membership. Suspension and removal therefore deny retained cookies immediately, and their administration operations delete the affected user's sessions. Fresh verification reuses GitHub authorization and must return the same external identity. An active Hub administrator membership with fresh verification may revoke all sessions; revocation also supersedes callbacks that started earlier.

## Persisted boundaries

- `User` is the Hub-owned account. It does not contain a provider identifier or administrator flag.
- `ExternalIdentity` links a provider, issuer, and subject to one Hub user. One user may link several identities. The issuer is part of uniqueness so separate OIDC tenants may reuse subjects safely.
- `InstallationMembership` stores a user's `member` or `administrator` role and `active`, `suspended`, or terminal `removed` status for this Hub installation.
- `MembershipInvitation` targets an `ExternalIdentity` assignment by provider, issuer, and immutable subject. Activation consumes the invitation once and creates or reactivates the linked user's membership.
- `AuthenticationProvider` and its versioned revisions store provider-neutral authentication configuration. An OIDC-only configuration does not require GitHub source-integration credentials.
- `Session` records the Hub user, external identity, and authentication-provider revision that established it. GitHub source-integration credential rotation does not change session identity context.
- `AuthorizationAttempt` stores digested state and browser bindings, a PKCE verifier, an optional OIDC nonce, provider revision, purpose, optional originating session, and expiry. Consumption deletes the record in the same transaction so concurrent callbacks cannot reuse it.
- `SecurityAudit` stores the event and minimal optional identity context. Audit records do not create the future prototype authorization model.

Store operations can share one database transaction and lock a fixed store-state row. Related membership, invitation, session, and audit changes therefore commit or roll back together. Overlapping final-administrator changes and invitation activations observe committed state.

## Installation admission and administration

Set separate host-held `HUB_BOOTSTRAP_SECRET` and `HUB_ADMIN_RECOVERY_SECRET` values. Bootstrap can enroll the first administrator once. Its durable completion marker remains after expired authorization attempts are cleaned up. Recovery is available only when no active administrator remains and never resets bootstrap.

Administrators invite an identity by provider, issuer, and immutable subject. Mutable usernames, display names, and email addresses do not activate invitations. Invitations expire after seven days, can be revoked before use, and are consumed by one matching authentication callback. Removed memberships require a new invitation. Suspended memberships must be restored by an administrator.

Administrator mutations require an active administrator session verified less than five minutes ago. Hub prevents concurrent demotion, suspension, or removal from eliminating the final active administrator. See [Installation membership and administration](membership-and-administration.md).

## GitHub source-integration credentials

GitHub source access is an optional integration boundary, not the global identity boundary. Set `HUB_GITHUB_CREDENTIAL_PROVIDER` in the [environment example](../.env.example):

| Provider | Credentials |
| --- | --- |
| `database` (default) | Generate `HUB_GITHUB_CREDENTIAL_KEY` with `openssl rand -hex 32`. The provider encrypts GitHub integration credentials before storage and authenticates their context when reading. |
| `environment` | Set every `GITHUB_*` value, including `GITHUB_INSTALLATION_ID`. This provider is read-only and ignores database credentials. |

Both providers currently validate an App ID, installation ID, client ID, client secret, and RSA private key. IDs are positive decimal strings. The key must contain at least 2048 bits. A deployment may use the same GitHub App for user authorization and source integration, but it supplies and rotates the two configurations independently.

Database credentials use AES-256-GCM with contextual additional authenticated data. Keep the encryption key outside the database and back it up separately. Losing or replacing it makes saved credentials unreadable. Invalid provider settings or unreadable ciphertext cause errors; Hub never falls back to another provider.

## Current scope

This layer adds GitHub sign-in, installation admission, invitations, member and administrator lifecycle, one-use bootstrap and recovery, session restoration, sign-out, fresh verification, global and per-member session revocation, structured security records, and the minimal frontend needed to use them. It does not add prototype, repository, workspace, or artifact roles; GitHub membership synchronization; artifact ingestion; production OIDC; account linking; SCIM; or prototype APIs.

Apply the rewritten initial migration with `npm run db:deploy`. See [Database](database.md) for setup and schema rules.
