# Microsoft Entra OIDC

Hub can use a single-tenant Microsoft Entra application as a user sign-in provider. An installation may configure GitHub, Entra, or both. Each provider has explicit routes and configuration; a failed provider never falls back to another provider.

## Entra application contract

Create a single-tenant application registration with this exact behavior:

- sign-in audience `AzureADMyOrg`;
- web redirect URI `<HUB_APPLICATION_ORIGIN>/api/auth/entra/callback`;
- ID-token optional claim `auth_time`, marked essential;
- assignment not required on the enterprise application;
- app role value `Hub.User` for members;
- app role value `Hub.Administrator` for administrators; and
- app roles assigned to users or groups only through the tenant's approved process.

Hub accepts only the issuer `https://login.microsoftonline.com/<tenant-uuid>/v2.0`. It uses the signed `sub` claim as the immutable external identity. The signed tenant `oid` claim records provider-assignment provenance; Hub does not use email, username, or `oid` to link accounts.

This change does not include Microsoft Graph setup automation. The team will choose PowerShell, TypeScript, azd, or another operator workflow in a follow-up. Until then, operators configure the application through their approved Entra process and verify the contract above.

## App roles and membership

Role values are exact and case-sensitive. `Hub.Administrator` wins when a token contains both accepted roles. Other role values do not contribute Hub authority.

Hub stores one active Entra assignment for an external identity. A role or provider-revision change creates a new immutable assignment version and supersedes the prior version. Hub observes role loss only when a later Entra authentication emits updated role-free evidence; once observed, losing both accepted roles revokes the Entra assignment and ends that membership's open Hub sessions atomically.

The enterprise application must allow an unassigned user to authenticate so Hub can receive signed evidence that accepted roles were removed. Hub then denies admission and revokes provider-owned authority in the same transaction. Requiring Entra assignment would block the callback before Hub could observe role loss.

This version does not use Microsoft Graph or SCIM lifecycle sync, polling, webhooks, or refresh tokens. Entra may briefly return cached role claims even during a fresh login. Until updated role-free evidence arrives, an existing Hub cookie can remain valid until its 12-hour expiry, provider removal, provider revision or global session revocation, or Hub membership suspension or removal.

Disabling Entra or increasing its provider revision revokes Entra-owned authority and sessions that rely solely on it; separate bootstrap authority may remain valid. Advancing global session revocation invalidates every Hub session. Immediate per-user Entra lifecycle synchronization is not implemented.

Bootstrap authority remains separate. Entra evidence cannot overwrite a bootstrap assignment or reactivate a suspended or removed membership. Current Entra evidence still supersedes or revokes provider authority and ends open sessions while the membership remains inactive. If Entra authority is revoked while a separate active bootstrap assignment remains, the user may still be admitted through that Hub-owned authority.

## Client authentication

Choose exactly one mode:

### Local or test client secret

```dotenv
ENTRA_OIDC_CLIENT_AUTHENTICATION=client-secret
ENTRA_OIDC_CLIENT_SECRET=<secret-store-injected-value>
```

### Governed managed identity

Configure a user-assigned managed identity as a federated credential for the Entra application and allow the workload to obtain an assertion for `api://AzureADTokenExchange`.

```dotenv
ENTRA_OIDC_CLIENT_AUTHENTICATION=managed-identity
ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID=<user-assigned-managed-identity-client-id>
```

Hub does not fall back between modes. A managed-identity failure rejects the token exchange.

## Hub configuration

Set the shared authentication values and the complete Entra profile:

```dotenv
HUB_APPLICATION_ORIGIN=https://hub.example.com
HUB_AUTHENTICATION_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
HUB_BOOTSTRAP_SECRET=<random-value-at-least-32-characters>

ENTRA_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-uuid>/v2.0
ENTRA_OIDC_CLIENT_ID=<application-client-id>
ENTRA_OIDC_PROVIDER_REVISION=1
ENTRA_OIDC_CLIENT_AUTHENTICATION=client-secret
ENTRA_OIDC_CLIENT_SECRET=<secret-store-injected-value>
```

Increase `ENTRA_OIDC_PROVIDER_REVISION` when public configuration, client-authentication mode, credential reference, or credential changes. Re-enabling Entra after removing it also requires the next consecutive revision, even when the validated configuration is otherwise unchanged. A new revision invalidates in-flight attempts, stale replicas, and provider authority and sessions tied to the old revision. Keep the revision unchanged for an ordinary restart with the same validated enabled settings. Hub validates discovery before selecting a revision. Failed validation leaves the currently selected database revision unchanged.

GitHub settings remain independent. Configure both profiles to show both sign-in choices.

## Protocol and lifecycle

Hub uses authorization code, S256 PKCE, nonce, exact issuer and audience checks, bounded discovery/JWKS/token requests, and signed ID-token validation. Normal sign-in permits an existing Entra browser session. Administrator enrollment requests a new provider login and requires signed `auth_time` evidence from after the saved attempt start.

Hub discards provider codes, ID tokens, client assertions, and returned tokens after validation. Hub sign-out ends only the opaque Hub session; provider logout and refresh-token storage are not implemented.

## Not implemented

Hub does not implement multi-tenant or arbitrary OIDC, account linking, email/login matching, Microsoft Graph or SCIM lifecycle sync, invitations, broad membership administration, provider logout, refresh-token storage, repository permission synchronization, tenant setup automation, or deployment infrastructure changes.
