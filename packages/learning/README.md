# Replica learning

`@github/replica-learning` lets Replica learn from review evidence without training a model. It owns the version 1 learning contracts, the memory provider interface, built-in SQLite, JSON Lines, and in-memory providers, two reference consolidators, a conformance suite, the `replica-learning` command, and an example that plugs in [Agent Memory Repo](examples/agent-memory-repo/README.md). It isn't published to npm yet, so run it from a Replica checkout with a Node.js version matching `engines.node` in [package.json](package.json).

The design and its trade-offs are in [ADR 0001](../../docs/adr/0001-learning-extension-architecture.md).

## What the first loop does

The first loop turns Hub review comments into guidance that a person approved. Hub runs it on its own once a Hub administrator connects Copilot; see [Learnings](../../hub/docs/learnings.md).

1. A person records consent for named purposes, such as review and instruction. In Hub, the administrator who connected Copilot does, for each repository.
2. Hub imports one complete snapshot of a repository's comments. Each review thread becomes an episode pinned to its prototype and to the Build the reviewer commented on.
3. A labeler, Copilot by default, labels design themes. A consolidator proposes the themes that recur across distinct threads, prototypes, and reviewers.
4. A person accepts, edits, or rejects each proposal against the digest they reviewed.
5. Agents recall the accepted learnings when they build the next prototype.

Nothing is accepted automatically. Nothing is published or used for training without a grant for that purpose. No model weights change.

## Try it

```sh
cd packages/learning
npm ci
npm test
npm run demo
```

The demo runs the whole loop on synthetic comments in a temporary checkout and prints every command with its output. `npm run demo:agent-memory-repo` adds Dreaming, which merges duplicate learnings, and publishes the result to a memory repo other agents can read.

## Run it yourself

Hub runs these commands for you. To run them in a prototype checkout, which keeps its data under `.replica/learning/`, use Node:

```sh
node <replica-checkout>/packages/learning/bin/replica-learning.mjs doctor
```

| Command | What it does |
| --- | --- |
| `doctor` | Shows the scope, the provider, where data goes, and why each was chosen |
| `grants add`, `grants list`, `grants withdraw` | Records, lists, and ends consent for purposes |
| `redact <event-id>` | Removes a comment's text when a person asks: every version and its labels |
| `redact --comment <hub-comment-id>` | Removes the same text for a Hub comment named by its Hub ID. It imports and labels nothing and needs no active grant. `--reason` defaults to the comment being deleted at its source. `removed` in the `--json` output counts the events whose text it removed, 0 when none was left. Run it only while no import or labeling of the same store is in progress |
| `import hub-comments <log.json>` | Imports a logged snapshot from the canvas comment actions. `--redact-deleted` also removes the text of comments the snapshot shows as deleted |
| `label` | Labels, with Copilot or the configured labeler, each comment it has not been asked about, and reports what it cost. `--since` skips older comments, and `--max-requests` stops after that many labeler requests |
| `label <labels.json>` | Records theme labels someone else wrote |
| `copilot status` | Shows whether Copilot answers here, as whom, and with which models |
| `consolidate --from <time> --to <time>` | Stores proposals and says whether the window's evidence is complete. `--max` caps the new or changed proposals one run stores, 10 by default. A proposal already stored unchanged and still undecided does not count, so later runs reach the themes past the cap, and neither does a proposal the store refuses. `overBudget` in the `--json` output counts the proposals the cap held back |
| `memories`, `show <id>` | Lists learnings and shows one with its evidence and digests |
| `accept`, `reject`, `retire`, `supersede` | Records a person's decision |
| `recall --task <text>` | Prints the accepted learnings for the next run. `--task-file -` reads the task from standard input instead, which keeps a person's prompt out of the process list. `--preview --by github:<login>` shows a person the same text without recording a use. Only a person can preview, so an agent never reads learnings without an audit entry |
| `export --purpose <p>` | Writes a bundle of what that purpose may use; `--learnings-only` leaves out episodes and their comments |
| `status`, `verify` | Reports counts and anything that needs attention, and re-checks every record |

Add `--json` to any command for machine output.

`observations --purpose review --event <id> --event <id> --json` reads only the named events and their containing episodes. Pass at most 100 IDs per call, batching larger evidence lists instead of exporting the whole store. Missing IDs and events that consent, retraction, or redaction withholds are omitted, with no unrelated events or episodes returned. Other observation filters intersect the selection. In the API, `queryObservations(context, { purpose: "review", eventIds: [] })` returns empty `episodes` and `events`; omitting `eventIds`, or all CLI `--event` flags, preserves the unfiltered behavior.

## Rules

- In a checkout, scope comes from its `origin` remote: its host and owner/name, such as `github.com/acme/checkout-prototypes`. The learning config cannot change it. A host that keeps each repository's store outside any checkout, such as Hub, names the repository with `--repository host/owner/name` and the store with `--dir`; if that directory is inside a checkout, Git must ignore it. The same owner/name on two hosts gets two scopes, and episode IDs include the scope, so the two never share records. The scope is asserted by whoever runs the command, not checked repository access, so a host checks access before it runs one. Hub review logs name only owner/name, so the importer checks the repository but cannot check the host. Every record carries its scope, and a store reads and writes only records in the caller's scope. Output never shows a user name or password from the remote URL.
- The purposes are review, instruction, evaluation, analytics, training, and publication. Permission for one never implies another. A grant names its purposes and sources, and optionally the range of evidence times it covers. It covers a comment when it names the comment's source and its range contains the time the comment was written. A label counts only while the comment it judges does.
- Withdrawing a purpose takes effect at once. Evidence stops serving that purpose, learnings built on it stop being recalled, and the command lists earlier exports that already copied it so their owners can be asked to delete it. A learning depends on its counterevidence too: it is used only while both the evidence and the contradictions a reviewer saw permit the purpose.
- Evidence is append-only. An edited comment adds a version that supersedes the old one. A deleted comment adds a retraction that removes the earlier versions, and labels on them, from every purpose. Nothing is rewritten, with one exception the contract allows: a provider may remove an event's payload and record why in `redaction`. The event's digest still verifies, and a redacted event is never evidence. Labels and retractions name the event they apply to in `parentEventId`, which must match the payload and which the digest covers, so redacting one never loses its target and a redacted retraction still retracts.
- `redact` uses that exception when a person asks to remove a comment, for example its author. Every version of the comment and every label on them lose their text, keep their IDs and digests, and stop serving every purpose. Other comments, replies included, keep theirs. Versions are found by their edit links inside the thread and by their Hub comment ID, and a stored history that links the comment to another comment, or out of its thread, is refused with nothing removed. The command needs a reason, records who asked, and lists the accepted learnings that need rebuilding and the exports to follow up, including learnings-only exports of a learning that cites the comment. Each removed event's redaction note says who removed it, when, and why, and on a comment version it keeps the Hub comment ID, so the comment's other versions can still be found once the text is gone. A provider refuses a note that names a different comment. Each removal gets one audit entry built from that note. If the command fails part way, run it again: it finishes the removal, adds only the missing audit entries, and reports the same follow-ups. Two people removing the same comment at once each remove some versions, and every removal is audited once. A learning built on the comment is never shown, recalled, or exported again, because its evidence is gone, but its stored text, which may paraphrase the comment, is not rewritten; retire or replace it. Each event keeps its `payloadDigest`, so someone who guesses a very short comment's exact text and fields could confirm the guess. Importing the same snapshot again does not bring the text back, because the store already holds those events; an edit made later on Hub arrives as new text. Files outside the store, such as snapshots saved for import, keep the text until someone deletes them. It needs a provider with the `observation.redact` capability, which the built-in providers have.
- A deleted comment keeps its text in the store unless the host asks otherwise. A host that erases deleted comments, as Hub does, imports with `--redact-deleted`. After recording the import, it removes the text of every comment the snapshot shows as deleted, and of the labels on it, the same way `redact` does, and records the importer as the one who removed it. It reports the learnings that need rebuilding and the exports to follow up. If the removal fails part way, the next such import finishes it. A host can instead remove one deleted comment with `redact --comment <hub-comment-id> --by <person>`, naming the person who deleted it. It removes the text the same way without an import, so it needs no active grant and stores no other comment. It removes nothing, and succeeds, when the store holds no text of that comment, so the host can run it again after a failure, or for a comment it never collected.
- A host must not run `redact` or `redact --comment` while an import or labeling of the same store is in progress. Each reads the comment's events, then removes their text. Text that an import or a label stores in between stays, and `verify` does not report it. For a comment deleted at its source, later imports must also show it as deleted and use `--redact-deleted`, which removes what stayed. Hub meets both: its runs and deletion jobs share an execution-time lock, and its imports use `--redact-deleted`. [Hub operations](../../hub/docs/learnings.md#operations) explains the lock's lifetime and safe manual removal.
- Evidence references must resolve to stored events inside the episode they name. The store rebuilds each reference's source pin, time, and author from storage and refuses a proposal that states different ones.
- A learning has two digests. `contentDigest` identifies the learning itself. `reviewDigest` covers everything a reviewer is shown, including its support, dissent, and rationale. Accepting or rejecting requires the `reviewDigest` the person reviewed, so new support or dissent makes an older review stale. An edit binds the approval to the new content, and any later change to an accepted learning voids it. Accepting may change only the text, and it records `edited` exactly when the text changed. It replaces only the learnings the reviewed lifecycle names. A stored acceptance that changes anything else, such as the evidence, counts as damaged and is never recalled.
- Only a person decides. Granting, withdrawing, accepting, editing, rejecting, retiring, superseding, and exporting require a human principal, and the contracts require a human on every approval. The local command cannot authenticate people, so it marks those identities as asserted.
- Every change has an audit entry. The store writes each grant, withdrawal, learning version, and export in one provider write with the audit entry that records it, and an import writes its episodes, events, collection, and audit entries in one provider write, so a crash or an error never leaves one without the other. `verify` reports any episode, event, grant, withdrawal, collection, export, or learning version that no audit entry records, and any audit entry that names a record the store does not hold. It also reports a redaction whose audit entry is missing, so an interrupted removal can be retried even though the event's original digest and import receipt still match.
- Supersession lives on the replacement. An accepted learning lists what it replaces in `supersedes`, and the replaced learnings keep their own state while showing as superseded. A learning records what it replaces once: when it is accepted, or with one later `supersede` if it was accepted without replacing anything. To replace more, propose a merge. A learning that a replacement already claimed cannot be replaced again. A replacement must be a learning recall uses at that moment: one that has expired, does not apply yet, or has evidence that no longer permits instruction cannot replace another, because recall would then use neither. When replacements race, readers take them in the order they were made and apply each one whole or not at all. A replacement that names any learning already claimed, or was itself replaced first, replaces nothing and is marked conflicted, so a losing merge never removes a learning it did not win and reciprocal replacements cannot hide both learnings. A losing acceptance means the learning is not used; a losing `supersede` leaves the learning as it was. Claims come only from intact versions, and retiring or damaging a replacement does not bring back what it replaced; that takes a new proposal.
- An incomplete window is never reported as empty. A window is complete only when complete, unfiltered collections cover it. Otherwise consolidation reports the missing spans instead of "nothing found".
- A collection describes exactly the snapshot it was imported from. A scope holds one collection for each snapshot ID, with the digest of the snapshot's normalized contents. Importing the same snapshot again, from the same log or another log of it, keeps the stored collection and audits that one. A log with different contents under a snapshot ID already imported is refused before anything is stored; collect a new snapshot instead. An unseen snapshot older than one already imported from the same Hub repository is also refused, so it cannot restore old edits or deleted text. Replaying a known older snapshot keeps its collection but does not change current events. The provider enforces one collection per snapshot ID in the same write that stores the comments, so when two imports with different contents race, only one is stored.
- Damaged records stop the store. If any stored grant, withdrawal, episode, event, or collection fails its schema, digest, or scope check, operations refuse to run until `verify` finds the damage and someone repairs it. A damaged learning is never used, and reading it shows only its ID, state, kind, theme, and digests, each strictly checked. These checks catch altered records; they cannot catch a provider that omits or replays whole records.
- Comment text is data. It never changes settings or decisions, terminal output quotes it, and recall never includes raw comments. Input JSON that repeats a member name is refused.
- Recall writes each learning as plain lines of data, with the learning's text quoted as a JSON string. Every field, including who accepted the learning, has its line breaks turned into spaces and its control characters and invisible formatting characters removed: zero-width characters, tag characters, and marks that reorder text. The store refuses a person or agent ID that contains such characters, and the v1 schemas refuse a record with such an actor ID, so an ID reads the same everywhere it is shown. The character budget includes the full heading, framing, quotes, and newlines. A budget too small for the required framing is refused with the minimum it needs; recall never cuts off the framing or returns oversized text.
- Reading a learning is a use. `show` and `memories` read for review; when a learning's evidence no longer permits review, they withhold its content, evidence, and rationale. `show --history` checks each version on its own, so an older version whose evidence or counterevidence no longer permits review shows only its state and digests.

## Contracts

The JSON Schemas in [`contracts/v1`](contracts/v1) are the normative contract. Every record names its schema version, and a stored v1 record is never read as another version.

| Schema | Record |
| --- | --- |
| `episode` | One review thread, session, or scenario run, with its source pin, actors, and the grants it was collected under |
| `event` | One append-only timeline entry, such as a comment, a label, a labeler's record that it found nothing to label, a status change, or a retraction |
| `evidence-ref` | The exact events and source pin behind a learning |
| `consent-grant`, `grant-withdrawal` | Permission for purposes, and its end |
| `memory-proposal` | What a consolidator returns |
| `memory-record` | One version of a learning and its lifecycle |
| `collection` | One import and whether it was complete |
| `provider-manifest` | What a provider is, what it supports, and where data goes |
| `export-manifest` | What left the store, for which purpose, and what was held back |
| `audit-entry` | One operation, with IDs and digests but no content |

Each digest is `sha256:` plus the SHA-256 of the record's RFC 8785 canonical JSON. [`contracts/v1/vectors/canonical-json.json`](contracts/v1/vectors/canonical-json.json) holds shared vectors for other languages. Times are UTC with six fractional digits, so text order is time order. [`contracts/v1/examples`](contracts/v1/examples) holds a valid example of every record, and [`contracts/v1/invalid`](contracts/v1/invalid) holds records that must fail, each with its reason.

Programmatic inputs must use plain JSON objects and dense arrays with enumerable data properties; only an array's intrinsic `length` may be non-enumerable. Convert dates to timestamp strings and maps, sets, and class instances to JSON data before passing them to the store. Accessors and custom `toJSON` serializers, including those on arrays, are refused without running them, so the content hashed is the content storage keeps. Object properties whose value is `undefined` are omitted; an array item cannot be missing or `undefined`.

`src/contracts-validators.cjs` is generated from the schemas and needs nothing at runtime. After changing a schema, run `npm run schema:generate`; CI runs `npm run schema:check`.

### Reviewer identity

Hosts should include the authenticated GitHub numeric user ID as `author.githubId` and `resolvedBy.githubId` alongside the unchanged `login` in Hub comment snapshots. The importer uses `github-user:<scope.host>/<githubId>` as the actor's identity and keeps the login in `actor.login` only for display. Renaming an account therefore does not create another reviewer, and two actual accounts that used the same login stay distinct. A stable GitHub identity requires an explicit GitHub host in the scope. Local-development hosts instead supply the real Hub user ID as `localId`, only with scope host `local`; these actors use `hub-user:<Hub origin>/<localId>`, not fabricated GitHub IDs. IDs must be positive safe integers, the two fields cannot appear together, and invalid supplied IDs are refused without falling back to a login.

Old snapshots with neither ID remain readable as asserted login-based identities. Hosts opt into stable identities by adding top-level `reviewerIdentity: "stable-user-id"` to the collection log; numeric author or resolver IDs also imply that policy for callers that omit the declaration. Any other supplied declaration is refused. A valid import records that policy for the exact Hub origin and repository ID, even when the capture is filtered, incomplete, or empty, without changing its filters or completeness or collecting more comments. Hosts must still import valid empty captures rather than skip them, so old guidance cannot remain usable just because no author was returned. Active review consent remains required; a refused import changes nothing.

From adoption onward, unresolved login-only comments from that source may be read for review but cannot serve instruction, evaluation, analytics, training, or publication, and a later legacy snapshot cannot undo that restriction. Old-format stores that have not adopted stable IDs retain their legacy behavior, which does not establish that two logins belong to two people. Hosts must not treat that legacy count as verified identity. A replacement comment keeps the original feedback time, so migration never counts as new recent corroboration.

For each positively matched comment, adoption appends `identity_corrected` retractions of its legacy versions and an identity-bound replacement comment, even when the text and edit time did not change. It never aliases logins globally or rewrites sealed records, old approvals, or audit entries. Redacted payloads stay absent, and withdrawal rules still apply. Once a comment has a stable author, an import cannot rebind it to another user or downgrade it to a login-only identity. Repeated snapshots add no correction or replacement twice; collect a fresh snapshot ID when adding identity fields to a previously imported log.

Affected proposed learnings cannot be accepted against their old evidence, and affected approved learnings stop recall and export until legitimate rebuilding and human review. `status.identityNeedsReview` explains that state without changing the stored approval. Import results include `identityUpdates` with a reason, corrected event IDs, and affected proposed or accepted memory IDs; `status` also lists the action needed. New identity-bound comment versions need labeling again. If corrected evidence no longer meets the recurrence thresholds, no replacement proposal is produced and the old one remains unavailable. Guidance that already cites intact stable identities stays unchanged.

## Bring your own provider

A provider stores canonical records and returns them. It implements `manifest()`, `health()`, `appendRecords()`, `appendBatch()`, `readRecords()`, `appendMemoryVersion()`, and `readMemoryVersions()`. `appendBatch()` appends to several streams at once. Every append method also takes the audit entries that record the change, and stores the change and its entries in one atomic write. The contract is in [`src/provider-contract.mjs`](src/provider-contract.mjs) and the types are in [`index.d.mts`](index.d.mts). The learning store keeps every consent, purpose, scope, and approval rule, re-checks everything a provider returns, and stops on damaged records, so a provider never has to enforce consent itself. A provider must still be trusted to return every record it stored.

Run the conformance suite against your provider:

```js
import { memoryProviderConformance } from "@github/replica-learning/conformance"
import { createMemoryProvider } from "./my-provider.mjs"

memoryProviderConformance({ name: "my provider", createProvider: () => createMemoryProvider({ dataDirectory: makeEmptyDirectory() }) })
```

Then select it in the checkout's `.replica/learning/config.json`:

```json
{ "schemaVersion": "replica.learning-config/v1", "memory": { "provider": { "module": "./providers/my-provider.mjs" } } }
```

The module must be inside the checkout and export `createMemoryProvider(options)`. Every provider below passes the same suite:

| Provider | Choose it with | Stores | Redaction |
| --- | --- | --- | --- |
| SQLite, the default | `"sqlite"` | One database file, with the SQLite driver built into Node.js | Yes |
| JSON Lines | `"jsonl"` | One file per stream that a person can read | Yes |
| In memory | `"in-memory"` | Process memory, for tests | Yes |
| Single file | [`test/fixtures/json-file-provider.mjs`](test/fixtures/json-file-provider.mjs) | One JSON file, written only from the contract with no imports from this package | No |

The optional `observation.redact` capability adds `redactRecord`, described in [`src/provider-contract.mjs`](src/provider-contract.mjs); without it, `redact` refuses with `unsupported`.

Provider queries may filter audit entries with `operations`, together with scope, IDs, and time. An empty operations list matches nothing; omitting it returns every matching operation. Comment removal and imports that erase deleted text read only `evidence.redact` receipts, so their audit reads do not return the repository's growing recall history. SQLite indexes those operations, including when it opens an existing store. JSON Lines still scans the file, but reads it one line at a time and retains only matches; its writes retain only the existing IDs they need to check. No recall audit entries are deleted or compacted.

## Label with Copilot

`replica-learning label` with no file labels every comment the labeler has not been asked about, then reports how many it labeled and what Copilot reported it cost. The built-in labeler uses the [Copilot SDK](https://github.com/github/copilot-sdk), an optional dependency that `npm ci` installs:

- Copilot sees only comments the review purpose may use now, grouped in their threads, without who wrote them, plus the theme keys already in use so it reuses them.
- Copilot is asked about each comment once. When it gives a comment no label, or a label the contract refuses, the store records a `no_annotation` event for that labeler, so it is not asked about that comment again. It can still see the comment as context when asked about another comment in the same thread. An edited comment is a new version and is asked about again.
- The session has no tools, refuses every permission request, and keeps its state in a new private directory that the command deletes, so a comment cannot make Copilot run anything.
- Copilot chooses the model (`auto`) unless `labeling.options.model` or `--model` names one. Each label records the model that wrote it.
- The store checks every label against the contract and refuses the rest. Labels are an agent's judgment: a consolidator turns recurring themes into proposals, and only a person accepts one.
- The credential is `COPILOT_GITHUB_TOKEN`: a GitHub user token, such as a fine-grained personal access token whose only permission is Copilot requests, or a GitHub App installation token that holds only the organization Copilot requests permission, whose usage Copilot bills to the organization. Hub passes the token its operator sets in `REPLICA_COPILOT_TOKEN`, or, with organization billing, a new App token for each command. Without it, Copilot uses whoever is signed in to the Copilot CLI or the GitHub CLI on this machine. The config file never holds a credential.
- Usage counts each model request, its tokens, and its AI credits in nano-AI units. The built-in labeler rounds positive fractional SDK counts up to whole tokens and nano-AI units per usage event, adding less than one unit per field, so known nonzero usage does not disappear. Custom labelers must return nonnegative safe integers; their reports are not rounded. GitHub's billing pages are authoritative.

Hosts that re-check authorization between requests can use `label --max-requests 1 --limit 400 --json`. The optional positive integer cap limits calls to the configured labeler, not the number of comments in a request or model-usage events. Omit it to retain normal multi-group labeling. Comments in groups beyond the cap remain unprocessed and are included in `remaining`; `considered` counts only comments actually sent. Call again after re-checking access to process the next group. Thread grouping and the 16,000-character group target are unchanged, so the cap does not promise a token or billing limit.

If a model request or persistence fails after labeling starts, the API throws an error with the partial `LabelingResult` in `details.labelingResult`. Reported usage from completed responses, and any usage the service reported before its failure, is retained; unavailable usage is never estimated. With `--json`, the command prints that partial report plus `error: { code, message }` on stdout and returns a nonzero exit status with the error on stderr. Hosts must record available usage before propagating the failure, not interpret the partial report as success. Completed markers stay durable and failed or skipped groups remain retryable. The store re-checks eligible comments and durable markers after a failure, including a write that committed before it reported an error. If that read also fails, the report includes `progressError` and keeps a conservative `remaining` count rather than claiming exact progress. Invalid request caps are refused before opening the store or calling the labeler.

The command closes the labeler before emitting a result. If closing fails, it returns a nonzero status and retains any known result and usage in the error report with `cleanupError`. An earlier labeling or authorization error remains the primary error; cleanup never overwrites it. If no labeling result exists yet, errors still produce no JSON report.

A labeler failure remains the primary error even if the usage attached to it is malformed. The partial report includes `usageError` when that usage cannot be verified, and its totals retain only verified usage rather than estimating the missing cost. Hub can therefore record a token refusal and stop scheduled runs even when the request's cost is unknown, with the notice shown beside the failure.

To use another labeler, set `labeling.labeler` to `{ "module": "./path.mjs" }` exporting `createLabeler(options)`. A labeler returns labels for the comments it was asked about; the types are `MemoryLabeler` in [`index.d.mts`](index.d.mts).

## Bring your own consolidator

A consolidator has a `manifest` and `consolidate(request, view)`. It reads a frozen view of the evidence the purpose may use and returns proposals and diagnostics. The view shows a memory's content, evidence, and counterevidence only while its evidence permits the purpose. The store gives a consolidator no write access and saves everything it returns as proposed, up to the run's cap on new or changed proposals. A proposal it already holds unchanged does not count against the cap, so a consolidator should return every proposal it would make. A consolidator is code you choose to run; the frozen view is not a sandbox. Select one with `consolidation.consolidator` in the config, using `"recurrence"` (the default), `"none"`, or `{ "module": "./path.mjs" }` exporting `createConsolidator(options, builtins)`. `builtins` holds `createRecurrenceConsolidator` and `createNoopConsolidator`, so a module can build on them without importing this package.

The recurrence consolidator is deterministic. By default it proposes accessibility and visual-quality themes with observed problems in at least 2 threads, 2 prototypes, and 2 reviewers. It holds back contested themes, themes with an accepted learning still in effect, and rejected themes without new support. When an accepted learning has stopped applying, for example because its evidence was withdrawn, a new proposal for the theme offers to replace it. Change the thresholds with `consolidation.options`.

## Example: Agent Memory Repo

[Agent Memory Repo](https://github.com/AgentMemoryRepo/agentmemoryrepo) is an open format for agent memory: a Git repo of Markdown entries, cleaned up by a periodic Dreaming agent. [`examples/agent-memory-repo`](examples/agent-memory-repo/README.md) plugs it in twice. Its Dreaming consolidator proposes merges of learnings that say the same thing, reports look-alikes that conflict, and flags outdated or contested learnings. That is pruning with a person's approval: records stay append-only, and recall stops using what a person merged away or retired. Its publisher copies accepted learnings into a memory repo through a learnings-only export, one file per repository, so other agents can read them and a withdrawal can find the copy.

## Local storage

The default provider keeps every record in one SQLite file, `learning.sqlite`, in the learning data directory. In a checkout that directory is `.replica/learning/`, which the starter already ignores and no dev server or build serves. Inside a checkout, the command stores data and writes exports only under `.replica/`, after following links, and only when Git ignores that exact path. Anywhere else in the checkout it refuses, including the checkout root and directories whose names merely start with two dots. Directories are created with mode 0700 and files with 0600, and the providers refuse a directory other users can read. They also refuse a store file or directory that is a symbolic link, has a second name, or resolves outside the data directory, including the files SQLite keeps beside its database, and they open files without following links. Otherwise anyone who can write the data directory, such as a coding agent in the checkout, could plant a link that sends the store's reads and writes to another file. The SQLite driver built into Node.js cannot open a file without following links, so the SQLite provider checks the database file before it opens it and again right after, and refuses it unless it is the same file. It checks the files SQLite keeps beside the database right after opening, too. These checks guard against links placed ahead of time. A process running as the same user can still swap a file between them.

The SQLite provider runs every write in a `BEGIN IMMEDIATE` transaction, which locks out other writers, including other processes, until it ends; write-ahead logging lets readers continue. A change and its audit entry share one transaction. A new learning version is written only when the latest one has the digest the store expects. Each row keeps the record's exact JSON, so digests still verify. A redaction replaces the comment's row with a copy that has no text. The database overwrites removed text with zeros, and a redaction ends with a checkpoint that empties the write-ahead log; if another process is reading at that moment, the next checkpoint does. Backups and copies of the file keep their own text.

The JSON Lines provider writes one file per stream under `v1/`, in a form a person can read. After any crash or error, the store holds each write whole or not at all. A call that succeeds has stored its write. A call that fails has stored nothing, except when the disk reports an error while the write commits. Then the call fails with `storage_outcome_unknown`, and the write may or may not be stored, though never in part. On file systems where Node.js can sync directories, which are those of Linux and macOS, all of this also holds after a power failure, and a stored write survives one, as long as the disk keeps what it reports as synced.

The provider keeps that guarantee this way:

- Every write goes through a journal, `v1/.pending`, whether it adds one record or an import's episodes, events, collection, and audit entries. The writer records the length of each file it will change, and syncs the journal and `v1/`. It writes and syncs each file, then adds a line to the journal that marks the write committed, and syncs it. That sync is the commit point. After it, the call succeeds, whatever happens while closing or deleting the journal.
- Every name the write relies on is synced before the commit point. Before a provider's first commit, it syncs every directory on the store's path, from `v1/` up to the top of its file system, because another process may have created part of the path without syncing it yet. After that, a write that creates a stream file syncs `v1/`. The provider also syncs the parent of each directory it creates.
- A write that fails before the commit point is undone before the error is reported: the writer cuts each file back to its recorded length, syncs it, and deletes the journal. If the disk fails during the undo too, the journal stays, and the next read or write finishes the undo. Once the writer has begun the commit line, it cuts files back only after dropping that line and syncing the journal both succeed. If either fails, it leaves every file whole and the journal in place, and the call fails with `storage_outcome_unknown`. The next read or write then keeps the whole write or cuts all of it back, and so does recovery after a power failure.
- Reads see only committed writes. Reads and writes take one lock file that only its holder removes, and on one machine a lock is broken only after its process has exited. If taking or releasing the lock fails before the file is removed, the same process removes it at the start of its next read or write of that store, through any provider, even if the lock's token was only partly written. Before each read and write, the holder finishes a write that stopped: it keeps a committed one and undoes any other. A read therefore needs write access to the store. A line without its newline is never read as a record. A store whose directory does not exist yet reads as empty, and reading it creates nothing.
- Taking ownership, removing a lock, and reclaiming an abandoned one take turns through `v1/.lock-break`. A paused writer whose unfinished lock was reclaimed is refused before it enters the journal, and cannot remove its successor's lock. The marker itself is never reclaimed by age, because its holder could still be paused. If its process crashes, calls time out with `conflict`; remove the marker only after checking that all processes using the store have stopped. Invalid lock entries, such as symbolic links, are refused rather than followed.
- A redaction is atomic and durable. It rewrites the events file through a copy with a random name, renames the copy into place, and syncs `v1/`. If that sync fails, the call fails with `storage_outcome_unknown`, because the redaction shows at once but may not survive a power failure. A failed rewrite deletes its copy, the next read or write deletes one a crash left, and until then `verify` reports it, because it may hold removed text.

It is weaker than SQLite in these ways:

- Reads and writes take turns, because they share one lock. With write-ahead logging, SQLite lets reads continue during a write.
- A redaction leaves the old events file's bytes on the disk until the file system reuses their space. SQLite overwrites removed text with zeros.
- Writes are slower. Each one syncs the disk at least five times, and a provider's first write also syncs every directory above the store.
- On Windows, Node.js cannot sync a directory, so a power failure can lose a newly created file's directory entry.

Anyone who can open the files sees every stored comment, whatever the grants say: the learning store, not the provider, decides who may use a record and for what. `verify` reports any record whose schema, digest, or history fails.

## Not in this version

- The commit SHA in comment results. Evidence pins the prototype and Build number, which Hub keeps unique per prototype. Naming the commit needs one more field in the canvas comment API.
- Experience scenarios, a capture proxy, trainers, serving, and environments. The ADR describes how they attach to these contracts.
