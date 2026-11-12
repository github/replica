# Learning foundation

Hub can persist one deployment-wide Copilot connection and run the host-neutral [`replica-learning`](../../packages/learning/README.md) command through a bounded process boundary. Repository review collection, learning runs, decisions, recalls, and product records are not connected yet.

The package remains the authority for consent, purpose, evidence, approval, redaction, and learning lifecycle rules. Hub does not reimplement those rules.

## Copilot connection

Set `REPLICA_COPILOT_TOKEN` from the deployment's secret store, then sign in as a live Hub administrator and open `/settings/copilot`. Hub asks `replica-learning copilot status` to verify the token before it saves the connection. The database stores the administrator membership, the token's SHA-256 digest, verification time, refusal time when applicable, and a generation counter. It never stores or returns the token.

The verification request runs before the database transaction. Hub then locks the persistent generation row, rereads the live administrator session, and refuses to commit if another connection or disconnection happened while Copilot answered. The connection change and its typed security audit commit together.

Replacing `REPLICA_COPILOT_TOKEN` makes the saved connection inactive until an administrator checks and connects the replacement token. Hub never treats an unverified token digest as the connected credential.

Disconnecting removes the connection record and advances the generation. It does not remove the operator's token or any learning store.

## Private storage

`REPLICA_LEARNING_ROOT` defaults to `storage/learning`. It must be a dedicated directory outside every configured static-file root. Hub rejects the filesystem root, the Hub application root, the shared `storage` root, the source public directory, the configured built-client directory and their descendants, files, and paths containing symbolic links. The check runs at startup and again when a repository store is prepared.

A future repository integration supplies a stable repository UUID and package scope such as `github.com/repositories/123`. The store primitive creates `<root>/repositories/<repository-uuid>` with mode `0700` and writes the package's default `config.json` with mode `0600` only when it is absent. Existing configuration remains operator-owned.

Hub has no repository product model on the current branch, so it does not create stores or invoke repository commands yet.

## Command boundary

The runner starts Node.js with the configured CLI entry point, appends `--json`, and gives the child only:

- `PATH`, `HOME`, `LANG`, `LC_ALL`, and `TZ`.
- Variables beginning with `REPLICA_LEARNING_`.
- `COPILOT_GITHUB_TOKEN` only for an explicitly token-backed command.
- A new private `TMPDIR`.

Hub does not pass database, authentication, workload-identity, storage, or other deployment credentials. Standard output is limited to 16 MiB, standard error to 1 MiB, and the default deadline is 60 seconds. A timeout, output overflow, cancellation, or surviving descendant kills the command's process group before Hub removes the temporary directory.

Later repository mutations use the PostgreSQL advisory-lock primitive for one Hub-wide learning execution at a time. Losing that database connection aborts the operation and its command through the shared signal. This preserves the CLI process boundary without moving package policy into Hub.

## Configuration

| Variable | Contract |
| --- | --- |
| `REPLICA_COPILOT_TOKEN` | Optional operator secret used only for Copilot-backed package commands. |
| `REPLICA_LEARNING_ROOT` | Private learning-store root. Defaults to `storage/learning`. |
| `REPLICA_LEARNING_CLI` | Optional package CLI path. Source development defaults to `../packages/learning/bin/replica-learning.mjs` from `hub/`; the image sets `/opt/replica/learning/bin/replica-learning.mjs`. |
| `REPLICA_LEARNING_NODE` | Optional Node.js executable. Defaults to the running Node.js executable. |

The default deployment may obtain the environment values through platform secret references and workload identity, but the learning child receives only the allowlisted values above.

## Remaining integration seam

Repository learning runs remain blocked on real repository, Build, prototype, review-thread, and review-comment APIs. Once those product domains exist, they can:

1. Authorize the repository operation.
2. Derive a stable package scope and prepare its store.
3. Acquire the learning execution lock.
4. Capture the complete review snapshot.
5. Invoke package import, labeling, consolidation, decision, redaction, or recall commands.

That integration must keep the package's consent and lifecycle rules intact.
