# Security

In the GitHub-backed flow, Hub trusts GitHub for identity and repository access. It keeps credentials and review data away from prototype code.

```text
Only Replica Hub stores:
  +-- GitHub App credentials
  +-- Hub Sessions
  +-- review data

Other boundaries:
  +-- GitHub Actions: prototype source, but no Hub secrets
  +-- Build previews: stored files and a separate cookie, but no Hub Session
  +-- public shares: one retained Build, but no GitHub or review access
  +-- live updates: a change notice, but no review content
```

## Repository access

- Hub stores each person's GitHub ID, but not their OAuth token.
- Learnings makes Copilot requests with `REPLICA_COPILOT_TOKEN`, a token the person who runs Hub provides with only the Copilot requests permission. With organization billing, Hub's GitHub App instead creates a one-hour token for each request that holds only that permission. Hub passes either token only to `replica-learning` and never stores it. See [Copilot](copilot.md).
- Every repository page checks the person's current GitHub access.
- Signed-out pages reveal no setup, installation, or repository details.
- If GitHub cannot confirm access, Hub denies that repository request.
- With a private organization App, every organization member can read a public repository's Hub reviews. See [App ownership and repository visibility](authentication-and-repository-authorization.md#app-ownership-and-repository-visibility) before connecting repositories or changing visibility.
- Changing review data requires a Hub Session, repository access, and an anti-forgery token.
- Analytics-destination changes additionally require [fresh GitHub authorization](fresh-authorization.md) on the initiating Session or canvas grant. Verification in another scope cannot unlock them.
- A repository writer may ask Hub to create the reserved workflow installation branch and open a pull request. Hub never writes to the default branch or replaces an existing workflow.

## Account suspension proposal

Hub does not currently enforce ongoing account suspension. It discards the temporary GitHub user token after OAuth admission and restores browser Sessions without user-token revalidation. An installation-token repository-role check, even a fresh one, does not establish whether the target user can authenticate. See [Authentication and repository access](authentication-and-repository-authorization.md#account-suspension-and-offboarding) for the current checks, failure behavior, and public GitHub documentation.

The proposed compensating control combines that credential-minimizing design with [deployment-wide public-sharing containment (#164)](https://github.com/github/replica/issues/164). Public sharing defaults to off. An administrator disabling it blocks existing links and public-preview access and permanently revokes existing links; re-enabling allows new links only. This implementation does not detect suspension or automatically revoke browser Sessions and canvas connections.

Security acceptance of this proposal for [#166](https://github.com/github/replica/issues/166) remains pending. Local code inspection and stubbed OAuth tests establish Hub's admission behavior, not GitHub's response to a real suspended account. No production suspended-account experiment has been performed. Deployed containment verification remains separate; this guide is neither a claim of complete suspension enforcement nor release approval.

## Building prototype code

GitHub-hosted runners execute prototype code. The shared build action runs it as a non-root user in a pinned Node container. That container receives no Hub, GitHub App, or storage credentials and cannot control the runner's Docker service.

Hub downloads the resulting GitHub Actions artifact with a short-lived installation token. Before storing it, Hub checks the ZIP, file paths, required files, and size limits.

[Development-only local mode](local-development.md) gives one local identity access to the configured repositories. It runs builds on the developer's machine rather than in the production GitHub Actions sandbox. Use only repositories whose code and build scripts you trust; local mode is not a way to test production access controls or build isolation.

## Running prototype code in the browser

Each Build uses a separate preview address. Hub gives that address a separate preview cookie instead of sharing the Hub Session cookie.

Browsers treat Hub, its previews, and other HTTPS applications under the same registered domain as one site. Use a domain dedicated to Hub and its previews. See [Choose an isolated domain](deployment.md#choose-an-isolated-domain) for why a separate subdomain is not enough.

The review shell places the preview in a restricted frame. Prototype code can run inside that frame, but it cannot navigate the Hub page. Only Hub may embed the preview.

Hub adds a small script called the preview bridge to connect its review controls to elements and highlighted regions inside the prototype. Prototype code shares the preview frame with this script, so Hub treats every bridge message as untrusted. The Hub page and bridge reject messages from unexpected addresses or windows and reject unexpected data.

Hub sends the bridge only the comment ID and saved target needed to place a marker. Comment text, people, reactions, read state, and credentials stay in Hub.

Only the Hub page receives live review notices. A notice says only that comments changed, then the browser reloads them through the normal access check.

## Hub browser policy

Hub enforces a Content Security Policy on its own pages. For example, the sign-in page permits Hub's bundled JavaScript and its nonced Superglue bootstrap, but not an injected inline script or an external script. [`HubContentSecurityPolicy`](../lib/hub_content_security_policy.rb) defines the policy; the [initializer](../config/initializers/content_security_policy.rb) generates a random 256-bit script nonce for each response. The layout and bootstrap use that same nonce. Nonces do not identify a person or persist across requests.

Scripts, fonts and ordinary connections stay on Hub. Action Cable also permits the configured Hub websocket origin. Objects, workers, base URL changes, inline script attributes and framing of Hub pages are denied. Forms may submit to Hub or the configured `REPLICA_GITHUB_URL`, preserving GitHub App manifest registration. OAuth continues through ordinary redirects. Frames may load Hub's authorization handoff, the configured signed-in and public preview namespaces, and YouTube's privacy-enhanced host for the Welcome video; CSP wildcards cover whole host labels, not only the `b` or `s` prefix. Preview routing and access checks still choose the exact Build.

Inline styles remain permitted because Primer, React and the controls panel style and position elements dynamically. Images may use HTTPS or data URLs so GitHub and GitHub Enterprise avatars keep working. Neither allowance permits inline script execution. Development additionally permits the configured Vite server and its port on the Hub host, including HMR connections; production and test policies exclude those development sources. Scripts never require `unsafe-inline` or `unsafe-eval`.

Prototype responses retain their separate [preview policy](preview-serving.md#browser-boundary-evidence). Applying Hub's script policy to arbitrary Builds would break legitimate prototype assets and inline startup code. Hub does not rewrite retained Build files.

### Evidence and deployment checks

[Policy tests](../test/lib/hub_content_security_policy_test.rb) compare the complete production policy and development transport differences. [Home tests](../test/integration/home_test.rb) check the enforced response header, bootstrap nonce and nonce rotation; [setup tests](../test/integration/github_app_setup_test.rb) retain the GitHub manifest destination. These checks establish Rails response behavior, not deployed browser enforcement.

Before accepting a deployment, record its exact Replica commit or image digest, the Hub/GitHub/preview origin settings, and the complete effective headers after any proxy or hosting rules. Multiple enforced CSP headers intersect; a hosting-injected Hub script policy on preview hosts can break prototypes even when Rails emits the correct preview header. Check real signed-in review and signed-out public share pages in separate authorized browsers, including startup, controls, review targeting, OAuth/setup and Action Cable. Confirm that prototype scripts cannot read Hub DOM or identity, spoof bridge replies from another frame, or embed previews from an unapproved parent. Local tests and jsdom messages do not establish those deployed boundaries or Security acceptance.

## Public share links

A current Hub administrator can [end all existing Hub sessions](session-revocation.md) with deliberate confirmation and fresh identity proof on the same browser Session. This revokes browser and canvas credentials and pending authentication handoffs, including the operator's own Session. Late OAuth callbacks cannot revive them. Public shares remain a separate policy, and new sign-in is still allowed.

A public share link uses a random UUID and opens one successful Build. Public sharing is off by default on new and upgraded deployments. A Hub administrator must explicitly enable it with confirmation and fresh GitHub proof. Disabling permanently revokes all links and pending public handoffs; enabling permits new links only. Hub administrators do not gain repository-content access. See [Share links](share-links.md) for the policy, in-flight response boundary and creator-access-loss observation limits.

Hub checks public requests against its current database policy and live link without calling GitHub. A link also stops working while the repository is removed from the GitHub App. A confirmed, identity-bound loss of its creator's repository access permanently revokes that creator's repository links at the next observed uncached check; outages and insufficient evidence do not. This is not automatic GitHub.com suspension detection, and security acceptance remains pending.

Public links have a [seven-day maximum by default](share-links.md#link-lifetime). Operators can choose a one-day or thirty-day maximum. Startup permanently shortens stored deadlines from original creation time before serving requests; increasing the maximum cannot revive old URLs. Removing the setting restores the seven-day maximum. This time bound is not automatic offboarding or Security acceptance; use the [offboarding procedure](deployment.md#offboard-a-person-or-contain-a-reported-suspension) when immediate containment is required.

The share page and Build files use separate origins. Prototype JavaScript cannot read the Hub Session cookie. Public preview cookies contain no Hub user or Session identity, and each file request checks the current share link.

Public previews expose retained `dist` files and the authorized [controls-only bridge](preview-serving.md#prototype-controls). They do not expose screenshots, repository pages, review conversations, live updates, or the review bridge. Controls identities are opaque and separated from authenticated viewer identities; saved overrides remain in the visitor's browser and are never shared review state.

## Azure Front Door

Set `REPLICA_AZURE_FRONT_DOOR_ID` when Azure Front Door sends requests to Hub. Hub then rejects origin requests without that Front Door profile's `X-Azure-FDID` header.

The origin network must also allow only the `AzureFrontDoor.Backend` service tag so clients cannot bypass Front Door and connect to Hub directly. The service tag covers every Azure Front Door profile, so Hub checks the profile ID to accept only requests from its own Front Door.

## Secrets and GitHub notifications

Hub keeps a separate, non-exported [security audit](security-audit.md) for sharing, analytics settings, setup, App administration, the Copilot connection, canvas connections, and operator enrollment. Repository audit pages require current GitHub admin permission. Global records require an explicitly enrolled or designated Hub administrator; that role grants no repository-content access. Administrator role changes require current server-side administration permission, fresh GitHub proof on the same browser Session, and deliberate confirmation. The final administrator cannot be removed, including by overlapping requests. Records retain nonsecret actor, IP, and device context for 90 days. Security acceptance of that retention period is pending.

Hub encrypts stored App credentials and filters secrets from logs and browser responses. It verifies each GitHub notification before reading it and ignores duplicate deliveries.

[Shared request limits](security-rate-limits.md) bound sign-in, review mutations, analytics settings, workflow installation, administrator changes, learning recalls for agents, and verified webhook processing. Production uses the shared Rails cache. HTTP 429 explains when to retry. Durable metadata-only App redelivery recovers supported failed webhooks within GitHub's three-day window; longer gaps and exhausted recovery remain explicit.

Routine App maintenance requires current Hub-admin permission, same-browser five-minute GitHub authorization, and confirmation at `/github_app`. The sole emergency host command repairs credentials for the same existing App without working OAuth; it does not reset data or provision roles. Candidate-key validation is not OAuth client-secret validation. Normal browser reset separately signs everyone out and revokes connections while retaining collaboration data and the remote App. See [App maintenance and recovery](github-app-setup.md#routine-app-administration).

GitHub webhooks use a session-free API endpoint. They do not use browser CSRF tokens; Hub checks the webhook signature before processing a delivery. Preview hosts serve only GET requests and allow browser scripts from their retained Builds without Rails's JavaScript-response forgery check.

Repository analytics exports only scoped IDs and pseudonymous HMAC actor IDs, not content or profile fields. Actor-less events use event-specific system identities at providers rather than invented person identities. Provider credentials are encrypted and filtered from logs. Segment and Mixpanel use fixed HTTPS endpoints. Repository admins can also configure custom public HTTPS endpoints, with bounded templates and secret references, public-IP DNS pinning, no redirects or proxies, and an optional deployment-level exact-domain allowlist. These destinations stop sending when their repository is removed; an operator should also enforce network egress policy. Provider retention is separate from Hub retention; see [Repository activity events](analytics.md).

See [GitHub App setup](github-app-setup.md), [GitHub Actions builds](github-actions-builds.md), and [Preview serving](preview-serving.md).
