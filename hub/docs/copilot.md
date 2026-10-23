# Copilot

A Hub administrator connects Copilot once for the whole Hub, which turns on [Learnings](learnings.md): Hub asks Copilot to suggest learnings from prototype review comments. Hub makes its Copilot requests with a token that the person who runs Hub provides, so they work while everyone is signed out and nobody has to copy prompts into a Copilot session. Hub never stores the token.

```text
The person who runs Hub creates a token with only the Copilot requests permission
  -> puts it in REPLICA_COPILOT_TOKEN and restarts Hub
A Hub administrator chooses Connect Copilot
  -> Hub checks that Copilot answers with the token
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

## Connect Copilot

1. Open **Copilot** in the sidebar's lower group, or go to `/copilot`. Without a token, the page says how to give Hub one.
2. Read what Hub will do with Copilot, check the confirmation, and choose **Connect Copilot**. Like Hub's other administrator settings, this needs a [fresh GitHub authorization](fresh-authorization.md) on the same browser Session within the last five minutes. If GitHub asks you to verify, Hub continues the confirmed connection change after verification succeeds.
3. Hub checks the token with a Copilot request that lists the models it may use. If Copilot answers, Hub connects Copilot and records who connected it.

If another administrator disconnects or replaces the connection while Hub checks the token, Hub cancels the earlier check and leaves that change intact.

Copilot counts the usage toward the plan of the token's owner and applies their organization's Copilot policies, including which models they may use.

## What Hub keeps

| Item | Where | Who can see it |
| --- | --- | --- |
| The token | Only in Hub's environment, never in its database | Nobody. Hub never shows, exports, or logs it |
| Who connected Copilot, when, and when Copilot last answered or refused | Hub's database | Hub administrators |
| The token's SHA-256 digest | Hub's database | Nobody. It tells Hub whether a refusal belongs to the token it has now |
| Copilot usage that Learnings runs reported over the last 30 days | Hub's database | Hub administrators, on the **Copilot** page |
| Connections, disconnections, and refusals | [Security audit](security-audit.md) | Hub administrators |

Hub passes the token only to `replica-learning`, as `COPILOT_GITHUB_TOKEN`, when it makes a Copilot request. That command runs without Hub's other secrets, keeps Copilot's state in a new private directory, and gives Copilot no tools.

A token with only the Copilot requests permission cannot read or change repositories. Someone who copies it can make Copilot requests that count toward its owner's plan, until it expires or its owner deletes it on GitHub.

## When the connection ends

- **An administrator disconnects it.** **Disconnect Copilot** needs confirmation and fresh GitHub verification on the same browser Session. Hub stops making Copilot requests. The token stays where it is kept; to end it, its owner deletes it on GitHub.
- **The person who connected it stops being a Hub administrator.** Hub disconnects Copilot in the same change as the role. Another administrator can connect it again.
- **Copilot refuses the token.** For example, it expired, its owner deleted it, or its owner lost Copilot. Hub records the refusal in the security audit, stops looking for learnings, and offers **Check the token again**. People can still decide on suggestions, and agents still get accepted learnings. A refusal belongs to the token Copilot refused. Replacing it using the procedure below lets Hub use Copilot again.
- **The token is removed.** Hub stops making Copilot requests, and the page says Hub has no token.

[Ending all Hub sessions](session-revocation.md) and resetting the GitHub App leave the Copilot connection as it is, because the token is neither a browser credential nor the App's.

## Replace the token

Token changes require a full stop/start, not a rolling restart. Before starting any process with a replacement token, stop **all** Hub web and job-worker processes using the old token and wait for them, their learning commands and their Copilot SDK/runtime children to exit. A lost Ruby worker does not prove its child command stopped; confirm no old-token learning writer or SDK child remains. Pause any automatic restart or scaling that could bring an old configuration back. This also applies when adding or removing the token on a running deployment.

The default Compose bundle runs Hub and its job workers in one container with local persistent storage. Run `./replica down` and confirm that container and its children have stopped before changing the token, then run `./replica up` after updating the configuration. The named data volume is retained. On another platform, use its equivalent full-stop procedure; if old and new token processes cannot be kept from overlapping, do not rotate this way.

After every old-token process has exited, put the replacement token in `REPLICA_COPILOT_TOKEN` and start Hub and its workers with that same configuration. Delete the old token on GitHub. Hub uses the replacement from its next Copilot request.

Hub loads the token at process startup. Overlapping processes with different tokens are not supported. Hub has no shared token-rotation ordering: an old-token worker that reads a newer token's digest can overwrite the newer token's refusal with its own late result. A token digest alone cannot tell those configurations' order. The full stop/start prevents that overlap; do not resume old-token processes afterward.

Within one token configuration, a successful request already in flight cannot clear that token's refusal; an administrator must explicitly check it again.

## Upgrade an earlier pre-release checkout

Earlier revisions of this pull request stored encrypted GitHub App user access and refresh tokens. Before upgrading one of those installations, take a protected backup using the [backup guide](backups-and-restore.md), stop its web and job-worker processes, and arrange for the person who originally connected Copilot to revoke Hub's authorization under GitHub **Settings**, **Applications**, **Authorized GitHub Apps**. That revokes the earlier authorization and its refresh tokens; it may require that person to authorize Hub again at their next sign-in.

The forward migration removes only the legacy Copilot connection and its credential columns. It preserves users, the GitHub App configuration, Builds, review data and security audit history. It does not contact GitHub, revoke remote credentials or claim that the new operator token was checked. After supplying the operator token and restarting Hub, an administrator must connect Copilot again with fresh GitHub proof.

This cleanup applies only to databases that ran the earlier pre-release credential schema. Fresh installations and existing digest-only connections are unchanged. Removing columns does not erase secrets from old backups or guarantee erasure from SQLite's storage files. Keep backups protected and retire them under your retention policy; do not restore an earlier credential-bearing database as a substitute for reconnecting. The cleanup cannot be rolled back to recover those credentials or their verification.

## Local development

[Local development](local-development.md) has no Copilot page and ignores `REPLICA_COPILOT_TOKEN`. Learnings there asks Copilot as whoever is signed in to the GitHub CLI or Copilot CLI where Hub runs; see [Learnings](learnings.md#local-development).

## Operations

The production image includes Node.js and `replica-learning` under `/opt/replica/learning`, owned by root so Hub cannot change the code it runs. In development, Hub runs `replica-learning` from `packages/learning/`, and `bin/setup` installs its runtime dependencies there. If they are missing, **Connect Copilot** says so and asks you to run `bin/setup`. Each Copilot request starts a Copilot runtime for that one command. Hub gives every command a new private temporary directory as its `TMPDIR`, where the runtime keeps its state, and deletes it afterward, even when Hub had to stop the command. Set `REPLICA_LEARNING_CLI` to run another copy of the command. Relative entry-point paths resolve from Hub's current working directory when the command is initialized, before it changes its working directory.

Hub reads at most 16 MB of a command's answer and 1 MB of its error output. It stops a command that writes more, along with any Copilot runtime the command started, and reports that the command wrote too much.
