# Hub identity

Hub keeps user sign-in, repository integration, and infrastructure credential storage as separate choices. GitHub user authorization and GitHub repository access remain the production-capable adapters. The local [identity provider demo](identity-provider-demo.md) also exposes an explicitly guarded OIDC simulation for discussion and recording.

Hub uses a temporary GitHub user token to identify the person, then discards it. Hub uses separate, short-lived App installation tokens to check repository access. Neither token is stored in the database.

## Configure credentials

1. Apply migrations with `npm run db:deploy`. Set `DATABASE_URL` and `HUB_ORIGIN` from the [environment example](../.env.example). Use HTTPS, except for local HTTP.
2. Create a private GitHub App. Set its callback to `${HUB_ORIGIN}/api/auth/github/callback`. Enable user authorization and repository Administration read permission. Install it on the repos Hub will use.
3. Copy the numeric installation ID from the end of its settings URL. Hub uses only this installation.
4. Choose a provider below. Set a separate `HUB_BOOTSTRAP_SECRET` of at least 32 random characters for initial setup or operator enrollment. Never commit secrets.

`HUB_SIGN_IN_PROVIDERS` explicitly selects one or more sign-in adapters. The supported production value is `github`. `oidc-demo` is accepted only with `HUB_DEMO_MODE=true`; Hub refuses to start rather than silently replacing an unavailable provider.

`HUB_REPOSITORY_PROVIDER` selects `github` or `none`. A missing repository provider does not block a provider-neutral Hub session, but GitHub-dependent capabilities return an explicit unavailable error.

`HUB_CREDENTIAL_PROVIDER` independently selects where the GitHub adapter reads App and OAuth credentials:

| Provider | Operator configuration | Credential changes |
| --- | --- | --- |
| `database` (default) | Set `HUB_CREDENTIAL_KEY` outside PostgreSQL. | Hub encrypts credentials during initial setup and administrator rotation. |
| `environment` | Set each `GITHUB_*` value in the [environment example](../.env.example). | Change the environment and restart the API. Hub cannot write to this provider. |
| `none` | Use only with an OIDC-only local demo and `HUB_REPOSITORY_PROVIDER=none`. | GitHub sign-in, setup, and repository access stay unavailable. |

Generate the database encryption key with `openssl rand -hex 32`. Back it up separately from the database. Changing this key without re-encrypting stored credentials prevents Hub from reading them.

Set a separate `HUB_BOOTSTRAP_SECRET` of at least 32 random characters to configure the App or enroll an operator. Never commit either secret. An empty database provider permits startup only when this bootstrap secret is configured. Hub allows setup but refuses GitHub sign-in until credentials exist. An OIDC-only demo with the `none` credential provider does not need these GitHub secrets.

Hub refuses to start if it cannot read a required provider or connect to the database. It never switches to another provider automatically.

Create a private GitHub App on GitHub.com. Register `${HUB_ORIGIN}/api/auth/github/callback` as its callback URL. Enable user authorization and grant repository Administration read permission for collaborator checks. Install the App on the intended repositories.

Configure one installation for this Hub. Open the App's installation settings and use the numeric ID at the end of its URL. Supply `installationId` during database setup, or set `GITHUB_INSTALLATION_ID` for the environment provider. Hub validates the App key and installation before activating submitted credentials. It saves this ID with the App credentials and never searches other installations.

Keep the App private. With an organization-owned private App, every organization member can pass Hub's read check for a connected public repository.

## API operations

Send JSON bodies and an `Origin` header matching `HUB_ORIGIN` for changes. Signed-in changes also need the `X-CSRF-Token` from `GET /api/session`.

| Request | Action |
| --- | --- |
| `GET /api/identity/configuration` | Return enabled sign-in adapters, whether each is configured, the repository provider, and whether explicit demo mode is active. |
| `POST /api/setup/github` | With `X-Hub-Bootstrap-Secret`, save the initial `{appId, installationId, clientId, clientSecret, privateKey}`. Supply both IDs as positive decimal strings. Setup cannot replace existing credentials. |
| `POST /api/auth/github` | Return a GitHub authorization `url`. Open it in the same browser to sign in. |
| `POST /api/auth/github-demo` | In explicit demo mode only, simulate a completed GitHub callback for a configured GitHub App. |
| `POST /api/auth/oidc-demo` | In explicit demo mode only, create a provider-neutral session from a simulated local OIDC profile. |
| `POST /api/operator/enrollment` | With `X-Hub-Bootstrap-Secret`, start a GitHub sign-in that enrolls the verified person as a Hub administrator. |
| `GET /api/auth/github/callback` | Complete sign-in and redirect to `/api/session`. |
| `GET /api/session` | Return the person's Hub identity, session ID, sign-in time, and CSRF token. |
| `DELETE /api/session` | End this browser session and cancel its pending verification attempts. |
| `POST /api/auth/github/verify` | Verify the same GitHub account again for this session. |
| `GET /api/repositories/:owner/:repository/access` | Check the installed App and the person's current repository permission. Return `read`, `write`, or `admin`, or deny access. |
| `PUT /api/administration/github-credentials` | A freshly verified administrator submits `{confirmed: true, credentials: {...}}` to rotate credentials for the same App, client ID, and installation. |
| `POST /api/administration/revoke-sessions` | A freshly verified administrator submits `{confirmed: true}` to end every existing session, including their own. |
| `GET /api/administration/security-audit` | An administrator reads the latest 100 identity audit records. |

The last three routes require an administrator. Rotation and revocation also need a GitHub check in that session, less than five minutes old. GitHub may reuse its login without asking for a password or a second sign-in step.

## Access and recovery

Bootstrap administrator enrollment is one-use. After the first administrator is enrolled, Hub rejects further bootstrap enrollment even when the caller still knows the bootstrap secret.

Every repository request uses a token for the configured installation to check GitHub permission for the signed-in account. Repositories outside that installation are inaccessible through Hub, even if the same App is installed on them. Administrator status does not bypass this check. Hub denies the request if GitHub cannot confirm access.

A GitHub sign-in attempt expires after 15 minutes and can be used only once in its initiating browser. Hub keeps session cookies inaccessible to JavaScript and limits them to the Hub host. HTTPS cookies also require a secure connection. Identity responses are not cached.

GitHub authorization initiation, verification, enrollment, the callback, and the local GitHub and OIDC simulations are limited to 60 requests per five minutes for each request IP. This in-memory guard is bounded and suitable for the local demo. A multi-instance deployment needs a shared rate-limit store and an explicit trusted-proxy configuration.

Fresh verification applies only to its initiating session and lasts less than five minutes. Signing in elsewhere does not refresh an existing session. GitHub may reuse its own browser session without prompting for a password or multifactor authentication.

A server session lasts until sign-out or administrator revocation. Closing the browser does not reliably end it. Hub does not continuously detect GitHub account suspension. Use explicit session revocation when immediate containment is required.

Credential rotation retains browser sessions but cancels pending sign-ins and invalidates fresh verification. Environment changes take effect on restart. Hub does not cache installation tokens. Keep old GitHub keys available until requests already sent with them finish.

Ending all sessions also cancels sign-ins already in progress. A late GitHub callback cannot create another session after revocation. Repository requests check that their session still exists after GitHub returns.

## Security records

Hub saves each completed identity change with its audit record, or saves neither. Rejected requests create no audit records. Only administrators can read them.

Records keep user and session IDs, not secrets or request bodies. Reads cover 90 days; later writes remove older records. There is no scheduled cleanup or tamper protection. Repo activity is not audited here.
