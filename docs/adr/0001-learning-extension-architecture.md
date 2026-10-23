# ADR 0001: Learning extension architecture

Status: proposed on October 6, 2026, and revised on October 10, 2026 to follow the requirements the Replica maintainers agreed on. Needs review by the Replica maintainers.

The learning package, providers, CLI, and demos still work. Hub descriptions below record an earlier proposal, not what the [new Hub](../../hub/README.md) can do today. It does not collect comments, run learning jobs, store learning data, sign people in, or connect Copilot. Adding those features requires separate product and architecture decisions.

## Context

Replica should get better from the judgment people give it, and teams adopting the open-source release must be able to replace each part. The plan has three stages: explicit memory first, then experiences beyond screens, then optional model training. This decision covers the first stage: canonical learning contracts, a default SQLite memory provider, and a loop in which Hub suggests learnings from review comments and people decide which ones agents get, with no model training.

Before any code, we checked the repository at `7652d73`:

1. No learning-loop code exists. Pull request #230, open at the time and merged since, adds a discovery-only `/review-hub-feedback` skill. It keeps evidence and learnings in private session artifacts and leaves diagnosis, guidance changes, and optimization to "a separate, future workflow".
2. The repository has no shared record format, digest rule, or canonical JSON for learning data, so other languages have nothing to implement against.
3. Hub's `ArtifactStore.current` picks a `Local` or `Azure` adapter from configuration. `packages/controls` keeps a JSON Schema, generates a standalone validator, and checks in CI that it is current. Starter has no provider registry.
4. Contracts can live beside their generator in a package, as they do in `packages/controls`.
5. Comment results carry the Build number but not the commit SHA. Hub stores a 40-character `commit_sha` per Build, unique per prototype, and every root comment has a `build_id`. The prototype ID and Build number therefore identify one Build exactly.
6. Nothing implements or tracks the persistent, reviewed learning step.
7. Starter's `.gitignore` already ignores `.replica/`, and prototype repositories receive only tracked starter files.
8. No identity can read Hub comments on a schedule. Canvas access comes from interactive pairing for one user and one repository. Access tokens last 7 days, and a renewable connection lapses after 30 days without activity.
9. Hub records seven analytics events for 90 days: `prototype_registered`, `prototype_first_published`, `build_published`, `review_comment_created`, `review_reply_added`, `review_thread_resolved`, and `review_thread_reopened`. They carry IDs, not content.
10. Anything in `dist` can become public through a share link, which gives anyone with its URL access to one Build until it expires.
11. Starter can use a provider registry without a new runtime dependency, because the reference code needs only Node built-ins.
12. The smallest proof of provider swapping is one conformance suite run unchanged against two independent providers.

## Accepted requirements

The Replica maintainers agreed on these on October 9, 2026:

- SQLite is the default store, and a team can replace the store, the labeler, and the consolidator.
- Consolidation runs as a background job in Hub, without anyone copying prompts or comments between sessions.
- Learnings is optional. It works only after a Hub administrator connects Copilot, and it uses that connection.
- People decide. Administrators accept, edit, or reject each suggested learning.
- Agents get accepted learnings without extra steps.
- Copilot usage is visible, and decisions are recorded in Hub's security audit.

## Decision

We add `packages/learning`, a private package like `packages/controls`. The sections below are proposed implementation choices that meet those requirements.

### Contracts

The public contract is JSON Schema 2020-12 in `packages/learning/contracts/v1`, with a valid example of each record, invalid records that state why they fail, and shared canonical JSON vectors. Every record names its schema version, and a stored v1 record is never read as another version. Digests are SHA-256 over RFC 8785 canonical JSON, and input that repeats a member name is refused, as I-JSON requires. Times are UTC with six fractional digits, so text order is time order. Ajv generates standalone validators at development time, and CI checks they are current, so runtime needs no dependency.

A top-level `contracts/` directory was the other option. We keep the contracts in the package to follow the `packages/controls` pattern; Hub and other languages can read the same files from the repository.

### Replica owns the rules, providers own storage

Operations such as `acceptMemory`, `withdrawGrant`, and `export` could have been memory provider operations. In this design, they belong to the learning store, which Replica owns. A provider implements seven storage methods: it appends records to one stream or to several in one write, returns them in order and filtered by scope, and appends memory versions with compare-and-swap. Each append also stores the audit entries that record the change in the same atomic write, so a crash or an error never leaves a stored change without its audit entry. The store applies scope, consent, purpose, lifecycle, and approval rules before writing, and re-checks everything a provider returns.

We chose this split so that consent and purpose rules exist in one place. If every adapter enforced them itself, one adapter bug could send review-only evidence to a trainer. The store fails closed: if any grant, withdrawal, episode, event, or collection it reads fails its schema, digest, or scope check, it refuses to run, because silently dropping a damaged withdrawal or retraction would restore a permission. A damaged learning is never used. These checks catch altered records. They cannot catch a provider that omits or replays whole records, so a provider is trusted with completeness.

A provider declares a manifest with its contract versions, capabilities, storage kind, and the hosts it sends data to. The store refuses a provider without the seven required capabilities. Optional capabilities, such as semantic, graph, or temporal search, leave room for Graphiti, Mem0, or a Hub provider without changing the contract.

A SQLite provider on the driver built into Node.js 24 is the default. A JSON Lines provider, whose files a person can read, is the reference, and an in-memory provider serves tests. A fourth provider in the tests is written only from the contract, with no imports from the package. All four pass the same conformance suite, which ships as `@github/replica-learning/conformance` and includes adversarial cases: damaged withdrawals, forged approvals, forged evidence pins, and racing replacements.

### Consolidation is separate from memory

A consolidator, sometimes called a dreamer, reads evidence and proposes learnings. It is not a store. It receives a frozen view of the evidence the purpose may use. The view shows a memory's content, evidence, and counterevidence only while that evidence permits the purpose, so a consolidator cannot reuse withdrawn knowledge. The store gives it no write access and saves everything it returns as proposed. A consolidator is code a team chooses to run; the frozen view is not a sandbox.

The reference consolidator is deterministic: it proposes labeled themes with observed problems in at least two threads, two prototypes, and two reviewers, and holds back contested themes. When an accepted learning for a theme has stopped applying, a new proposal offers to replace it. A model-based consolidator, such as SkillOpt-Sleep or #230's discovery passes, can plug in behind the same interface. A consolidator module receives the built-in consolidators along with its options, so it can build on them without importing the package.

`packages/learning/examples/agent-memory-repo` shows the pattern with [Agent Memory Repo](https://github.com/AgentMemoryRepo/agentmemoryrepo), an open format whose Dreaming agent adds patterns and cleans up duplicates, outdated entries, and contradictions. Its Dreaming consolidator proposes merges, and reports learnings that look alike but conflict, or that are outdated or contested, for a person to act on, because Replica keeps the rule that only a person decides. Records stay append-only; recall stops using what a person merged away or retired. Its publisher copies accepted learnings into a memory repo other agents read. The memory repo is a publishing target, not a record store, since its Markdown entries have no versions, digests, or consent records.

### Evidence

Each Hub review thread becomes an episode pinned to its Hub, repository, prototype, branch, and the Build the reviewer saw. Comments, labels, status changes, and retractions are append-only events. An edit adds a version that supersedes the old one. A deletion adds a retraction that removes the earlier versions, and labels on them, from every purpose. Events carry a separate `payloadDigest`, and an event's digest leaves out its payload and any redaction note, so a provider can remove a payload later, record why, and keep the digest intact. A redacted event is never evidence. Labels and retractions name their target in `parentEventId`, which the digest covers and validation matches to the payload, so a redaction never loses what a label judged or a retraction removed. Reviewer names and avatars are dropped, and only Hub's compact target fields are kept.

Removing a comment uses that rule. A provider with the optional `observation.redact` capability implements one more method, `redactRecord`, which replaces a stored event with a copy that has the same ID and digest, no payload, and a redaction note, and refuses anything else. The store's `redactComment` asks for a person and a reason, redacts every version of the comment and every label on them, audits it, and reports the accepted learnings that need rebuilding and the exports that copied the comment or a learning citing it. It finds versions by edit links inside the thread and by Hub comment ID, and refuses a history that links two comments or leaves the thread, because guessing could remove someone else's words. Each redaction note keeps the version's Hub comment ID, which the digest does not cover, so the other versions can still be found after the text is gone. Because the store relies on it, a provider refuses a note whose comment ID differs from the payload it removes, and a note on any other event that names one. Each removal gets one audit entry whose ID and content come from the event's stored note, so a retry or a racing call writes the same entry and the provider keeps one. The follow-ups depend only on what cites the comment, so running it again after a failure finishes the removal and reports them again. Re-importing an old snapshot cannot restore the text, because the importer skips events the store holds. A host that erases deleted comments can ask an import to remove the text of every comment its snapshot shows as deleted, recorded as the importer's action, and the next such import finishes a removal that failed part way. A host can also remove one comment by its Hub comment ID, which imports nothing and so needs no active grant. A host must not redact while an import or labeling of the same store is in progress. A redaction reads the comment's events before it removes their text, so text stored in between stays. For a comment deleted at its source, later imports must ask to remove deleted text, which removes what stayed. Hub meets both: its runs and its deletion job take turns through one job queue key, and its imports always ask to remove deleted text. We chose a payload-free copy over deletion so that every digest, approval, and audit entry that names the event still verifies.

Scope is the repository's host and owner/name, taken from the checkout's origin remote, and episode IDs include it. A host that keeps stores outside checkouts, such as Hub, names the repository instead, after checking the person's access itself. The same owner/name on two hosts therefore never shares records, even in one provider. Hub names each repository by its stable GitHub ID, so renaming or transferring the repository keeps its learnings. Hub logs name only owner/name, so the importer checks the repository and relies on the checkout for the host.

An evidence reference must resolve to stored events inside the episode it names. The store rebuilds its source pin, time, and author from storage and refuses a proposal that states different ones, so a proposer cannot move evidence to another prototype or Build.

Reviewer identity follows immutable GitHub user IDs, with logins kept only for display; local-development users have separate Hub-origin-bound IDs. Adopting those IDs is append-only and makes obsolete legacy evidence unavailable for acceptance and use until rebuilt and reviewed. The [learning guide](../../packages/learning/README.md#reviewer-identity) defines the snapshot fields, migration safeguards, legacy limits, and recovery output.

### Consent and purposes

Purposes are review, instruction, evaluation, analytics, training, and publication. Whether a piece of evidence may serve a purpose is decided at read time: some active grant in its scope must permit the purpose, name its source, and cover the time that piece of evidence was written. A reply written after a grant's range ends is not covered, even when its thread started inside the range. A label counts only while the comment it judges does, and its time is that comment's time. Episodes also record the grants they were collected under, for provenance.

Deciding at read time lets a later grant cover earlier evidence when a team says so in the grant's range. Withdrawing a purpose takes effect at once, stops recall of learnings built on that evidence, and lists earlier exports that copied it. A learning depends on its counterevidence as well as its evidence, because the reviewer decided with both in view, so losing either one stops recall. Reading history applies the same test to each version. Export refuses a purpose no grant permits and records every exported ID and digest. An export can hold learnings alone, without episodes or comments. Every export records the grants that permitted what it copied, each judged by when its evidence was written, so a withdrawal finds exactly the exports its grant allowed.

### Approval

A learning has two digests. `contentDigest` identifies the learning itself: its scope, kind, content, targets, lifecycle, evidence, and validity dates. `reviewDigest` covers everything a reviewer is shown, adding its support, dissent, confidence, rationale, and proposer. Accepting or rejecting requires the `reviewDigest` the person reviewed, so new support or dissent makes an older review stale and the proposal gets a new version. An edit binds the approval to the new content's `contentDigest`.

The contracts require a human on every grant, withdrawal, approval, rejection, retirement, and export. The store also checks each learning's history: it must start as a proposal, each decision must name the version it reviewed, and each step may change only its own fields. Accepting may change the text and nothing else, records `edited` exactly when it does, and replaces only what the reviewed lifecycle names. Only accepted learnings carry `supersedes`, so a proposal cannot smuggle in a replacement its `reviewDigest` does not show. A sealed record that breaks these rules is never used, and reading one shows only strictly checked identifiers and digests, never content, for the current version and every past one. The local command cannot authenticate people, so it records those identities as asserted.

### Supersession

A provider offers compare-and-swap on one record at a time, so a replacement is recorded in one place: the accepted replacement lists what it replaces in `supersedes`. The replaced learnings keep their own state, and readers derive that they are superseded. A learning records what it replaces once, when it is accepted or in one later step if it was accepted without replacing anything; to replace more, a team proposes a merge. A claim that has taken effect therefore never depends on a later operation. The store refuses to replace a learning another replacement already claimed. Racing replacements can still both be written, so readers settle them the same way every time: in the order they were made, a replacement takes effect only if none of the learnings it names was already claimed, and then it takes all of them. A replacement that loses replaces nothing and is marked conflicted. If it came with the acceptance, the learning is not used; if it extended a learning already in use, that learning stays as it was. Two replacements are never both active, and a losing merge never removes a learning it did not win. Claims come only from the intact part of a learning's history, and a replacement that is later retired or damaged keeps them, so neither quietly restores the learning it replaced.

### Completeness

Each import records whether every list page and reply page was present. The importer requires every pagination flag and refuses contradictory ones, and it checks that each cursor continues exactly where the previous page ended. A consolidation window counts as complete only when complete, unfiltered collections cover it. Otherwise the result is incomplete and names the missing spans, so a partial scan never reads as "nothing found".

### Integration with Hub

The earlier proposal had Hub run `replica-learning` for every step, so the package's rules applied throughout. It kept one store per repository outside any checkout. A background job imported review comments, removed deleted text, labeled new or edited comments, and proposed learnings. Administrators reviewed proposals, and the plugin read accepted learnings. The [new Hub](../../hub/README.md) does not run these steps.

The package can label through the [Copilot SDK](https://github.com/github/copilot-sdk). Its session has no tools, refuses every permission request, and never sees who wrote a comment. Copilot chooses the model unless the store's configuration names one, and each run records the usage Copilot reports. The new Hub does not set up or authorize this connection.

The command still runs in a checkout, with data under `.replica/learning/`, for contributors and for other hosts. This complements #230: its discovery output can become labels, and its judge can become a consolidator.

### No model training in this version

Learning happens in explicit, inspectable memory. A training-purpose export is the only way evidence could reach a trainer, and it needs its own grant.

## Consequences

- The loop runs in Hub without anyone starting each step. Teams can swap the provider, labeler, or consolidator by configuration without changing core logic. In a checkout, every step except labeling with Copilot works offline.
- One damaged policy record blocks every learning operation until someone repairs it. That is deliberate; a store that keeps running on damaged consent records can restore permissions nobody granted.
- Providers, labelers, and consolidators are trusted code. The store limits what they are given and re-checks what they return, but it does not sandbox them.
- Inside a checkout, learning data and exports live only under `.replica/`, after following links, and only when Git ignores that exact path. The checkout root and names that merely start with two dots count as inside. Git ignoring a path is not enough, since a dev server or build may still serve it.
- The command asserts identities. Hub passes only people it authenticated with GitHub, and only for repositories they administer.
- The generated validator file is large, as in `packages/controls`.
- Hub keeps one SQLite file per repository. A team that needs a shared database server brings its own provider and runs the conformance suite against it.
- Hub's production image includes Node.js and the command, which adds about 260 MB.
- Copilot usage counts toward the token owner's plan, not necessarily the administrator who enabled the connection. The operator supplies a token intended to have only the Copilot requests permission; Hub keeps it in process configuration, not its database. The operator must verify its actual scope and manage expiry, rotation and revocation. Token replacement requires a full stop/start with no old/new process overlap, including learning and SDK children; rolling replacement is unsupported. Credential custody, subprocess isolation and deployed authentication still need security review.

## Alternatives considered

- Each provider enforces consent and approval itself. Rejected because safety would depend on every adapter.
- Validating with Ajv at runtime. Rejected to keep zero runtime dependencies.
- Atomic writes of several learnings in every provider, for supersession. Rejected because it would make every adapter harder to write; deriving the active learning from accepted records gives the same guarantee with single-record compare-and-swap.
- Dropping records that fail their checks and continuing. Rejected because dropping a damaged withdrawal or retraction silently restores a permission.
- A knowledge graph or vector store as the default. Rejected; the default should be simple and local, and graph or semantic search can arrive as provider capabilities.
- An agent collects comments through the canvas, and a starter skill runs each step. Replaced: a person had to start every step, and every comment passed through an agent session, which cost tokens and could introduce copying errors.
- Billing Copilot to the organization through the App's installation token. Deferred: it needs the App's Copilot requests permission and an installation on every repository in the organization.
- PostgreSQL or Neo4j providers in this version. Deferred: SQLite meets one Hub's needs, and the provider interface and conformance suite let a team add one later.
- Model-only consolidation. Kept as a plug-in option; the reference stays deterministic so tests and reviews are reproducible.

## Next steps

1. In Hub, add the Build's commit SHA to comment results.
2. Complete the security review of the operator-provided Copilot token and subprocess boundary, and verify the deployed connection with a least-privileged token.
3. Add scenario contracts, a scenario runner, and capture adapters. The event types for tool calls, voice turns, UI states, and agent-to-agent messages are already reserved.
4. Add an experience approval record and a read-only conformance checker for shipped work.
5. Add trainer, serving, and environment interfaces behind one promotion gate. Training data leaves only through a training-purpose export.
6. Decide distribution: publish the package, or keep shipping it inside Hub's image.
