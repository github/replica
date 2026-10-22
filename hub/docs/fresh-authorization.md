# Fresh GitHub authorization

Adding, editing, pausing, resuming, or deleting an analytics destination requires GitHub to have verified the same account within the last five minutes. Hub administrator role changes, deployment public-sharing settings, GitHub App maintenance, and connecting or disconnecting Copilot also require fresh proof on the same browser Session and deliberate confirmation. Existing repository permissions still apply; Hub administration never grants repository access. New never-expiring share links are rejected by the [maximum-lifetime policy](share-links.md#link-lifetime), even with fresh proof.

[Ending all Hub sessions](session-revocation.md) requires a current Hub administrator, deliberate confirmation including their own sign-out, and fresh proof on that same browser Session. The action cancels outstanding challenges as well as the credentials they would renew.

Only the isolated local-development analytics demo differs: its local developer may edit configured local repositories without a GitHub proof. The exception lives in that analytics controller, not the reusable gate. Local mode requires development, an explicit opt-in flag, and a localhost Hub origin; production rejects it. Demo editing never creates freshness or exempts unrelated sensitive operations.

For example, adding an analytics destination after that window opens **Verify with GitHub** before saving it. Complete the check and Hub continues the action you already submitted, without asking you to enter the settings again. Hub temporarily encrypts the selected operation and its submitted settings, including credentials, in the challenge record. Settings never enter OAuth state, callback URLs, browser continuation forms, or security logs.

## Scope and proof

Freshness belongs to one Hub browser `Session` or one `CanvasGrant`, never the user globally. A successful ordinary GitHub sign-in establishes freshness only on its new Session. A canvas approval, access-token renewal, activity assertion, or newly created grant does not prove fresh identity. Canvas connections must complete their own check. Connections reused across panels share the same grant and therefore the same five-minute authorization; different grants remain independent.

GitHub may reuse its signed-in browser session. **Fresh authorization is not a guaranteed password or MFA challenge.** Hub discards the temporary GitHub token after reading the verified identity. It does not change GitHub App grants or retain access or refresh tokens.

The window is strictly less than five minutes: at exactly five minutes, Hub requires another check. The challenge expires after 15 minutes. Hub binds it to a server-selected purpose, initiating credential, immutable GitHub identity, one-use state, and expiry. It extends the existing state/PKCE flow and registered `/auth/github/callback`; existing deployments need no App reset or callback change.

The callback rechecks that the Session exists or the grant still has active access. It checks challenge expiry again under the initiating credential's lock and records one verification time on both records. Removed, revoked, expired, mismatched, cancelled, or failed challenges cannot renew a credential. Success updates only the initiating credential. For a saved browser action, Hub then opens a continuation page that automatically submits an opaque, one-use reference to the original CSRF-protected route. A **Continue** button is available if automatic submission does not run. The original controller rechecks permissions, confirmation, target state and freshness before changing anything and reports the actual result.

Continuation covers administrator role changes, analytics destination changes, deployment sharing settings, ending all sessions, GitHub App reset and credential replacement, webhook rotation and Copilot connection changes. Hub saves only explicitly allowed fields for these operations, not arbitrary requests. Each action is bound to its original browser Session, GitHub identity, purpose, route and HTTP method. Other input cannot replace the saved selection. The continuation expires with the 15-minute challenge and still needs fresh proof when submitted. An atomic claim removes the saved fields before one execution attempt; refreshes, repeated callbacks and duplicate submissions cannot execute it again. A failed or interrupted attempt requires checking the current state before explicitly trying again.

## Browser and canvas flow

Browser mutations without fresh identity redirect to the explicit challenge page. Verify, Cancel and continuation use CSRF-protected forms. Cancelling or failing verification discards the saved action without executing it. Expired encrypted payloads are removed by hourly challenge cleanup. Submitted payloads are limited to 128 KiB; private keys retain their 16 KiB limit. Unsupported or oversized input reports a visible failure rather than silently dropping the action.

Reading or cancelling an unrelated challenge does not interrupt a pending GitHub check. Starting another check replaces the browser's state only after Hub binds the new challenge. An invalid operator-enrollment secret also leaves the pending check intact.

Canvas mutations return HTTP 403:

```json
{
  "code": "fresh_authorization_required",
  "errors": ["Fresh GitHub authorization is required. No changes were made. Verify your account, then submit the action again."],
  "authorization": {
    "url": "https://replica.example.com/authorization/12345678-1234-1234-1234-123456789abc",
    "expiresAt": "2026-10-05T23:00:00Z"
  }
}
```

The extension accepts only the selected Hub's exact challenge route. **Verify with GitHub** opens that saved request explicitly; rendering, focus, polling, and failed creation do not launch a browser. After verification, refresh links and submit again. The extension preserves its existing checkout and grant checks and never automatically retries a challenged mutation.

## Reusable server gate

Controllers include `FreshAuthorizationRequired` and call `require_fresh_authorization(purpose:, return_to:)` only after their normal permission checks. It returns true when the current credential is fresh. Otherwise it renders the canvas response or redirects the browser and returns false. Call it from a `before_action`, or explicitly `return if !require_fresh_authorization(...)` before any side effect. A redirect alone does not stop an action.

`FreshAuthorization.fresh?(credential)` rereads the live Session or grant and evaluates Hub's stored timestamp. Callers cannot submit an actor ID or timestamp as proof. Hub administrator role changes use `hub_admin_management`; deployment public-sharing changes use `sharing_settings`; ending all sessions uses `session_revocation`. App reset, credentials, webhook update/retry, and ending overlap use `github_app_reset`, `github_app_credentials`, `github_app_webhook`, and `github_app_finish_webhook`. Each rereads role, Session, and freshness inside its serialized mutation. Administrator challenges require a live GitHub-backed Hub administrator's browser Session and recheck that role when starting, binding, claiming, and completing OAuth.

OAuth checks bind independently to the deployment session generation and the initiating App configuration and credential revision. Replacement credentials invalidate old in-flight checks and stored freshness without revoking live Sessions/connections or changing the session generation. A callback checks both snapshots before exchange and again before Session issuance, enrollment, or proof renewal. Reset removes the configuration and advances the session cutoff, so an old callback cannot restore credentials.

Challenge requests and successful, denied, or failed start, verification, and cancellation decisions use the separate security audit with the initiating actor and credential. Validation-only failures when reading unknown, expired, or foreign challenges do not create persistent security records; ordinary request logs and visible failure messages remain. Continued sensitive actions retain their existing audit records and rate limits. Challenges retain only the encrypted, allowed fields needed for continuation and expire through hourly cleanup. They never enter analytics.

## Setup and recovery commands

Before an App exists, OAuth cannot verify an identity. Initial `/setup` remains bootstrap-secret protected, followed by the separate secret-plus-verified-identity operator enrollment. App creation does not designate an operator.

Routine App maintenance uses `/github_app`, not host rotation/reset tasks or canvas endpoints. The sole emergency command, `replica:github:recover_credentials`, uses privileged host access, an exact confirmation, protected replacement files, and verification of the same App/owner. It does not require bootstrap possession or working OAuth, and it accepts no browser-issued CLI proof. It repairs credentials in place, preserving data and live credentials while invalidating pending checks and fresh proof. Candidate-key verification does not prove the client secret works; a subsequent ordinary sign-in does. See [GitHub App setup](github-app-setup.md#emergency-same-app-credential-recovery).
