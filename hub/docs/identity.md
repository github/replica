# Hub identity

People sign in to Hub with GitHub. Operators choose where Hub reads its GitHub App credentials. These operations are available through the API; the retained frontend and canvas do not call them.

Hub uses a temporary GitHub user token to identify the person, then discards it. Hub uses separate, short-lived App installation tokens to check repository access. Neither token is stored in the database.

## Configure credentials

Apply the committed migrations with `npm run db:deploy` before starting the API. Set `DATABASE_URL` and `HUB_ORIGIN` using the [environment example](../.env.example). Use HTTPS for the Hub origin in production. Development also permits HTTP on a loopback host.

`HUB_CREDENTIAL_PROVIDER` selects one source:

| Provider | Operator configuration | Credential changes |
| --- | --- | --- |
| `database` (default) | Set `HUB_CREDENTIAL_KEY` outside PostgreSQL. | Hub encrypts credentials during initial setup and administrator rotation. |
| `environment` | Set each `GITHUB_*` value in the [environment example](../.env.example). | Change the environment and restart the API. Hub cannot write to this provider. |

Generate the database encryption key with `openssl rand -hex 32`. Back it up separately from the database. Changing this key without re-encrypting stored credentials prevents Hub from reading them.

Set a separate `HUB_BOOTSTRAP_SECRET` of at least 32 random characters to configure the App or enroll an operator. Never commit either secret. An empty database provider permits startup only when this bootstrap secret is configured. Hub allows setup but refuses sign-in until credentials exist.

Hub refuses to start if it cannot read the selected provider or connect to the database. It never switches to another provider automatically.

Create a private GitHub App on GitHub.com. Register `${HUB_ORIGIN}/api/auth/github/callback` as its callback URL. Enable user authorization and grant repository Administration read permission for collaborator checks. Install the App on the intended repositories.

Configure one installation for this Hub. Open the App's installation settings and use the numeric ID at the end of its URL. Supply `installationId` during database setup, or set `GITHUB_INSTALLATION_ID` for the environment provider. Hub saves this ID with the App credentials and never searches other installations.

Keep the App private. With an organization-owned private App, every organization member can pass Hub's read check for a connected public repository.

## API operations

Send an `Origin` header matching `HUB_ORIGIN` with every mutation. Use JSON for request bodies. Signed-in mutations also require the `X-CSRF-Token` returned by `GET /api/session`.

| Request | Result |
| --- | --- |
| `POST /api/setup/github` | With `X-Hub-Bootstrap-Secret`, save the initial `{appId, installationId, clientId, clientSecret, privateKey}`. Supply both IDs as positive decimal strings. Setup cannot replace existing credentials. |
| `POST /api/auth/github` | Return a GitHub authorization `url`. Open it in the same browser to sign in. |
| `POST /api/operator/enrollment` | With `X-Hub-Bootstrap-Secret`, start a GitHub sign-in that enrolls the verified person as a Hub administrator. |
| `GET /api/auth/github/callback` | Complete sign-in and redirect to `/api/session`. |
| `GET /api/session` | Return the person's Hub identity, session ID, sign-in time, and CSRF token. |
| `DELETE /api/session` | End this browser session and cancel its pending verification attempts. |
| `POST /api/auth/github/verify` | Verify the same GitHub account again for this session. |
| `GET /api/repositories/:owner/:repository/access` | Check the installed App and the person's current repository permission. Return `read`, `write`, or `admin`, or deny access. |
| `PUT /api/administration/github-credentials` | A freshly verified administrator submits `{confirmed: true, credentials: {...}}` to rotate credentials for the same App, client ID, and installation. |
| `POST /api/administration/revoke-sessions` | A freshly verified administrator submits `{confirmed: true}` to end every existing session, including their own. |
| `GET /api/administration/security-audit` | An administrator reads the latest 100 identity audit records. |

## Sessions and access

Hub identifies people by their permanent GitHub user ID, not their login or email address. Ordinary sign-in requires read access to at least one repository in the configured installation. Enrolled administrators may sign in without repository access. App ownership and ordinary sign-in never grant the administrator role.

Every repository request uses a token for the configured installation to check GitHub permission for the signed-in account. Repositories outside that installation are inaccessible through Hub, even if the same App is installed on them. Administrator status does not bypass this check. Hub denies the request if GitHub cannot confirm access.

A GitHub sign-in attempt expires after 15 minutes and can be used only once in its initiating browser. Hub keeps session cookies inaccessible to JavaScript and limits them to the Hub host. HTTPS cookies also require a secure connection. Identity responses are not cached.

Fresh verification applies only to its initiating session and lasts less than five minutes. Signing in elsewhere does not refresh an existing session. GitHub may reuse its own browser session without prompting for a password or multifactor authentication.

A server session lasts until sign-out or administrator revocation. Closing the browser does not reliably end it. Hub does not continuously detect GitHub account suspension. Use explicit session revocation when immediate containment is required.

Credential rotation retains browser sessions but cancels pending sign-ins and invalidates fresh verification. Environment changes take effect on restart. Hub does not cache installation tokens. Keep old GitHub keys available until requests already sent with them finish.

Ending all sessions also cancels sign-ins already in progress. A late GitHub callback cannot create another session after revocation. Repository requests check that their session still exists after GitHub returns.

## Security records

Hub saves each completed identity change together with its audit record, or saves neither. Hub does not create audit records for malformed input or other rejected requests.

Only current administrators can read these records. Records retain actor and session IDs after sign-out, but never credentials, OAuth state, or request bodies. Reads cover the last 90 days. Audit writes remove older records; cleanup does not run on a schedule.

These records cover global identity operations, not repository activity. They have no tamper protection.
