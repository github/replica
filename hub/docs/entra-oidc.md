# Microsoft Entra OIDC

Hub supports one user sign-in provider per installation. The first production OIDC profile is a single-tenant Microsoft Entra ID enterprise application, but Hub uses OpenID Connect discovery, authorization code, PKCE, nonce, and signed ID-token validation rather than an Entra authentication SDK.

## Separate setup from sign-in

A tenant administrator performs the one-time application setup. Ordinary users then sign in through the configured enterprise application. Tenant consent, application ownership, client-credential storage, and group assignment remain operator responsibilities; Hub does not bypass those approvals.

Run the read-only preflight without Microsoft Graph permissions:

```powershell
./script/setup-entra-oidc.ps1 -Preflight -HubOrigin https://hub.example.com
```

Install the listed Microsoft Graph PowerShell modules, sign in with the required tenant permissions, and inspect the intended changes:

```powershell
./script/setup-entra-oidc.ps1 -Plan `
  -HubOrigin https://hub.example.com `
  -TenantId <tenant-id> `
  -UserGroupId <user-group-object-id> `
  -AdministratorGroupId <administrator-group-object-id>
```

Use `-Apply` with the same arguments to converge the application, service principal, assignment requirement, callback, `Hub.User` and `Hub.Administrator` app roles, and group assignments. Apply adds missing requested groups and removes obsolete group assignments for those two managed roles; unrelated app roles and their assignments are preserved. Use `-ExistingApplicationId <application-client-id>` to converge an existing application without claiming removal ownership. `-Remove` deletes only resources tagged as created by this script and refuses unowned resources.

The script prints nonsecret Hub configuration. It does not create or print a client credential. Create the credential through the tenant's approved process, place it in the secret store exposed by `HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE`, and protect it separately from the database.

## Hub configuration

Set the complete OIDC profile. Hub does not fall back to GitHub when OIDC is selected or unavailable.

```dotenv
HUB_AUTH_PROVIDER=oidc
HUB_OIDC_ENABLED=true
HUB_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
HUB_OIDC_CLIENT_ID=<application-client-id>
HUB_OIDC_CALLBACK_URL=https://hub.example.com/api/auth/oidc/callback
HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE=HUB_OIDC_CLIENT_SECRET
HUB_OIDC_CLIENT_SECRET=<secret-store-injected-value>
HUB_OIDC_MEMBER_ROLE=Hub.User
HUB_OIDC_ADMINISTRATOR_ROLE=Hub.Administrator
HUB_OIDC_SCOPES=openid profile email
HUB_OIDC_MEMBERSHIP_POLICY=jit-assignment
HUB_OIDC_PROVIDER_REVISION=1
```

The callback must exactly match `HUB_ORIGIN` plus `/api/auth/oidc/callback`. The first supported profile requires the issuer `https://login.microsoftonline.com/<tenant-uuid>/v2.0`; Hub does not accept a generic hostname or tenant alias. Discovered authorization, token, and JWKS endpoints must use that same HTTPS origin. Increase `HUB_OIDC_PROVIDER_REVISION` whenever any OIDC setting or referenced credential changes. Hub rejects revision rollback and same-revision configuration drift.

Prefer rotating the client credential without replacing the Entra application client ID. If an operator intentionally replaces the application in the same tenant, Entra changes the application-specific `sub`; Hub uses the signed tenant `oid` to migrate the existing external identity to the new subject and records that migration. This continuity does not link providers or tenants.

`jit-assignment` creates an `oidc-assignment` membership for a newly seen identity that has `Hub.User` or `Hub.Administrator`. Those provider-owned memberships continue to track the current mapped app role. `invitation-required` also requires a matching Hub invitation. For Entra invitations, enter the user's tenant directory object ID (`oid`), which an administrator can copy from the user's **Object ID** in the Entra admin center or read through approved Microsoft Graph directory tooling. Hub keeps the application-specific OIDC `sub` as the external sign-in identity and uses the tenant-scoped `oid` only to match the pre-created invitation. An administrator invitation is not consumed until the provider also grants `Hub.Administrator`; Hub never silently activates it as a member. Invitation, bootstrap, recovery, and manually changed memberships preserve their Hub-owned role instead of being overwritten by later app-role claims. Both policies preserve suspended membership. A removed membership returns only through a new matching invitation; an app-role claim alone does not silently reactivate it. Hub refuses a claim-driven demotion of an `oidc-assignment` membership that would remove the final active administrator.

## Identity and lifecycle boundaries

OIDC proves the immutable tuple `provider + issuer/tenant + subject`. Preferred username, email, name, and picture are mutable display attributes and are never identity or authorization keys. The signed Entra `oid` claim is a separate tenant-scoped invitation assignment key. Hub discards the authorization code, ID token, access token, and any refresh token after extracting and validating identity, directory assignment, and role claims.

JIT provisioning occurs only during a successful sign-in and creates or refreshes Hub membership under the configured admission policy. It is not SCIM: Hub does not synchronize users, groups, suspension, or removal in the background. Entra assignment and app roles control installation admission and administrator mapping; they do not grant future prototype, repository, workspace, artifact, or review permissions.

Keep at least one group assigned to `Hub.Administrator`. Administrator recovery still requires both the host-held recovery secret and a signed `Hub.Administrator` app-role claim; it does not bypass a missing tenant assignment.

Hub sign-out revokes the opaque Hub session. It does not assume or initiate Entra single sign-out. Provider logout can be added later as a separately configured deployment behavior.
