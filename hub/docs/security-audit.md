# Security audit

Hub keeps a separate record of security actions. For example, creating a public share link records the action, time, actor, source IP, and outcome without storing the link's public URL or label. These records never enter repository analytics or external delivery queues.

## Access

Open **Security audit** in the sidebar's lower group, then choose **Audit scope**. For example, a repository administrator can select `github/prototype`; a Hub administrator can select **Hub**. Users with both roles see both independently authorized choices. Repository-only administrators see the audit entry but no Hub-only settings. There is no combined all-repository scope.

Existing links still work: `/security_audit` selects Hub records, and `/repositories/:id/security_audit` selects that repository's records. Hub rereads the saved GitHub-backed Hub role for deployment records and checks fresh GitHub repository-admin permission on every repository read and before offering repository scope choices. Readable repository navigation is not proof of repository-admin permission. Missing repositories and selected-scope verification failures still deny access. A failure checking an optional scope hides that choice with an explicit warning, not an access grant or an empty successful audit. Older-page links remain within the selected scope.

Repository and administration pages use one sidebar, account menu, and content frame. A real readable repository supplies the normal picker and prototype navigation; **Analytics** sits directly below **Prototypes** and requires repository-admin permission. App settings, Copilot, administrators, public sharing, session revocation, and the single audit entry sit in the lower group above **Collapse sidebar** and the account menu. Hub-only links use the live saved role. No visible scope heading or nested administration menu is needed; the collapsed rail retains link labels and tooltips.

An operator with no accessible repository gets the same sidebar without repository controls. Repository context on a Hub page is navigation only, never authorization for its content. After Hub-role removal, signed-in denials retain account controls and independently authorized repository navigation, including repository audit for repository admins, but no Hub links or actions. Signed-out results retain no authenticated navigation.

This deployment-wide view includes only records originally recorded without a repository. Being a Hub administrator does not grant repository access or permission to read another repository's audit log. Each page returns at most 50 records, with a link to older records. There is no audit export or audit-editing interface.

Records keep their original scope if a repository is deleted. Its retained records remain excluded from deployment views; a missing repository reference does not make them global records.

## Enroll an operator

After GitHub App setup, open `/operator/enrollment`. Enter `REPLICA_BOOTSTRAP_SECRET`, then complete a new GitHub sign-in in the same browser. Hub designates only the account GitHub verifies in that callback. The operator can sign in and read deployment records even without an installed repository.

Existing configured deployments use the same enrollment route without resetting their App. The persisted Hub-admin flag defaults to false. Neither the first person to sign in nor the App's organization owner automatically becomes a Hub operator.

Enrollment expires after 15 minutes. A server-side, digest-only proof binds secret possession to that browser's OAuth state and can be consumed once. A different browser, expired proof, mismatched state, or replay cannot designate an operator. Hub continues to discard GitHub user tokens. Keep the bootstrap secret with deployment secrets; never place it in a URL.

Enrollment permits ten attempts per minute from each trusted request source. Changing a forwarded address on a direct request does not create another allowance. Throttled requests do not start OAuth or create an enrollment proof.

## Designate or remove an administrator

An existing Hub administrator opens **Hub administrators** from the sidebar, or `/hub_admins`. The page lists only administrators, at most 50 at a time, with removal confirmation beside each account. It does not create users or accept arbitrary GitHub identities.

Choose **Add administrator** to open a dialog and search existing GitHub-backed Hub users by login or name. Current administrators and local identities are excluded. Search returns up to 50 matches; refine the search to find other users. Selected accounts stay checked in the same list across searches, including when they do not match the current query. Select up to 50 users across searches, review the selected accounts and consequence, check the confirmation box, then choose **Add selected administrators**. The selection commits together with one success audit per user. If any account is missing, already an administrator, or cannot be saved, no selected roles change.

The same browser Session must have verified the same GitHub identity within the last five minutes. If Hub opens **Verify with GitHub**, complete that check and Hub continues the role change you already confirmed. The saved selection is bound to that browser and used once, after permission and target checks. Removal uses its existing account confirmation page. See [Fresh GitHub authorization](fresh-authorization.md).

Removal takes effect immediately, including removal of your own role. Hub never removes the final administrator, even when requests overlap. It rereads the actor's role and initiating Session inside the same serialized transaction as the role change and success audit. A stale administrator, deleted Session, missing target, or already-changed role cannot change another user's role. A denial explains that no changes were made, including when the former administrator has no repository to return to.

The role permits Hub administrator controls and global security records, not GitHub repository content. Existing repository authorization remains unchanged. Local-development identities cannot receive this role through the interface. Bootstrap-secret enrollment remains the initial and host-authorized recovery path for configured deployments; no secret appears in the management page.

## Hand off Hub administration

Add a replacement before removing a departing administrator. Hub will not remove its final administrator.

1. Have the replacement sign in with their own GitHub account so Hub can find them. If they cannot sign in through ordinary repository access, use the host-authorized [enrollment process](#enroll-an-operator) instead. Successful enrollment already grants the role; skip step 2 and verify access in step 3.
2. If the replacement is not already an administrator, open `/hub_admins`, choose **Add administrator**, select the existing account, review the selection and confirm. Complete **Verify with GitHub** if asked; Hub then continues the confirmed addition.
3. Have the replacement sign in in their own browser and open `/security_audit` and `/hub_admins`. Confirm that they can manage Hub, not just read a repository.
4. The replacement removes the departing account's Hub-admin role. Do this before ending sessions, and confirm that at least one authorised administrator remains.
5. Follow the [offboarding procedure](deployment.md#offboard-a-person-or-contain-a-reported-suspension) for GitHub access, public links and existing browser/canvas credentials. Removing an administrator role alone does not perform those actions.

Transfer responsibility for the hosting account and deployment secrets through the organisation's approved process. Do not share personal GitHub credentials, browser cookies or canvas tokens. A GitHub App's owner is not automatically a Hub administrator.

## Recover when the last administrator has left

A trusted deployment owner can enroll a replacement without the departed administrator's Session. This uses the existing bootstrap-secret flow, not a database edit or an App reset.

1. Confirm the replacement and recovery through the organisation's approved process. Ask the deployment owner for authorised use of `REPLICA_BOOTSTRAP_SECRET`; keep it out of URLs, Git and issue comments.
2. The replacement opens `/operator/enrollment`, enters that secret, and completes GitHub sign-in in the same browser. Hub designates the identity GitHub verifies, even without repository access.
3. Confirm the replacement can open `/security_audit` and `/hub_admins`. They can now remove the departed administrator without violating final-admin protection.
4. Follow the [offboarding procedure](deployment.md#offboard-a-person-or-contain-a-reported-suspension). Disable public sharing before ending all sessions, which also signs the replacement out.
5. Sign in again as the replacement and check the audit records and containment state.

If the deployment owner, bootstrap secret or working GitHub sign-in is unavailable, stop and escalate to the hosting owner. Ordinary sign-in cannot promote itself to administrator. Broken App credentials use the existing [same-App recovery procedure](github-app-setup.md#emergency-same-app-credential-recovery); do not delete the App, reset the database or collect the departed person's credentials.

## End all sessions

Open **End all Hub sessions** from the deployment audit or administrator page. The confirmation explicitly includes the operator's own sign-out and requires fresh GitHub proof on that same browser Session. The result renders after sign-out without requiring a Session. Public shares and future legitimate sign-in remain available. See [End all Hub sessions](session-revocation.md) for the serialized cutoff, pending-proof cancellation, race enforcement, and live disconnect failures.

## Recorded actions

| Surface | Recorded decisions |
| --- | --- |
| Public shares | Creation and deletion from both browser and canvas APIs |
| Analytics destinations | Creation, settings or credential changes, pause, resume, and disconnect |
| GitHub App setup | Bootstrap authorization, credential exchange, manual connection of an approved installation, and installation confirmation |
| GitHub App administration | Status/confirmation access, local reset and separate live disconnect failures, credential replacement, webhook update/retry, ending overlap, and rejected/failed operations |
| Copilot connection | Page access, connecting or checking the token again, disconnection by an administrator or by removing the role of the person who connected it, Copilot refusing the token Hub tried to use, and rejected or failed attempts |
| Learnings | Run requests and accepted, rejected, or retired learnings, with rejected or failed attempts, in the repository's audit |
| GitHub App emergency recovery | Same-App host credential repair and rejected/failed command attempts |
| Canvas connections | Anonymous pairing creation, browser approval, credential issuance and renewal, interactive inactivity extension, and revocation through browser, access-token, or refresh-token routes |
| Operator enrollment | Verified designation and rejected enrollment attempts |
| Hub administrators | Existing-user listing and confirmation access, designation, removal, and rejected role changes |
| Public-sharing policy | Deployment settings access, enable, disable and rejected changes; permanent link revocation and confirmed creator repository-access loss |
| End all sessions | Confirmation-page access, atomic deployment cutoff, cancellation, rejection, and separate live disconnect delivery failures |
| Audit access | Successful reads and rejected access attempts |

Outcomes distinguish succeeded, denied, and failed operations. A missing actor is valid for initial setup, signed-out requests, and operator commands. Command records have no browser or source IP. Local database changes and their success records commit together. A failed audit write raises an error rather than silently dropping evidence. External GitHub calls stay outside database transactions; their audit follows the confirmed result, not an invented rollback of the remote operation.

Local HTTP 429 responses stay in ordinary request logs, not the 90-day audit trail. This applies to anonymous requests and authenticated operators alike. Admitted attempts still record their normal decisions. Missing required input is a failed operation. Enrollment distinguishes rejected identity, state, proof, or OAuth authorization from GitHub outages, rate limits, and invalid service responses.

Records store the actor's nullable Hub user ID and fixed desktop/mobile/unknown and browser-family categories. Session and connection IDs provide nonsecret correlation. Role decisions also retain `target_user_id`, the resolved Hub user whose role was requested; this is distinct from the actor and survives target deletion. Device categories survive Session deletion. Raw user-agent text, headers, payloads, provider settings, credentials, OAuth state, cookie values, and access, refresh, device, and bootstrap secrets are excluded. Success records retain bounded server-owned object IDs, not user-supplied device names or labels.

Audit records include the client's IP address. If a server forwards requests to Hub, that server must provide the correct client address and be configured as a trusted proxy.

Hub also uses this IP address to limit requests for operator enrollment and canvas connections. Starting a canvas connection permits ten requests per minute. Checking for approval permits sixty per minute. Renewing and disconnecting connections share a limit of sixty per minute. Supplying a different forwarding address on an untrusted connection does not give the client another request allowance.

Incorrect proxy settings can make Hub record the server's address instead of the client's, or an address supplied by the client. See [Client IP addresses and trusted proxies](deployment.md#client-ip-addresses-and-trusted-proxies) for setup and checks to run before relying on audit IP addresses.

## Retention and operations

Hub retains records for 90 days and deletes older records hourly through Solid Queue. **Security acceptance of the 90-day retention period is pending.** Backups have a separate lifecycle; see [Backups](backups-and-restore.md). Run cleanup immediately through the devcontainer:

```sh
bin/devcontainer exec bin/rails runner 'SecurityAuditEvent.clear_expired!'
```

Expired and consumed enrollment proofs are removed hourly. Resetting the local GitHub App does not remove Hub operators or audit history.

Routine App maintenance at `/github_app` requires the persisted administrator role, same-Session five-minute GitHub proof, and confirmation. Browser audits retain the administrator and Session identity. The sole host repair command has an anonymous `command` actor and no browser/IP attribution. Reset revokes local access but retains audit scope and history. See [App administration and recovery](github-app-setup.md#routine-app-administration).

## Contributor contract

Use the model-owned writer from trusted code:

```ruby
SecurityAuditEvent.record! \
  action: "share_link.delete",
  outcome: "succeeded",
  repository: repository,
  actor: Current.user,
  context: Current.security_audit_context || {}
```

`repository: nil` means a deployment record, not permission to expose it in repository views. Actions are bounded lowercase operation names. Outcomes are `succeeded`, `denied`, or `failed`. `occurred_at:` defaults to Hub's current time.

Request controllers provide the trusted IP, fixed source (`browser` or `canvas`), and nonsecret device categories through `Current.security_audit_context`. A successful manual GitHub App import uses `bootstrap` as its source while retaining that request context. The writer defaults to `command` outside requests and adds authenticated Session or canvas-grant IDs. Optional context identifiers are `session_id`, `canvas_grant_id`, `canvas_pairing_id`, `share_link_id`, `analytics_destination_id`, `github_app_configuration_id`, and `target_user_id`; values must be positive integers. Unknown keys or arbitrary strings are rejected, not silently filtered. Never pass request parameters, exceptions, or external responses to the writer. Add local success records inside the operation's transaction; record denials after authorization fails without changing the product state.
