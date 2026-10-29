# Authentication and repository access

In a GitHub-backed Hub, GitHub proves identity and decides repository access.

```text
Sign in:
browser -> GitHub OAuth -> Hub creates a Session

Open a repository:
Session -> Hub asks GitHub for current permission -> show repository or deny access
```

Hub admits repository users when they can read at least one installed repository. A `none` permission on another installed repository does not prevent sign-in. Explicitly enrolled Hub operators can also sign in to administer the deployment without repository access. Hub stores their GitHub ID and current profile, but not their OAuth token. The browser cookie points to a `Session` record that Hub deletes when the person signs out.

Signed-in visits to `/` and successful sign-ins go to `/repositories`, regardless of Hub administrator status. Sign-in preserves a saved preview authorization or canvas pairing destination. The repository entry point opens the first readable repository or returns not found when none is available. Hub administrators can still open `/security_audit` directly.

Before showing a repository, Hub confirms that its App is still installed there and asks GitHub whether the signed-in person can access it. Hub also confirms that GitHub's answer belongs to that person.

Hub remembers the answer for one minute. If GitHub cannot answer, Hub denies that repository request instead of using an older permission. A removed repository stays in the database so its Builds and conversations remain intact.

For an existing Hub user, a successful uncached response with the creator's exact immutable GitHub ID and explicit `none` permission permanently revokes that creator's public links for that repository, including during sign-in. Outages, bare 404s and unverified identities do not. This happens only when Hub observes a permission lookup, not continuously or on anonymous share visits; see [Share links](share-links.md#creator-access-loss).

Every analytics-destination mutation also requires GitHub identity verification within the last five minutes on the same browser Session or canvas grant. This additional check never replaces repository permission. GitHub may reuse its browser session; it does not guarantee a password or MFA prompt. See [Fresh GitHub authorization](fresh-authorization.md) for the one-use challenge and explicit retry contract.

## App ownership and repository visibility

GitHub controls who can sign in through Hub's App. Hub checks each person's repository permissions to decide which reviews they can read.

### Private Apps

Setup creates a private App. For a team Hub, create it under your GitHub organization. Only organization members can sign in through that App. An App under your personal account allows only you to sign in.

These rules apply to new sign-ins. Making a public App private does not sign out existing users or end their canvas connections. They can keep reading repositories they have access to. After restricting App visibility, [end all Hub sessions](session-revocation.md) if you also need to remove existing access.

| App owner and installed repository | Who can read that repository's reviews in Hub |
| --- | --- |
| Organization-owned private App, private repository | Organization members who can read the repository |
| Organization-owned private App, public repository | Every member of the organization |
| Personal-account private App, either repository visibility | Only the App owner's account |

### Public repositories

Anyone on GitHub can read a public repository. Hub uses that permission for review access too. With a private organization App, every organization member can read the repository's Hub reviews, not just its contributors. Check that this is the intended audience before connecting a public repository.

### Public Apps

Making the App public lets people outside the organization authorize it and sign in to Hub. It does not change repository visibility or grant access to private repositories.

After sign-in, GitHub read access to a connected repository also grants access to its prototype comments and conversations in Hub. Hub has no separate reviewer list or additional organization-membership requirement. With a public App:

| Connected repository | Who can read its review conversations after signing in to Hub |
| --- | --- |
| Private | Only people with GitHub read access to that repository, including outside collaborators |
| Public | Any GitHub user, including people who are not organization members or repository contributors |

Before connecting an App or changing App or repository visibility, decide whether everyone who can read the repository should also be able to read its Hub review conversations. **Do not connect a public repository through a public App if those conversations must stay within the team.**

**Keep manifest-created Apps private.** A manually connected cross-account App may need public visibility for installation and team sign-in. See [manual connection](github-app-setup.md#manual-creation-and-connection).

## Hub operators

The persisted Hub-admin role defaults to false. Enrollment requires the deployment bootstrap secret and a fresh GitHub sign-in bound to the same one-use, 15-minute browser flow. Existing configured deployments enroll through `/operator/enrollment` without resetting their App. The App's owner, including an organization owner ID, is not an operator identity.

Hub administrators can read global security records and designate or remove explicit administrator roles for existing Hub users, even without repository access. Role changes require current administrator authorization, deliberate confirmation, and fresh GitHub proof on the same browser Session. Hub prevents removal of the final administrator under overlapping requests. This role never bypasses GitHub checks for repository pages or repository audit records. See [Security audit](security-audit.md) for enrollment, role management, and access.

Administrators can also [end all existing Hub sessions](session-revocation.md), including their own, with deliberate confirmation and fresh proof on the same browser Session. The serialized cutoff cancels browser Sessions, canvas access and refresh grants, pending approvals and handoffs, and pre-cutoff OAuth callbacks. New legitimate sign-in and re-pairing remain available; public shares do not change.

Administrators also use [GitHub App administration](github-app-setup.md#routine-app-administration) with the same browser proof and confirmation. Credential repair retains live Sessions/connections but ends old OAuth flows and fresh proof. Normal App reset signs everyone out, revokes canvas connections, and makes repositories unavailable without deleting their Builds/reviews or administrator roles. Retained public links may resume under their existing policy after reinstall; reset is not permanent share revocation.

## Account suspension and offboarding

### Current behavior

For example, if GitHub rejects the user-token request during a new sign-in, Hub shows a generic authentication failure and creates no new Hub Session. That does not invalidate a Session issued before the rejection.

During OAuth admission, Hub exchanges the callback code for a temporary user token and calls [`GET /user`](https://docs.github.com/en/rest/users/users#get-the-authenticated-user). After checking repository access and saving the identity, Hub discards that token. Restoring an existing browser Session reads Hub's database; it does not authenticate the user with GitHub again.

Repository checks use an App installation token with [`GET /repos/{owner}/{repo}/collaborators/{username}/permission`](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user). Hub verifies the returned GitHub user ID and normalizes the reported role. This endpoint reports repository permission, not whether the target user can authenticate. A fresh role check bypasses Hub's one-minute cache; it is not fresh user authentication.

[Requests with a GitHub App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user) operate on behalf of that user and are a distinct validation path. When GitHub rejects a suspended caller's `GET /user` request during sign-in, the admission failure above applies. Hub's current token-discarding design does not use that path for ongoing browser or canvas access. It has no suspension-status source or promised suspension-enforcement delay. Repository denials and verification failures block the affected request, but do not prove suspension or automatically revoke every existing credential. Hub treats a repository-permission `404` as no access to that repository, not as evidence of account suspension.

Ordinary GitHub.com user REST responses do not document a suspension-status field. [Enterprise Managed Users can be deprovisioned through SCIM](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/provisioning-user-accounts-with-scim/deprovisioning-and-reinstating-users), but [enterprise SCIM status requires separate enterprise credentials](https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/scim#authentication). Hub has no SCIM integration. Persistent user-token storage or refresh has not been approved.

### Compensating control under Security review

[Public-sharing containment (#164)](https://github.com/github/replica/issues/164) is implemented alongside this token-discarding design for Security's review of [account suspension (#166)](https://github.com/github/replica/issues/166). Public sharing defaults to off. A Hub administrator can disable it deployment-wide, blocking existing public links and public-preview access and permanently revoking existing links. Re-enabling permits new links only. Confirmed creator repository-access loss also permanently revokes affected links; that is not a suspension-status check.

This proposal limits public exposure when an administrator acts. Sharing disable does not detect suspension, enforce automatic offboarding, or revoke browser and canvas credentials; ending those credentials is a separate explicit administrator action. Security acceptance remains pending; #166 is not resolved by this implementation. See [Deployment](deployment.md#contain-public-sharing) for the operator boundary and [Security](security.md#account-suspension-proposal) for the evidence limits.

The [maximum share-link lifetime](share-links.md#link-lifetime) bounds public access from original creation time and defaults to seven days. It does not detect account suspension or organization departure. Operators should use the [offboarding procedure](deployment.md#offboard-a-person-or-contain-a-reported-suspension) for immediate containment with current controls.

## Repository discovery

Hub keeps its repository list matched to the repositories where its GitHub App is installed. Production usually learns about changes from GitHub notifications. Production and GitHub-backed development also poll GitHub to recover missed changes; the latter relies on polling because it has no public tunnel. Run a poll immediately with:

```sh
bin/devcontainer exec bin/rails replica:github:poll
```

[Development-only local mode](local-development.md) instead uses a local identity that can access the configured local repositories. It does not verify GitHub permissions and cannot be enabled in production.

## Copilot canvas connections

Authors approve a Copilot canvas connection in their signed-in browser after comparing its repository and short code with the canvas. Approval is scoped to one installed repository, not a branch or prototype. It works before any prototype is committed, pushed, discovered, or registered. Repository configuration can select the Hub automatically but cannot bypass approval. Approval also records consent to [add the repository's accepted learnings](prototype-canvas.md#learnings-for-agents) to the person's prompts, as the approval page says. See [Prototype canvas](prototype-canvas.md#repository-hub-discovery) for the team configuration and precedence rules.

The durable connection is a `CanvasGrant`. Its ID, user, and repository remain stable while access tokens rotate. A renewable pairing generates an independent refresh secret before approval and stores only its digest. Consuming the approved proof creates the grant with that digest; the refresh secret cannot authorize anything before consumption. Only Node stores plaintext access, refresh, and pending device credentials, in private machine-local files. They never enter renderer state, prototype frames, Git, URLs, or logs.

Access tokens last at most seven days, bounded by the connection's inactivity deadline. Approval starts a 30-day window measured by Hub's clock. Explicit canvas focus and user-initiated Hub actions extend that window only after authentication and current repository authorization. At the exact deadline, access, activity, and renewal all fail; an expired connection cannot revive itself. Automatic renderer loads, rehydration, polling, renewal, and Action Cable traffic do not extend the window.

The refresh endpoint uses fresh GitHub authorization, never a cached permission. A confirmed denial returns forbidden; inability to verify returns service unavailable. Neither issues credentials nor records activity. After authorization outside the transaction, renewal locks and rechecks the grant's revocation and inactivity before rotating the access digest. Revocation takes the same lock and disconnects live subscriptions. Stable refresh secrets allow bounded retry after a lost response without creating another connection. Live canvas subscriptions also recheck validity and fresh repository access every minute, closing on denial or verification failure.

The canvas API authenticates independently of browser cookies and checks repository permission before each request. Metadata edits require write access, and first-time registration also checks author eligibility. Read permission may be cached for one minute; mutations and activity require a fresh check. A short-lived signed WebSocket ticket permits the Node extension to subscribe to existing review invalidations without exposing an access token in the URL.

Deployment revocation also ends legacy and access-expired renewable connections. Live browser and canvas connections reread persisted credentials before subscriptions and notice delivery, and every minute. Saved revoked credentials require an explicit new approval; another browser sign-in cannot revive them.

Hourly cleanup removes revoked connections and those past their inactivity deadline. Access-token expiry alone does not delete a renewable connection. Legacy grants have no refresh digest or inactivity fields: they remain usable until their original expiry and are cleaned up afterward. A client must complete a new explicit approval to upgrade them. **Canvas connections** lists renewable grants until their inactivity deadline, even while their access token is expired.
