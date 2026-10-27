# Hub identity

Hub uses one configured user sign-in provider to prove an external identity. Hub then applies its own installation admission and membership rules before creating a provider-neutral browser session. Provider assignment and repository permissions do not grant future prototype authorization.

## Production OIDC

Hub supports standards-based OIDC authorization code flow as a sibling of GitHub user authorization. The first deployment profile is single-tenant Microsoft Entra ID with `Hub.User` and `Hub.Administrator` app roles. See [Microsoft Entra OIDC](entra-oidc.md) for the setup script, exact configuration, assignment policy, and operational boundary.

OIDC discovery must return the exact configured issuer. Hub binds state to the initiating browser, uses PKCE and nonce, consumes attempts once, exchanges the code with a bounded timeout, verifies the ID-token signature through cached rotating JWKS, and validates issuer, audience, authorized party, token lifetime, and nonce. The configured issuer is host configuration, never request input. Hub rejects non-public or cross-origin discovery endpoints.
Hub maps `oidc + issuer/tenant + subject` to `ExternalIdentity`. Login, email, name, and picture are mutable display attributes. They never admit a user or select an existing identity. The authorization response and provider tokens are discarded after identity and app-role extraction.

## GitHub user authentication

Set `HUB_ORIGIN`, `HUB_GITHUB_AUTH_CLIENT_ID`, and `HUB_GITHUB_AUTH_CLIENT_SECRET` to enable GitHub sign-in. `HUB_ORIGIN` must be an HTTPS origin, except that local development may use HTTP on loopback. The callback is always `${HUB_ORIGIN}/api/auth/github/callback`.

Hub stores a versioned authentication-provider revision with non-secret configuration and a fingerprint that changes when the client secret changes. The client secret remains in the process environment. Each authorization attempt stores digested state and browser bindings, a PKCE verifier, the provider revision, the current session-revocation generation, its purpose, and a ten-minute expiry.

The callback consumes an attempt once, checks the same-browser binding and current provider and revocation state, exchanges the code with PKCE, and reads the authenticated GitHub profile. Hub maps GitHub's immutable numeric account ID to `ExternalIdentity.subject`. The user access token exists only while requesting that profile; Hub never stores it.

Hub sessions use a random opaque cookie and store only its digest. Authentication and session cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` on HTTPS. State-changing routes require the configured origin and a matching CSRF cookie and header. Authentication routes omit request payloads from logs. Restoring a session for a `synchronized` membership also requires at least one fresh admission-eligible linked baseline, so expired access fails closed immediately rather than waiting for the periodic sweep.

`HUB_ADMISSION_POLICY=hub-managed` is the default. GitHub proves identity, then Hub admits only an active member, an exact provider assignment with a usable invitation, or an authorized bootstrap or recovery enrollment.

`github-synchronized` is opt-in. It checks only repository source records whose admission switch is enabled, resolves their current metadata by immutable GitHub repository ID, uses the separately configured GitHub App installation credentials, and records the confirmed raw permission and mapped baseline separately from the membership. A qualifying baseline creates or refreshes only a `synchronized` member assignment. Manual, invitation, bootstrap, recovery, suspended, and administratively removed assignments remain Hub overrides and are never rewritten by synchronization. Permission loss removes a synchronized membership and its sessions only after reconciliation or the bounded last-known-good window expires.

`legacy-repository` preserves the previous compatibility behavior. It scans repositories available to the installation and creates a `legacy-synchronized` member assignment after finding any repository permission, without requiring linked source records. The migration backfills pre-existing synchronized compatibility memberships to that source before linked-source synchronization begins. Linked-source reconciliation does not manage those compatibility assignments. It is not the normal synchronized authorization mode. The GitHub authentication adapter itself never reads installation credentials or performs repository authorization.

Artifact publishing uses a separate workload identity boundary. Prototype administrators issue prototype-scoped credentials with `publish` and/or `read-status`; Hub returns the raw bearer token once and stores only its digest. Workload credentials never create browser sessions or inherit user, installation, repository, or source-provider access. See [Artifact ingestion](artifact-ingestion.md).

Sign-out revokes the current database session. Provider logout is optional and is not assumed. Every restored session requires an active installation membership. Suspension and removal therefore deny retained cookies immediately, and their administration operations delete the affected user's sessions. Fresh verification reuses the configured provider and must return the same external identity. An active Hub administrator membership with fresh verification may revoke all sessions; revocation also supersedes callbacks that started earlier.

## Persisted boundaries

- `User` is the Hub-owned account. It does not contain a provider identifier or administrator flag.
- `ExternalIdentity` links a provider, issuer, and subject to one Hub user. One user may link several identities. The issuer is part of uniqueness so separate OIDC tenants may reuse subjects safely.
- `InstallationMembership` stores a user's `member` or `administrator` role and `active`, `suspended`, or terminal `removed` status for this Hub installation.
- `MembershipInvitation` targets an `ExternalIdentity` assignment by provider, issuer, and immutable subject. Activation consumes the invitation once and creates or reactivates the linked user's membership.
- `AuthenticationProvider` and its versioned revisions store provider-neutral authentication configuration. An OIDC-only configuration does not require GitHub source-integration credentials.
- `Session` records the Hub user, external identity, and authentication-provider revision that established it. GitHub source-integration credential rotation does not change session identity context.
- `AuthorizationAttempt` stores digested state and browser bindings, a PKCE verifier, an optional OIDC nonce, provider revision, purpose, optional originating session, and expiry. Consumption deletes the record in the same transaction so concurrent callbacks cannot reuse it.
- `SecurityAudit` stores the event and minimal optional identity and product context. Audit records describe changes but do not grant access.

Store operations can share one database transaction and lock a fixed store-state row. Related membership, invitation, session, and audit changes therefore commit or roll back together. Overlapping final-administrator changes and invitation activations observe committed state.

## Installation admission and administration

Set separate host-held `HUB_BOOTSTRAP_SECRET` and `HUB_ADMIN_RECOVERY_SECRET` values. Bootstrap can enroll the first administrator once. Its durable completion marker remains after expired authorization attempts are cleaned up. Recovery is available only when no active administrator remains and never resets bootstrap.

Administrators invite an identity by provider, issuer, and immutable subject. Mutable usernames, display names, and email addresses do not activate invitations. Invitations expire after seven days, can be revoked before use, and are consumed by one matching authentication callback. Removed memberships require a new invitation. Suspended memberships must be restored by an administrator.

Administrator mutations require an active administrator session verified less than five minutes ago. Hub prevents concurrent demotion, suspension, or removal from eliminating the final active administrator. See [Installation membership and administration](membership-and-administration.md).

## GitHub source-integration credentials

GitHub source access is an optional integration boundary, not the global identity boundary. Set `HUB_GITHUB_CREDENTIAL_PROVIDER` in the [environment example](../.env.example):

| Provider             | Credentials                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database` (default) | Generate `HUB_GITHUB_CREDENTIAL_KEY` with `openssl rand -hex 32`. The provider encrypts GitHub integration credentials before storage and authenticates their context when reading. |
| `environment`        | Set every `GITHUB_*` value, including `GITHUB_INSTALLATION_ID`. This provider is read-only and ignores database credentials.                                                        |

Both providers currently validate an App ID, installation ID, client ID, client secret, and RSA private key. IDs are positive decimal strings. The key must contain at least 2048 bits. A deployment may use the same GitHub App for user authorization and source integration, but it supplies and rotates the two configurations independently. Set `HUB_GITHUB_WEBHOOK_SECRET` separately when enabling the webhook route.

Database credentials use AES-256-GCM with contextual additional authenticated data. Keep the encryption key outside the database and back it up separately. Losing or replacing it makes saved credentials unreadable. Invalid provider settings or unreadable ciphertext cause errors; Hub never falls back to another provider.

## Current scope

This layer adds explicit GitHub or OIDC sign-in, Hub-managed and opt-in GitHub-synchronized installation admission, invitations, member and administrator lifecycle, one-use bootstrap and recovery, session restoration, sign-out, fresh verification, global and per-member session revocation, structured security records, and the minimal frontend needed to use them. The separate [prototype authorization](prototype-authorization.md) boundary may consume a synchronized repository baseline without treating installation membership as product authority. Artifact ingestion composes with identity only when a browser administrator provisions a workload credential; publication itself does not use a browser session. Identity does not add a multi-provider chooser, cross-provider account linking, SCIM or Graph lifecycle synchronization, or background Graph access.

Apply the rewritten initial migration with `npm run db:deploy`. See [Database](database.md) for setup and schema rules.
