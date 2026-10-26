# Hub identity

People sign in with GitHub. Hub checks repo access through one GitHub App installation. The API works without the frontend or canvas.

## Configure credentials

1. Apply migrations with `npm run db:deploy`. Set `DATABASE_URL` and `HUB_ORIGIN` from the [environment example](../.env.example). Use HTTPS, except for local HTTP.
2. Create a private GitHub App. Set its callback to `${HUB_ORIGIN}/api/auth/github/callback`. Enable user authorization and repository Administration read permission. Install it on the repos Hub will use.
3. Copy the numeric installation ID from the end of its settings URL. Hub uses only this installation.
4. Choose a provider below. Set a separate `HUB_BOOTSTRAP_SECRET` of at least 32 random characters for initial setup or operator enrollment. Never commit secrets.

| `HUB_CREDENTIAL_PROVIDER` | Setup |
| --- | --- |
| `database` (default) | Generate `HUB_CREDENTIAL_KEY` with `openssl rand -hex 32`. Save the App details through the setup API. Hub encrypts them. |
| `environment` | Set every `GITHUB_*` value in the [example](../.env.example), including `GITHUB_INSTALLATION_ID`. To change them, edit the environment and restart Hub. |

Back up the encryption key apart from the database. Losing or replacing it makes saved credentials unreadable. Hub refuses to start if its chosen provider or database fails. An empty database provider needs the bootstrap secret; sign-in stays blocked until setup.

Keep the App private. For an organization-owned private App, all organization members can pass the read check for a connected public repo.

## API operations

Send JSON bodies and an `Origin` header matching `HUB_ORIGIN` for changes. Signed-in changes also need the `X-CSRF-Token` from `GET /api/session`.

| Request | Action |
| --- | --- |
| `POST /api/setup/github` | Send `{appId, installationId, clientId, clientSecret, privateKey}` and `X-Hub-Bootstrap-Secret`. IDs are positive decimal strings. Setup works only once. |
| `POST /api/auth/github` | Open the returned `url` in the same browser. |
| `POST /api/operator/enrollment` | Start sign-in to become a Hub administrator. Requires `X-Hub-Bootstrap-Secret`. |
| `GET /api/auth/github/callback` | Finish sign-in and redirect to `/api/session`. |
| `GET /api/session` | Read the user, session ID, sign-in time, and CSRF token. |
| `DELETE /api/session` | Sign out this browser. |
| `POST /api/auth/github/verify` | Verify this session's GitHub account again. |
| `GET /api/repositories/:owner/:repository/access` | Check current access: `read`, `write`, or `admin`. |
| `PUT /api/administration/github-credentials` | Rotate credentials with `{confirmed: true, credentials: {...}}`. Keep the same App, client, and installation IDs. |
| `POST /api/administration/revoke-sessions` | End all sessions with `{confirmed: true}`. |
| `GET /api/administration/security-audit` | Read the latest 100 security records. |

The last three routes require an administrator. Rotation and revocation also need a GitHub check in that session, less than five minutes old. GitHub may reuse its login without asking for a password or a second sign-in step.

## Access and recovery

- Hub uses permanent GitHub user IDs, not names or emails. Ordinary sign-in needs read access to a repo in the chosen installation. Administrators may sign in without repo access, but cannot bypass repo checks.
- Repo checks use current GitHub permissions. Repos outside the chosen installation stay blocked. GitHub failures deny access.
- Sign-in links expire in 15 minutes and work once in the same browser. Cookies are host-only and hidden from JavaScript. HTTPS cookies require a secure connection. Identity responses are not cached.
- Hub discards user tokens after checking identity. It does not store installation tokens.
- Sessions last until sign-out or revocation; closing the browser may not end them. Hub does not detect account suspension on its own. Revoke sessions to cut off access right away.
- Rotation keeps sessions but cancels pending sign-ins and fresh verification. Keep old GitHub keys until requests already sent with them finish.
- Revocation ends every session, including yours, and cancels pending sign-ins. Late callbacks cannot restore them.

## Security records

Hub saves each completed identity change with its audit record, or saves neither. Rejected requests create no audit records. Only administrators can read them.

Records keep user and session IDs, not secrets or request bodies. Reads cover 90 days; later writes remove older records. There is no scheduled cleanup or tamper protection. Repo activity is not audited here.
