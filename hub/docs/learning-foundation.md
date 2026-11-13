# Learning foundation

Hub can persist one deployment-wide Copilot connection and run the host-neutral [`replica-learning`](../../packages/learning/README.md) command through a bounded process boundary. The repository Learnings API reads package-backed accepted guidance and recall previews, records package-backed accept, edit, reject, and retire decisions, and persists learning-run history and usage. The review backend can capture one complete repository snapshot; import, run orchestration, and redaction execution remain to be connected.

The package remains the authority for consent, purpose, evidence, approval, redaction, and learning lifecycle rules. Hub does not reimplement those rules.

## Copilot connection

Hub obtains Copilot access through a credential provider. No provider is configured by default. Production deployments can select `github-app-installation` to bill Copilot requests to one organization through the Hub GitHub App installation. Hub signs a short-lived App JWT, requests a fresh installation token with only read-only Copilot Requests permission for each command, passes it only to that command, and never persists it. Simple and local deployments may explicitly select `ambient-cli`, which uses the account signed in where Hub runs, or `environment-token`, which reads `REPLICA_COPILOT_TOKEN` from the deployment's secret store. Hub asks `replica-learning copilot status` to verify the credential before it saves the connection. The database stores the administrator membership, provider key, stable provider-configuration digest, verification time, refusal time when applicable, and a generation counter. It never stores or returns the credential.

The verification request runs before the database transaction. Hub then locks the persistent generation row, rereads the live administrator session, and refuses to commit if another connection or disconnection happened while Copilot answered. The connection change and its typed security audit commit together.

Changing the active provider or its configuration digest makes the saved connection inactive until an administrator checks and reconnects it. For the environment provider, replacing `REPLICA_COPILOT_TOKEN` changes that digest. Hub never treats an unverified credential configuration as connected.

The GitHub App digest contains the stable App ID, organization login, and installation ID, but never signing material or an installation token. Rotating the App private key or changing a workload-backed signer does not change the connection identity. Changing the App, organization, or installation does. Installation removal and Copilot Requests permission denial are terminal refusals for that configuration; rate limits, network errors, and GitHub service failures remain transient failures. Hub never falls back to a personal credential mode.

App JWT signing is an explicit integration boundary in code. The shipped runtime requires `GITHUB_APP_PRIVATE_KEY`. A future governed runtime composition can replace the signer with secret-store or workload-backed signing without exposing key material to the learning command.

Disconnecting removes the connection record and advances the generation. It does not remove the operator's credential source or any learning store.

## Private storage

`REPLICA_LEARNING_ROOT` defaults to `storage/learning`. It must be a dedicated directory outside every configured static-file root. Hub rejects the filesystem root, the Hub application root, the shared `storage` root, the source public directory, the configured built-client directory and their descendants, files, and paths containing symbolic links. The check runs at startup and again when a repository store is prepared.

A future repository learning integration supplies the persisted repository UUID and package scope such as `github.com/repositories/123`. The store primitive creates `<root>/repositories/<repository-uuid>` with mode `0700` and writes the package's default `config.json` with mode `0600` only when it is absent. Existing configuration remains operator-owned.

Hub uses the repository UUID for the store directory and the package scope `github.com/repositories/<repository-uuid>`. Decision commands use an existing store and never create one implicitly. A future complete review import prepares the store before its first run.

## Command boundary

The runner starts Node.js with the configured CLI entry point, appends `--json`, and gives the child only:

- `PATH`, `HOME`, `LANG`, `LC_ALL`, and `TZ`.
- `COPILOT_GITHUB_TOKEN` only for an explicitly token-backed command.
- A new private `TMPDIR`.

Hub passes store paths and repository scope as command arguments, not inherited `REPLICA_LEARNING_*` variables. It does not pass database, authentication, workload-identity, storage, or other deployment credentials. Standard output is limited to 16 MiB, standard error to 1 MiB, and the default deadline is 60 seconds. A timeout, output overflow, cancellation, or surviving descendant kills the command's process group before Hub removes the temporary directory.

Repository decisions use the PostgreSQL advisory-lock primitive for one Hub-wide learning execution at a time. Losing that database connection aborts the operation and its command through the shared signal. This preserves the CLI process boundary without moving package policy into Hub.

## Repository API

The browser contracts are:

- `GET /api/repositories/:repositoryId/learnings`
- `POST /api/repositories/:repositoryId/learnings/runs`
- `POST /api/repositories/:repositoryId/learnings/:learningId/decision`

Current product authorization has Hub members and Hub administrators but no repository-specific role model. Signed-in members receive the Learnings contract's access-denied response without suggestion, evidence, permission, Copilot, or usage data. Hub administrators may read accepted guidance and recall previews and may make decisions. Every write rereads the live session and administrator authority immediately before it reaches the package store.

The read response lists the ten newest persisted runs and decimal Copilot usage from runs started during the previous 30 days. It withholds suggestions when the review domain cannot resolve every displayed package event to exact repository comment evidence. Accepted guidance and recall remain available because they do not expose review comment text.

Decision inputs follow the browser schema. Accept and reject require the exact reviewed digest; package `stale_review` failures return `409` rather than applying a changed suggestion. Reject and retire require a reason. Edited acceptance writes the proposed content to a private temporary file because command-line arguments must not carry review text. Successful and failed package decisions write typed security audits without storing content, evidence, or reasons.

The run endpoint currently returns `409 review_snapshot_unavailable`. It does not create a run or enqueue work. Enabling it requires both sides of the production seam below.

## Configuration

| Variable | Contract |
| --- | --- |
| `REPLICA_COPILOT_AUTHENTICATION` | Explicit provider: `github-app-installation` for organization billing, or `ambient-cli` / `environment-token` for local and compatibility use. There is no default or fallback. |
| `GITHUB_APP_ID` | Stable GitHub App ID used by `github-app-installation`. This is the same Hub App integration identity, not a separate personal App. |
| `GITHUB_APP_PRIVATE_KEY` | App signing key required by the shipped runtime. The signer remains replaceable in code for future governed runtime composition. |
| `REPLICA_COPILOT_GITHUB_ORGANIZATION` | Organization billed for Copilot requests and shown in status and security audits. |
| `REPLICA_COPILOT_GITHUB_INSTALLATION_ID` | Numeric installation ID for that organization. |
| `REPLICA_COPILOT_TOKEN` | Required only with `environment-token`; used only for Copilot-backed package commands. Usage is attributed to the GitHub identity represented by this credential. |
| `REPLICA_LEARNING_ROOT` | Private learning-store root. Defaults to `storage/learning`. |
| `REPLICA_LEARNING_CLI` | Optional package CLI path. Source development defaults to `../packages/learning/bin/replica-learning.mjs` from `hub/`; the image sets `/opt/replica/learning/bin/replica-learning.mjs`. |
| `REPLICA_LEARNING_NODE` | Optional Node.js executable. Defaults to the running Node.js executable. |

The environment-token mode may obtain its secret through a platform secret reference, but the learning child receives only the allowlisted values above. The GitHub App provider supplies a fresh credential for each command without changing that process boundary, so short-lived credentials are never durable connection identity. Organization Copilot model policy, budget controls, and installation revocation continue to apply to every request.

## Remaining integration seam

Repository learning runs can consume `captureRepositoryReviewSnapshot()` from the [review backend](review-collaboration.md#learning-snapshot-seam). The integration must also resolve displayed package event references to exact stored repository comment versions. Missing, foreign, deleted, or mismatched references remain unresolved and are counted rather than replaced with live comment text.

1. Authorize the repository operation.
2. Derive a stable package scope and prepare its store.
3. Acquire the learning execution lock.
4. Capture the complete repeatable-read review snapshot.
5. Invoke package import, labeling, consolidation, decision, redaction, or recall commands.

The run producer and worker must use a stable BullMQ job definition with record IDs and snapshot digest only. They must create or reuse one active run per repository, reread authority and repository state in the worker, preserve partial usage reported by failed labeling commands, and never enqueue a success-shaped no-op. The integration must keep the package's consent and lifecycle rules intact, must not create another Hub review store, and must not omit deleted-message or resolution-history records from the imported snapshot.
