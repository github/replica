# Learning foundation

Hub can persist one deployment-wide Copilot connection and run the host-neutral [`replica-learning`](../../packages/learning/README.md) command through a bounded process boundary. The repository Learnings API reads exact evidence, accepted guidance, recall previews, and persisted run history; records accept, edit, reject, and retire decisions; and queues explicit runs. Workers import complete review snapshots, label and consolidate them, and redact deleted comment text.

The package remains the authority for consent, purpose, evidence, approval, redaction, and learning lifecycle rules. Hub does not reimplement those rules.

## Copilot connection

Hub obtains Copilot access through a credential provider. No provider is configured by default. Production deployments can select `github-app-installation` to bill Copilot requests to one organization through the Hub GitHub App installation. Hub signs a short-lived App JWT, requests a fresh installation token with only read-only Copilot Requests permission for each command, passes it only to that command, and never persists it. Simple and local deployments may explicitly select `ambient-cli`, which uses the account signed in where Hub runs, or `environment-token`, which reads `REPLICA_COPILOT_TOKEN` from the deployment's secret store. Hub asks `replica-learning copilot status` to verify the credential before it saves the connection. The database stores the administrator membership, provider key, stable provider-configuration digest, verification time, refusal time when applicable, and a generation counter. It never stores or returns the credential.

The verification request runs before the database transaction. Hub then locks the persistent generation row, rereads the live administrator session, and refuses to commit if another connection or disconnection happened while Copilot answered. The connection change and its typed security audit commit together.

Changing the active provider or its configuration digest makes the saved connection inactive until an administrator checks and reconnects it. For the environment provider, replacing `REPLICA_COPILOT_TOKEN` changes that digest. Hub never treats an unverified credential configuration as connected.

The GitHub App digest contains the stable App ID, organization login, and installation ID, but never signing material or an installation token. Rotating the App private key or changing a workload-backed signer does not change the connection identity. Changing the App, organization, or installation does. Installation removal and Copilot Requests permission denial are terminal refusals for that configuration; rate limits, network errors, and GitHub service failures remain transient failures. Hub never falls back to a personal credential mode.

App JWT signing is an explicit integration boundary in code. The shipped runtime uses `GITHUB_APP_PRIVATE_KEY_BASE64`, or the `GITHUB_APP_PRIVATE_KEY` PEM override when set. A future governed runtime composition can replace the signer with secret-store or workload-backed signing without exposing key material to the learning command.

Disconnecting removes the connection record and advances the generation. It does not remove the operator's credential source or any learning store.

## Private storage

`REPLICA_LEARNING_ROOT` defaults to `storage/learning`. It must be a dedicated directory outside every configured static-file root. Hub rejects the filesystem root, the Hub application root, the shared `storage` root, the source public directory, the configured built-client directory and their descendants, files, and paths containing symbolic links. The check runs at startup and again when a repository store is prepared.

The repository learning integration supplies the persisted repository UUID and package scope `github.com/repositories/<repository-uuid>`. The store primitive creates `<root>/repositories/<repository-uuid>` with mode `0700` and writes the package's default `config.json` with mode `0600` only when it is absent. Existing configuration remains operator-owned.

Decision commands use an existing store and never create one implicitly. The first complete review import prepares the store.

When GitHub repository scoping first activates, previously authorized learning decisions and queued runs may finish writing to their original legacy repository's private store. The UUID-scoped store stays hidden and is never linked to a new ID-backed repository.

## Command boundary

The runner starts Node.js with the configured CLI entry point, appends `--json`, and gives the child only:

- `PATH`, `HOME`, `LANG`, `LC_ALL`, and `TZ`.
- `COPILOT_GITHUB_TOKEN` only for an explicitly token-backed command.
- A new private `TMPDIR`.

Hub passes store paths and repository scope as command arguments, not inherited `REPLICA_LEARNING_*` variables. It does not pass database, authentication, workload-identity, storage, or other deployment credentials. Standard output is limited to 16 MiB, standard error to 1 MiB, and the default deadline is 60 seconds. A timeout, output overflow, cancellation, or surviving descendant kills the command's process group before Hub removes the temporary directory.

Repository decisions, runs, and redactions use the PostgreSQL advisory-lock primitive for one Hub-wide learning execution at a time and hold the shared repository-authority lock around authority-sensitive package work. Decisions additionally hold a shared session-authority lock from the final live-session check through command exit. Session-ending transactions take only the matching exclusive session lock unless they can also change repository grants, in which case they acquire the repository lock first and the session lock second. A decision that wins keeps both boundaries until its command exits; a competing user-facing authority change returns retryable feedback after a bounded wait. Runs do not hold the session lock, so sign-out and global revocation can proceed during their long work. Runs release the repository lock during labeling, then reacquire it and retry the requester's repository-authority check before consolidation. Losing the execution-lock database connection aborts the operation and its command through the shared signal. This preserves the CLI process boundary without moving package policy into Hub.

## Repository API

The browser contracts are:

- `GET /api/repositories/:repositoryId/learnings`
- `POST /api/repositories/:repositoryId/learnings/runs`
- `POST /api/repositories/:repositoryId/learnings/:learningId/decision`

Learnings uses the shared repository-administrator boundary. It requires current GitHub admin permission recorded on the active repository grant, an active membership and repository, and the enabled selected GitHub provider. Hub administration remains deployment and security authority and does not grant access to repository learning evidence. Signed-in users without repository authority receive the Learnings contract's access-denied response without suggestion, evidence, permission, Copilot, or usage data. The response projects Hub and repository administration separately so navigation never treats one as the other.

The overview, run, and decision routes use the same repository authority. Every read rechecks authority after asynchronous store reads before returning private data. Short authority transactions retry PostgreSQL serialization and deadlock conflicts within a fixed bound, then return a retryable unavailable response instead of exposing database errors. Every write rereads the live session and repository authority after waits, and the run transaction locks the provider, membership, repository, and grant rows before it records work. Typed denials write security audits containing the membership, repository, operation, and denial reason, never learning content, evidence, decision reasons, or credentials.

The read response lists the ten newest persisted runs and decimal Copilot usage from runs started during the previous 30 days. It resolves every displayed package event against the current repository snapshot and shows the exact imported event body only when the event, episode, comment, Hub origin, and repository all match. Deleted comments remain visible as redacted evidence without text.

Decision inputs follow the browser schema. Accept and reject require the exact reviewed digest; package `stale_review` failures return `409` rather than applying a changed suggestion. If the repository becomes hidden while a decision runs, Hub returns a generic not-found response instead of exposing package-store failure details. Reject and retire require a reason. Edited acceptance writes the proposed content to a private temporary file because command-line arguments must not carry review text. Successful and failed package decisions write typed security audits without storing content, evidence, or reasons.

The run endpoint requires a usable Copilot connection. It captures and digests one complete repeatable-read repository review snapshot, creates or reuses the repository's active run, writes its typed request audit, and enqueues one idempotent on-demand job. An administrator can promote a queued automatic run into an explicit run; running or already explicit work cannot be replaced. Enqueue failure marks a newly created or promoted run failed.

Operators may opt in to automatic runs with `REPLICA_LEARNING_AUTOMATIC_RUNS=true`. One stable BullMQ schedule discovers due repositories daily at 02:00 UTC. Discovery is a no-op while the saved Copilot connection is unavailable, refused, or no longer owned by an administrator. A repository is due when its current thread activity versions differ from the review activity snapshot persisted with its last successful run, or its most recent successful or partially completed run left comments or suggestions unfinished. This comparison does not depend on review or run timestamps, so a review transaction that commits after snapshot capture remains due even when it assigned its timestamps earlier. Repositories without a successful run become due after their first review evidence.

Discovery follows the current repository-scoping state and skips removed or disconnected repositories. It captures the normal complete review snapshot before creating a run, so repository removal during discovery is skipped and later review drift becomes the same visible `snapshot_changed` run failure as an explicit request. A repository whose latest automatic run found missing or ended consent stays out of automatic discovery until a newer explicit administrator run supersedes that failure. It creates at most one active run per repository and dispatches at most 100 due repositories per sweep, ordered by their least recent run with never-run repositories first. A capture or run-creation failure for one repository is reported and does not block later repositories. Automatic jobs stay on the scheduled queue below maintenance-job priority. Before claiming one under the global learning execution lock, the processor defers to queued or recovered user-requested work on the on-demand queue.

The one-minute recovery sweep re-enqueues queued and interrupted running records on their original queue. Enqueue failures for newly discovered automatic runs are persisted as visible failed runs. Completed run records are retained for 90 days, while each repository's latest run and latest successful scheduling watermark are kept when older records are removed. Schedule setup uses one stable scheduler ID, so repeated setup updates the daily schedule instead of duplicating it.

The worker claims a queued run only once under the learning execution lock. It recaptures the snapshot and refuses drift, prepares the private store, and imports with `--redact-deleted`. Explicit review-result events retain their outcome, resulting Build, stable verifier, feedback digest, resolution event, and stale state as content-free provenance. An explicit administrator run records the initial review and instruction grant when no earlier human grant exists. An automatic run requires an existing active human grant and cannot create initial consent. The worker labels at most 400 comments and ten Copilot requests and consolidates at most ten suggestions over the previous 90 days. It records partial label counts and AI-credit usage even when a later request fails. An incomplete collection, changed snapshot, ended or missing consent, refused credential, or unreadable package result becomes a visible failed run.

Soft deletion queues an idempotent package redaction job after the review transaction commits. The recovery sweep also finds deleted review comments, and every later import uses `--redact-deleted`, so a transient queue failure cannot make a deleted body permanently eligible.

## Configuration

| Variable | Contract |
| --- | --- |
| `REPLICA_COPILOT_AUTHENTICATION` | Explicit provider: `github-app-installation` for organization billing, or `ambient-cli` / `environment-token` for local and compatibility use. There is no default or fallback. |
| `GITHUB_APP_ID` | Stable GitHub App ID used by `github-app-installation`. This is the same Hub App integration identity, not a separate personal App. |
| `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_PRIVATE_KEY` | The App signing key as base64 or a PEM override. The signer remains replaceable in code for future governed runtime composition. |
| `REPLICA_COPILOT_GITHUB_ORGANIZATION` | Organization billed for Copilot requests and shown in status and security audits. |
| `REPLICA_COPILOT_GITHUB_INSTALLATION_ID` | Numeric installation ID for that organization. |
| `REPLICA_COPILOT_TOKEN` | Required only with `environment-token`; used only for Copilot-backed package commands. Usage is attributed to the GitHub identity represented by this credential. |
| `REPLICA_LEARNING_ROOT` | Private learning-store root. Defaults to `storage/learning`. |
| `REPLICA_LEARNING_CLI` | Optional package CLI path. Source development defaults to `../packages/learning/bin/replica-learning.mjs` from `hub/`; the image sets `/opt/replica/learning/bin/replica-learning.mjs`. |
| `REPLICA_LEARNING_NODE` | Optional Node.js executable. Defaults to the running Node.js executable. |
| `REPLICA_LEARNING_AUTOMATIC_RUNS` | Optional `true` / `false` switch. Defaults to `false`. When enabled, due repositories are discovered daily at 02:00 UTC, but no runs are created unless the saved Copilot connection is usable. |

The environment-token mode may obtain its secret through a platform secret reference, but the learning child receives only the allowlisted values above. The GitHub App provider supplies a fresh credential for each command without changing that process boundary, so short-lived credentials are never durable connection identity. Organization Copilot model policy, budget controls, and installation revocation continue to apply to every request.

## Current limits

GitHub is the only repository-authority provider in this version; Entra, local sessions, and Hub administrator assignments do not synthesize repository administration. Automatic discovery is deployment-wide rather than configurable per repository and runs only after a repository administrator has established consent through an explicit run. The package remains authoritative for consent, evidence eligibility, lifecycle, recall, and redaction.
