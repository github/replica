# Copilot

A Hub administrator connects Copilot once for the whole Hub, which turns on [Learnings](learnings.md): Hub asks Copilot to suggest learnings from prototype review comments. Hub makes these Copilot requests itself, so they work while everyone is signed out and nobody has to copy prompts into a Copilot session. Hub never stores a Copilot token.

The person who runs Hub chooses who Copilot bills with `REPLICA_COPILOT_BILLING`:

| `REPLICA_COPILOT_BILLING` | Hub asks Copilot with | Copilot bills |
| --- | --- | --- |
| `token_owner`, the default | The token in `REPLICA_COPILOT_TOKEN` | The Copilot plan of the token's owner |
| `organization` | A new one-hour token from Hub's GitHub App for each request | The organization that installed Hub's GitHub App |

```text
The person who runs Hub gives Hub a token, or turns on organization billing
  -> restarts Hub
A Hub administrator chooses Connect Copilot
  -> Hub checks that Copilot answers
  -> Hub records who connected Copilot
```

## Give Hub a token

1. The person whose Copilot plan will pay for the usage creates a fine-grained personal access token on GitHub, under **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens**. Give it the **Copilot requests** account permission and nothing else, with no repository access. Choose when it expires; an organization can enforce a maximum lifetime.
2. Store it as `REPLICA_COPILOT_TOKEN` where you keep Hub's other secrets, then restart Hub.

| Hub runs on | Where `REPLICA_COPILOT_TOKEN` goes |
| --- | --- |
| The default deployment | The private `.env` file that holds Hub's encryption secrets |
| A platform that turns secrets into environment variables | Its secret store, such as an Azure Key Vault reference, an AWS Secrets Manager secret in an ECS task definition, or a Kubernetes secret |

Hub reads one environment variable, so it needs no code for any secret store. Hub checks that Copilot accepts the token; it does not inspect its permissions. The operator must verify that the configured token has only the intended permission. The secret remains in the deployment's secret store or private environment file and in Hub's running processes, not in its database.

## Bill your organization

With organization billing, Hub's GitHub App makes Copilot requests with its own installation token, and Copilot bills the organization that installed the App instead of a person. GitHub offers this as a [public preview](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/server-to-server-tokens). The organization needs Copilot Business or Copilot Enterprise, and Hub's App must belong to that organization and be installed on it. Hub creates its App as a private App, which only its owner can install, so a Hub whose App belongs to a personal account must [reset the App](github-app-setup.md#local-reset) and create it again under the organization, or keep using a token.

1. The App's owner opens the App's settings on GitHub, under **Permissions & events**, and sets the **Copilot requests** organization permission to **Read-only**. Read-only still lets the App spend the organization's AI credits.
2. An organization owner reviews and approves the updated permissions. GitHub's guide to [managing GitHub Apps that use your organization's Copilot](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/manage-app-copilot-access) explains how to find the App's usage and how to block it. The App's usage counts against the organization's Copilot budget; GitHub has no budget for one App, and only a budget with **Stop usage when budget limit is reached** stops spending.
3. The person who runs Hub sets `REPLICA_COPILOT_BILLING=organization` where they keep Hub's other settings, then restarts Hub. Hub then ignores `REPLICA_COPILOT_TOKEN`.
4. A Hub administrator connects Copilot on the **Copilot** page, whose confirmation names the organization. Hub never moves an existing connection to an organization's bill. After the person who runs Hub turns on organization billing, or when Hub's App gets a new installation, Hub stops making Copilot requests until an administrator connects Copilot again.

GitHub also requires the organization to be enabled for Copilot requests from GitHub App installations. Until it is, Copilot refuses Hub's App, and the **Copilot** page says so.

For each Copilot request, Hub's App creates a new installation token that holds only the Copilot requests permission and expires after an hour. Hub binds the request to the exact saved App configuration, credential revision, installation ID, and organization identity that the administrator confirmed. It checks that snapshot immediately before and after GitHub creates the token. If the App is reset, its credentials or installation change, or the installation is suspended or removed meanwhile, Hub discards the token and does not send it to Copilot.

GitHub's installation-token documentation says the response reports the token's permissions, but it does not document an implicit permission that must accompany `organization_copilot_requests`. Hub therefore remains fail-closed: it accepts exactly that one permission, refuses a token that GitHub reports with any other permission, passes it only to `replica-learning` for that one command, and never stores it. A real request from an organization with the public preview enabled still needs to confirm the returned payload. The token cannot read or change repositories. Anyone who can read Hub's database and its encryption keys holds the App's private key, so they can also create these tokens and spend the organization's Copilot budget until an organization owner removes the permission or suspends the App.

## Connect Copilot

1. Open **Copilot** in the sidebar's lower group, or go to `/copilot`. When Hub has no token, or its App is not installed on an organization for organization billing, the page says what to set up.
2. Read what Hub will do with Copilot and who Copilot will bill, check the confirmation, and choose **Connect Copilot**. The form carries a signed fingerprint of the billing mode and credential shown on that page; if either changes before submission, Hub asks the administrator to review and confirm the current information instead of minting a token. Like Hub's other administrator settings, this needs a [fresh GitHub authorization](fresh-authorization.md) on the same browser Session within the last five minutes. If GitHub asks you to verify, return and confirm again; verification never submits the change.
3. Hub checks the token, or a new App token, with a Copilot request that lists the models it may use. If Copilot answers, Hub connects Copilot and records who connected it.

If another administrator disconnects or replaces the connection while Hub checks the token, Hub cancels the earlier check and leaves that change intact.

With a token, Copilot counts the usage toward the plan of the token's owner and applies their organization's Copilot policies, including which models they may use. With organization billing, Copilot bills the organization that installed Hub's App and applies that organization's policies.

## What Hub keeps

| Item | Where | Who can see it |
| --- | --- | --- |
| The operator's token | Only in Hub's environment, never in its database | Nobody. Hub never shows, exports, or logs it |
| A token from Hub's App | Only in memory, for the one command that uses it | Nobody. Hub never shows, exports, or logs it |
| Who connected Copilot, when, and when Copilot last answered or refused | Hub's database | Hub administrators |
| The SHA-256 digest of the operator's token, or of the App configuration, credential revision, installation, and organization identity | Hub's database | Nobody. It tells Hub whether a confirmation or refusal belongs to the exact billing credential it uses now |
| Copilot usage that Learnings runs reported over the last 30 days | Hub's database | Hub administrators, on the **Copilot** page |
| Connections, disconnections, and refusals | [Security audit](security-audit.md) | Hub administrators |

Hub passes a token only to `replica-learning`, as `COPILOT_GITHUB_TOKEN`, when it makes a Copilot request. That command runs without Hub's other secrets, keeps Copilot's state in a new private directory, and gives Copilot no tools.

A token with only the Copilot requests permission cannot read or change repositories. Someone who copies the operator's token can make Copilot requests that count toward its owner's plan, until it expires or its owner deletes it on GitHub. Someone who copies a token from Hub's App can make Copilot requests billed to the organization until it expires, within an hour.

## When the connection ends

- **An administrator disconnects it.** **Disconnect Copilot** needs confirmation and fresh GitHub verification on the same browser Session. Hub stops making Copilot requests. The operator's token stays where it is kept, and Hub's App keeps its Copilot requests permission. To end them, the token's owner deletes the token on GitHub, or the App's owner removes the permission.
- **The person who connected it stops being a Hub administrator.** Hub disconnects Copilot in the same change as the role. Another administrator can connect it again.
- **Copilot refuses the token or Hub's App.** For example, the token expired, its owner deleted it, or its owner lost Copilot. With organization billing, GitHub may return the specific installation-token validation response observed when the installation has not granted the requested permission, or Copilot may refuse the App because the organization does not allow its requests. Hub records those refusals in the security audit, stops looking for learnings, and offers **Check the token again**, or **Check Copilot again** with organization billing. Other GitHub validation or abuse responses, including other HTTP 422 responses, are temporary GitHub failures and do not record a durable Copilot refusal. People can still decide on suggestions, and agents still get accepted learnings. A refusal belongs to the token or exact App configuration and organization installation Copilot refused. Replacing the token using the procedure below, or fixing the App's permission or the organization's settings and checking again, lets Hub use Copilot again.
- **The token is removed, or the App's organization installation ends.** Hub stops making Copilot requests, and the page says what Hub needs.

[Ending all Hub sessions](session-revocation.md) leaves the Copilot connection as it is, because no Copilot token is a browser credential. With a token, resetting the GitHub App also leaves it as it is, because the token is not the App's. With organization billing, resetting the App stops Copilot requests until the new App is installed on the organization and an administrator connects Copilot again.

## Replace the token

Token changes require a full stop/start, not a rolling restart. Before starting any process with a replacement token, stop **all** Hub web and job-worker processes using the old token and wait for them, their learning commands and their Copilot SDK/runtime children to exit. A lost Ruby worker does not prove its child command stopped; confirm no old-token learning writer or SDK child remains. Pause any automatic restart or scaling that could bring an old configuration back. This also applies when adding or removing the token, or changing `REPLICA_COPILOT_BILLING`, on a running deployment. Tokens from Hub's App need no replacement, because Hub creates a new one for each request.

The default Compose bundle runs Hub and its job workers in one container with local persistent storage. Run `./replica down` and confirm that container and its children have stopped before changing the token, then run `./replica up` after updating the configuration. The named data volume is retained. On another platform, use its equivalent full-stop procedure; if old and new token processes cannot be kept from overlapping, do not rotate this way.

After every old-token process has exited, put the replacement token in `REPLICA_COPILOT_TOKEN` and start Hub and its workers with that same configuration. Delete the old token on GitHub. Hub uses the replacement from its next Copilot request.

Hub loads the token at process startup. Overlapping processes with different tokens are not supported. Hub has no shared token-rotation ordering: an old-token worker that reads a newer token's digest can overwrite the newer token's refusal with its own late result. A token digest alone cannot tell those configurations' order. The full stop/start prevents that overlap; do not resume old-token processes afterward.

Within one token configuration, a successful request already in flight cannot clear that token's refusal; an administrator must explicitly check it again.

## Upgrade an earlier pre-release checkout

Earlier revisions of this pull request stored encrypted GitHub App user access and refresh tokens. Before upgrading one of those installations, take a protected backup using the [backup guide](backups-and-restore.md), stop its web and job-worker processes, and arrange for the person who originally connected Copilot to revoke Hub's authorization under GitHub **Settings**, **Applications**, **Authorized GitHub Apps**. That revokes the earlier authorization and its refresh tokens; it may require that person to authorize Hub again at their next sign-in.

The forward migration removes only the legacy Copilot connection and its credential columns. It preserves users, the GitHub App configuration, Builds, review data and security audit history. It does not contact GitHub, revoke remote credentials or claim that the new operator token was checked. After supplying the operator token and restarting Hub, an administrator must connect Copilot again with fresh GitHub proof.

This cleanup applies only to databases that ran the earlier pre-release credential schema. Fresh installations and existing digest-only connections are unchanged. Removing columns does not erase secrets from old backups or guarantee erasure from SQLite's storage files. Keep backups protected and retire them under your retention policy; do not restore an earlier credential-bearing database as a substitute for reconnecting. The cleanup cannot be rolled back to recover those credentials or their verification.

## Local development

[Local development](local-development.md) has no Copilot page and ignores `REPLICA_COPILOT_TOKEN` and `REPLICA_COPILOT_BILLING`. Learnings there asks Copilot as whoever is signed in to the GitHub CLI or Copilot CLI where Hub runs; see [Learnings](learnings.md#local-development).

## Operations

The production image includes Node.js and `replica-learning` under `/opt/replica/learning`, owned by root so Hub cannot change the code it runs. In development, Hub runs `replica-learning` from `packages/learning/`, and `bin/setup` installs its runtime dependencies there. If they are missing, **Connect Copilot** says so and asks you to run `bin/setup`. Each Copilot request starts a Copilot runtime for that one command. Hub gives every command a new private temporary directory as its `TMPDIR`, where the runtime keeps its state, and deletes it afterward, even when Hub had to stop the command. Set `REPLICA_LEARNING_CLI` to run another copy of the command. Relative entry-point paths resolve from Hub's current working directory when the command is initialized, before it changes its working directory.

Hub reads at most 16 MB of a command's answer and 1 MB of its error output. It stops a command that writes more, along with any Copilot runtime the command started, and reports that the command wrote too much.
