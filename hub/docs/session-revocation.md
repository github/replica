# End all Hub sessions

A Hub administrator can sign everyone out of the deployment, including themselves. For example, open **End all Hub sessions** from the deployment security audit, read the scope, check the confirmation box, then select **End all sessions**. The result stays in that browser without redirecting to a page that requires sign-in.

This ends existing authentication, not the ability to sign in. People can complete a new GitHub sign-in and explicitly approve a new canvas connection afterward. GitHub permissions, administrator roles, retained Builds, and review data do not change. Public share links and their public previews follow a separate policy and remain usable.

## Authorization and confirmation

Only a current, persisted, GitHub-backed Hub administrator may open `/session_revocation` or submit its CSRF-protected form. The same browser Session must have verified the same GitHub identity strictly less than five minutes ago. Another browser's proof or a canvas grant cannot authorize this action.

If Hub opens **Verify with GitHub**, complete that check and Hub continues the session revocation you already confirmed, including ending your own session. Cancel and missing confirmation leave all credentials unchanged and record a denial. See [Fresh GitHub authorization](fresh-authorization.md).

The page explains that the operator's own Session will end. Counts are advisory: new sessions or approvals can arrive before confirmation. With only the operator's browser remaining, the action still ends that Session.

## Cutoff and affected credentials

Hub serializes the cutoff, its success audit, and the live actor, same-browser Session, and freshness checks in one SQLite write transaction. An overlapping role removal or ended initiating Session cannot authorize the action using stale objects.

At commit, Hub deletes browser Sessions and their signed-in preview handoffs. It marks all existing canvas grants revoked, including renewable grants whose access tokens already expired. It cancels pending canvas pairings, approved but unconsumed pairings, fresh-authorization challenges, and operator-enrollment proofs. No pending proof is left to expire naturally.

The transaction also advances a persisted deployment generation. Ordinary OAuth captures that generation when it starts; Session issuance rereads it inside a write transaction. A callback that started before the cutoff cannot issue a Session afterward, including when GitHub's response was already in flight. The user receives a message to start a new sign-in. New OAuth flows use the new generation.

Canvas approval rereads its initiating browser Session under the approval lock. Consumption rereads the pairing under its lock; deleted pairings cannot issue grants. Renewal and interactive activity reread revocation under the grant lock. Preview issuance and one-use consumption reread the persisted Session. An operation committed before the cutoff is included; an old credential waiting behind it is denied. GitHub checks remain outside these write transactions.

## Requests and live connections

Browser requests restore their persisted Session. Every signed-in preview request reloads the Session named in its separate, host-only preview cookie; signing in elsewhere cannot unlock that old cookie. Preview repository checks and canvas API repository checks also recheck credential existence after waiting on GitHub.

After the cutoff commits, Hub requests disconnects for the exact ended browser Session and canvas-grant IDs, with automatic reconnection disabled. A new sign-in is not included in those commands. Live connections check persisted credentials at connection, subscription, each review notice, and the one-minute periodic check. A connection racing with disconnect delivery cannot use a stale credential to subscribe or receive another notice.

If the connection transport fails, the result explicitly distinguishes committed credential revocation from incomplete disconnect delivery. HTTP credentials and new subscriptions remain denied; notice delivery checks and periodic checks close old connections. Hub records the delivery failure separately and emits a fixed, nonsecret operator log message.

Saved canvas credential files stay private to Node. The existing client marks rejected refresh credentials invalid and explains that the connection expired or was revoked and requires a new approval. Reopening, polling, or another person's browser sign-in never unlocks that saved connection automatically. The independently running local prototype remains usable.

## Audit and boundaries

The success event is `session_revocation.end_all`; cancellation, unauthorized requests, missing confirmation, and freshness challenges record denial. `session_revocation.disconnect` records transport failure. Audit failure rolls back the database cutoff instead of silently losing evidence.

The global audit retains the initiating user ID, nonsecret Session ID, source IP, and fixed device/browser categories after Session deletion. It never stores credentials, OAuth state, request bodies, or raw headers. Its immutable scope and retention are unchanged; see [Security audit](security-audit.md).

This control does not detect account suspension, revoke public shares, erase previously delivered client content, or disable login permanently. Hub and signed-in/public preview origins, prototype sandboxing, immutable artifacts, CSRF protection, and host checks remain unchanged. Existing privileged App maintenance commands also remain unchanged.
