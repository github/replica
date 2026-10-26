# Hub identity

The TypeScript API supports GitHub App sign-in, browser sessions, operator enrollment, and current repository permission checks. The frontend, canvas, previews, and product APIs are not connected to this boundary yet. This branch is not a production deployment.

Hub separates the signed-in person from its GitHub App installation and its database connection. GitHub user tokens exist only inside the sign-in integration while it reads the person's identity. Repository checks use short-lived App installation tokens. Neither kind of token is saved in Hub.

## Configure credentials

Apply the committed migrations with `npm run db:deploy` before starting the API. Set `DATABASE_URL` and `HUB_ORIGIN`. The origin must use HTTPS in production; development permits HTTP only on a loopback host. The Vite development origin is `http://127.0.0.1:5173`.

`HUB_CREDENTIAL_PROVIDER` explicitly selects one source:

| Provider | Configuration | Hub writes |
| --- | --- | --- |
| `database` (default) | `HUB_CREDENTIAL_KEY`, a 32-byte hexadecimal encryption key kept outside PostgreSQL | Initial setup and administrator rotation save AES-256-GCM encrypted credentials. |
| `environment` | `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY` | Read-only. Change the environment and restart the API. |

Generate the database encryption key with `openssl rand -hex 32`. Back it up separately from the database. Replacing it without re-encrypting existing credentials prevents Hub from reading them. Set a separate `HUB_BOOTSTRAP_SECRET` of at least 32 characters when setting up Hub or enrolling an operator. Never commit these values.

Startup checks the selected provider and database. Missing environment credentials, an unknown provider, or unreadable encrypted credentials stop startup. There is no fallback. An empty database provider permits a restricted setup state only when a bootstrap secret is configured. Sign-in and protected identity reads remain unavailable until credentials exist.

Create a private GitHub App and register `${HUB_ORIGIN}/api/auth/github/callback` as its callback URL. Enable user authorization and installation access, including repository Administration read permission for collaborator permission checks. Install the App on the intended repositories. An organization-owned private App admits organization members; connecting a public repository can therefore expose its Hub reviews to every organization member. Keep the App private.

This slice supports GitHub.com. GitHub Enterprise Server, App-manifest registration, webhooks, local identity, OIDC, trusted proxies, mounted files, and managed secret stores are not implemented.

## API flow

All mutation requests must send an `Origin` header matching `HUB_ORIGIN`. Send JSON for request bodies. Signed-in mutations additionally require `X-CSRF-Token` from `GET /api/session`. Hub issues host-only, HTTP-only, SameSite=Lax cookies; HTTPS cookies also use Secure and the `__Host-` prefix. Identity responses are not cached.

| Request | Result |
| --- | --- |
| `POST /api/setup/github` | With `X-Hub-Bootstrap-Secret`, save the initial `{appId, clientId, clientSecret, privateKey}`. An existing App cannot be overwritten through setup. |
| `POST /api/auth/github` | Return an authorization `url` and set the browser's one-use OAuth cookie. Navigate that browser to the URL. |
| `POST /api/operator/enrollment` | With `X-Hub-Bootstrap-Secret`, start a GitHub sign-in that explicitly enrolls the verified person as a Hub administrator. App ownership and ordinary sign-in do not grant this role. |
| `GET /api/auth/github/callback` | Consume the browser-bound state, check GitHub identity and admission, issue a new session, and redirect to `/api/session`. |
| `GET /api/session` | Return the stable Hub user ID, provider identity, mutable profile, session ID, sign-in time, and CSRF token. |
| `DELETE /api/session` | Revoke this browser session and its pending verification attempts. |
| `POST /api/auth/github/verify` | Begin fresh verification for this session. The callback must identify the same permanent GitHub account. |
| `GET /api/repositories/:owner/:repository/access` | Return `read`, `write`, or `admin` only after checking the installed App and current GitHub permission for the exact signed-in GitHub ID. |
| `PUT /api/administration/github-credentials` | A freshly verified administrator submits `{confirmed: true, credentials: {...}}` to rotate credentials for the same App and client ID. |
| `POST /api/administration/revoke-sessions` | A freshly verified administrator submits `{confirmed: true}` to end every existing session, including their own. |
| `GET /api/administration/security-audit` | A current administrator reads the latest 100 global identity audit records. This does not grant repository access. |

The frontend does not yet expose these operations. The callback deliberately returns the API session representation rather than navigating to a retained screen whose backend no longer exists.

## Sessions and authorization

Hub identifies a person by the provider and permanent GitHub user ID, not their login or email address. Ordinary sign-in requires read access to at least one installed repository, unless the person is an explicitly enrolled administrator. Every repository request independently checks GitHub; administrator status never bypasses that check. GitHub errors deny access rather than reuse an older answer.

The OAuth attempt has random state, PKCE, a separate browser secret, a 15-minute deadline, and one-use consumption. Fresh verification updates only its initiating live session. Its proof is valid for strictly less than five minutes. It does not guarantee that GitHub prompts for a password or multifactor authentication. Signing in elsewhere does not refresh an existing session.

The browser cookie has no persistent lifetime. The server session remains valid until sign-out or deployment revocation; closing a browser is not a reliable server-side revocation control. Hub does not retain a user token or continuously detect GitHub account suspension. Operators must use explicit session revocation when immediate containment is required.

Credential rotation retains browser sessions but invalidates their fresh proof and outstanding OAuth attempts. Every integration operation resolves the selected credentials anew; installation tokens are not cached. Environment changes take effect on restart. A changed credential fingerprint rejects old OAuth attempts and fresh proof. Never remove old GitHub keys until operations already sent with them have completed or failed.

Revocation and database credential rotation share a PostgreSQL lock with session issuance and verification. A persisted generation prevents an OAuth callback already waiting on GitHub from issuing a session after the cutoff. Repository authorization rechecks the live session and credential fingerprint after waiting on GitHub. No live connections or canvas grants exist in this API yet; those features must use the same persisted revocation boundary when rebuilt.

## Audit and remaining work

Setup, enrollment, sign-in, verification, sign-out, rotation, and deployment revocation save nonsecret success records in the same transaction as their state change. An audit write failure rolls back that change. HTTP denials and failures record a fixed reason code separately; failure to save that record returns service unavailable. Records retain stable actor and session IDs after sign-out and are visible only to current administrators. They contain no credential values, OAuth state, user tokens, or request bodies. Reads cover the last 90 days; audit writes remove older records. A quiet deployment has no scheduled cleanup yet.

The initial identity audit has no retention job, repository-scoped records, or tamper protection. Shared security rate limits, administrator removal, canvas grants and live disconnects, account linking, enterprise deprovisioning, and stronger audit controls remain follow-ups before a production replacement. Database and provider errors return a fixed actionable error without logging secret values. Automated checks use synthetic GitHub responses; real GitHub sign-in and deployment behavior require an authorized integration environment.
