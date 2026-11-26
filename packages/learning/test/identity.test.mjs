import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { collectionLog, weekOneLog } from "../conformance/fixtures.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { createJsonLinesMemoryProvider } from "../src/providers/json-lines.mjs"
import { createSqliteMemoryProvider } from "../src/providers/sqlite.mjs"
import { createLearningStore } from "../src/store.mjs"
import { readHubReviewCollection } from "../src/sources/hub-review-comments.mjs"
import { createMemoryProvider } from "./fixtures/json-file-provider.mjs"

const work = mkdtempSync(path.join(tmpdir(), "replica-learning-identities-"))
const opened = []
after(async () => {
  for (const store of opened) await store.close()
  rmSync(work, { recursive: true, force: true })
})
const NOW = Date.parse("2026-10-14T12:00:00Z")
const WINDOW = { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-10T00:00:00.000000Z" }
const SCOPE = { host: "github.com", repository: "acme/checkout-prototypes" }

function snapshot({ number = 1, authors, onlyFirst = false, onlySecond = false, ...overrides }) {
  const roots = weekOneLog()
    .calls.filter((call) => call.action === "list_repository_comments")
    .flatMap((call) => call.result.threads)
    .filter((root) => [101, 103].includes(root.id))
  const threads = roots.slice(onlySecond ? 1 : 0, onlyFirst ? 1 : 2).map((root, index) => ({
    root: { ...root, author: { ...authors[index] } },
    replies: [],
  }))
  return collectionLog({
    snapshotId: `11111111-2222-4333-8444-${String(number).padStart(12, "0")}`,
    capturedAt: `2026-10-${String(number + 5).padStart(2, "0")}T18:00:00.000000Z`,
    threads,
    ...overrides,
  })
}

async function label(store, context) {
  await store.annotate(
    { ...context, principal: { kind: "agent", id: "agent:labeler" } },
    [101, 103].map((commentId) => ({
      target: { commentId },
      theme: { key: "visible-labels", statement: "Keep form labels visible." },
      signal: "accessibility",
      observation: "observed",
      stance: "supports",
    })),
  )
}

for (const [name, factory] of [
  ["in-memory", () => createInMemoryProvider()],
  ["SQLite", (directory) => createSqliteMemoryProvider({ directory })],
  ["JSON Lines", (directory) => createJsonLinesMemoryProvider({ directory })],
  ["independent single-file", (dataDirectory) => createMemoryProvider({ dataDirectory })],
]) {
  describe(`${name}: stable reviewer identities`, () => {
    async function setup(scope = SCOPE) {
      const provider = factory(mkdtempSync(path.join(work, "store-")))
      const store = await createLearningStore({ provider, clock: () => NOW })
      opened.push(store)
      const context = { scope, principal: { kind: "human", id: "github:administrator" } }
      const grant = await store.addGrant(context, {
        purposes: ["review", "instruction", "evaluation", "analytics", "training", "publication"],
        sources: ["hub_review_comments"],
        basis: "Synthetic identity test consent.",
      })
      return { store, provider, context, grant }
    }

    it("counts one GitHub user once after a rename between imports", async () => {
      const { store, context, grant } = await setup()
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "old-name", githubId: 41 }],
          onlyFirst: true,
        }),
        { grantIds: [grant.id] },
      )
      await store.importHubReviewComments(
        context,
        snapshot({
          number: 2,
          authors: [
            { login: "new-name", githubId: 41 },
            { login: "new-name", githubId: 41 },
          ],
        }),
        { grantIds: [grant.id] },
      )
      await label(store, context)
      const observations = await store.queryObservations(context, { purpose: "instruction" })
      const comments = observations.events.filter((event) => event.type === "human_comment")
      assert.equal(new Set(comments.map((event) => event.actor.id)).size, 1)
      assert.deepEqual(
        comments.map((event) => event.actor.login),
        ["old-name", "new-name"],
      )
      assert.equal(comments[0].actor.id, "github-user:github.com/41")
      const run = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator({ minReviewers: 2 }),
        window: WINDOW,
      })
      assert.deepEqual(run.proposals, [])
      assert.equal(
        run.diagnostics.find((item) => item.code === "below_threshold").support.distinctReviewers,
        1,
      )
      assert.equal((await store.verify(context)).ok, true)
    })

    it("keeps actual users distinct even when a login is reused", async () => {
      const { store, context, grant } = await setup()
      const log = snapshot({
        authors: [
          { login: "reused-name", githubId: 41 },
          { login: "reused-name", githubId: 42 },
        ],
      })
      await store.importHubReviewComments(context, log, { grantIds: [grant.id] })
      await label(store, context)
      const run = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      assert.equal(run.proposals.length, 1)
      assert.equal(run.proposals[0].support.distinctReviewers, 2)
      assert.deepEqual(
        new Set(run.proposals[0].evidence.map((ref) => ref.author.id)),
        new Set(["github-user:github.com/41", "github-user:github.com/42"]),
      )
      const accepted = await store.acceptMemory(context, run.proposals[0].id, {
        expectedDigest: run.proposals[0].reviewDigest,
      })
      const renamed = await store.importHubReviewComments(
        context,
        snapshot({
          number: 2,
          authors: [
            { login: "renamed-one", githubId: 41 },
            { login: "renamed-two", githubId: 42 },
          ],
        }),
        { grantIds: [grant.id] },
      )
      assert.deepEqual(renamed.identityUpdates.memoryIds, [])
      assert.deepEqual(
        (await store.recall(context)).memories.map((memory) => memory.id),
        [accepted.id],
      )
      const changed = snapshot({
        number: 3,
        authors: [
          { login: "reused-name", githubId: 99 },
          { login: "reused-name", githubId: 42 },
        ],
      })
      await assert.rejects(
        store.importHubReviewComments(context, changed, { grantIds: [grant.id] }),
        { code: "conflict", message: /different stable author/ },
      )
    })

    it("invalidates old support and approvals without rewriting historical records", async () => {
      const { store, provider, context, grant } = await setup()
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "old-name" }, { login: "new-name" }],
        }),
        { grantIds: [grant.id] },
      )
      await label(store, context)
      const run = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator({ minReviewers: 2 }),
        window: WINDOW,
      })
      const pending = run.proposals[0]
      assert.equal(pending.support.distinctReviewers, 2)
      const approvedProposal = await store.proposeMemory(context, {
        schemaVersion: "replica.memory-proposal/v1",
        themeKey: "approved-rule",
        kind: "rule",
        content: "Keep labels visible.",
        evidence: pending.evidence,
        rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
        lifecycle: { action: "new" },
        consolidator: { id: "manual", version: "1" },
      })
      const accepted = await store.acceptMemory(context, approvedProposal.id, {
        expectedDigest: approvedProposal.reviewDigest,
      })
      const before = await provider.readRecords("events", { scope: context.scope })
      const history = await provider.readMemoryVersions({ scope: context.scope })
      const log = snapshot({
        number: 2,
        authors: [
          { login: "new-name", githubId: 41 },
          { login: "new-name", githubId: 41 },
        ],
      })
      const upgraded = await store.importHubReviewComments(context, log, { grantIds: [grant.id] })
      assert.deepEqual(upgraded.identityUpdates.memoryIds.sort(), [pending.id, accepted.id].sort())
      assert.equal(upgraded.identityUpdates.eventIds.length, 2)
      for (const original of before)
        assert.deepEqual(
          (
            await provider.readRecords("events", {
              scope: context.scope,
              ids: [original.id],
            })
          )[0],
          original,
        )
      assert.deepEqual(await provider.readMemoryVersions({ scope: context.scope }), history)
      await assert.rejects(
        store.acceptMemory(context, pending.id, {
          expectedDigest: pending.reviewDigest,
        }),
        { code: "identity_revalidation_required" },
      )
      assert.equal((await store.getMemory(context, accepted.id)).status.needsRebuild, true)
      assert.equal((await store.getMemory(context, pending.id)).status.identityNeedsReview, true)
      assert.ok(
        (await store.status(context)).attention.some((message) =>
          message.includes("needs identity review"),
        ),
      )
      assert.deepEqual((await store.recall(context)).memories, [])
      for (const purpose of ["instruction", "evaluation", "analytics", "training", "publication"]) {
        const copy = await store.exportRecords(context, { purpose, destination: `${purpose}.json` })
        assert.deepEqual(copy.bundle.memories, [])
      }
      const stored = await provider.readRecords("events", { scope: context.scope })
      assert.equal(
        stored.filter((event) => event.payload?.reason === "identity_corrected").length,
        2,
      )
      const again = await store.importHubReviewComments(context, log, { grantIds: [grant.id] })
      assert.equal(again.addedEvents, 0)
      await label(store, context)
      const rebuilt = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator({ minReviewers: 2 }),
        window: WINDOW,
      })
      assert.deepEqual(rebuilt.proposals, [])
      assert.equal((await store.verify(context)).ok, true)
    })

    it("withholds unresolved legacy evidence after adoption, including selective reads and dissent", async () => {
      const { store, context, grant } = await setup()
      const legacy = snapshot({ authors: [{ login: "123" }, { login: "legacy-name" }] })
      await store.importHubReviewComments(context, legacy, { grantIds: [grant.id] })
      const original = await store.queryObservations(context, { purpose: "instruction" })
      const comments = original.events.filter((event) => event.type === "human_comment")
      const pending = await store.proposeMemory(context, {
        schemaVersion: "replica.memory-proposal/v1",
        kind: "rule",
        content: "Keep labels visible.",
        evidence: [{ episodeId: comments[0].episodeId, eventIds: [comments[0].id] }],
        contradictions: [{ episodeId: comments[1].episodeId, eventIds: [comments[1].id] }],
        rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
        lifecycle: { action: "new" },
        consolidator: { id: "manual", version: "1" },
      })
      await store.importHubReviewComments(
        context,
        snapshot({
          number: 2,
          authors: [{ login: "123", githubId: 123 }, { login: "legacy-name" }],
        }),
        { grantIds: [grant.id] },
      )
      await assert.rejects(
        store.acceptMemory(context, pending.id, {
          expectedDigest: pending.reviewDigest,
        }),
        { code: "identity_revalidation_required" },
      )
      assert.deepEqual(
        await store.queryObservations(context, {
          purpose: "instruction",
          eventIds: [comments[1].id],
        }),
        { episodes: [], events: [] },
      )
      assert.equal(
        (
          await store.queryObservations(context, {
            purpose: "review",
            eventIds: [comments[1].id],
          })
        ).events.length,
        1,
      )
      await assert.rejects(
        store.importHubReviewComments(
          context,
          snapshot({
            number: 3,
            authors: [{ login: "123" }, { login: "legacy-name" }],
          }),
          { grantIds: [grant.id] },
        ),
        { code: "conflict", message: /cannot downgrade/ },
      )
      const usable = await store.queryObservations(context, { purpose: "instruction" })
      assert.ok(
        usable.events
          .filter((event) => event.type === "human_comment")
          .every((event) => event.actor.id === "github-user:github.com/123"),
      )
    })

    it("keeps redacted legacy text absent during identity correction", async () => {
      const { store, provider, context, grant } = await setup()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "old-name" }, { login: "other-name" }],
        }),
        { grantIds: [grant.id] },
      )
      await store.redactHubComment(context, 101)
      await store.importHubReviewComments(
        context,
        snapshot({
          number: 2,
          authors: [
            { login: "new-name", githubId: 41 },
            { login: "other-name", githubId: 42 },
          ],
        }),
        { grantIds: [grant.id] },
      )
      const events = await provider.readRecords("events", { scope: context.scope })
      assert.ok(
        events
          .filter(
            (event) =>
              event.type === "human_comment" &&
              (event.payload?.commentId === 101 || event.redaction?.commentId === 101),
          )
          .every((event) => event.payload === undefined),
      )
      assert.equal((await store.verify(context)).ok, true)
      await assert.rejects(
        store.importHubReviewComments(
          context,
          snapshot({
            number: 3,
            authors: [
              { login: "another-user", githubId: 99 },
              { login: "other-name", githubId: 42 },
            ],
          }),
          { grantIds: [grant.id] },
        ),
        { code: "conflict", message: /different stable author/ },
      )
    })

    it("keeps GitHub hosts and local Hub origins in separate identity namespaces", async () => {
      const github = await setup()
      const enterprise = await setup({ ...SCOPE, host: "github.example.com" })
      const log = snapshot({
        authors: [
          { login: "same", githubId: 1 },
          { login: "same", githubId: 1 },
        ],
      })
      for (const target of [github, enterprise])
        await target.store.importHubReviewComments(target.context, log, {
          grantIds: [target.grant.id],
        })
      async function actor(target) {
        return (
          await target.store.queryObservations(target.context, { purpose: "instruction" })
        ).events.find((event) => event.type === "human_comment").actor.id
      }
      assert.notEqual(await actor(github), await actor(enterprise))
      const local = await setup({ host: "local", repository: "repositories/42" })
      const first = snapshot({
        authors: [
          { login: "same", localId: 1 },
          { login: "same", localId: 1 },
        ],
        repository: "repositories/42",
      })
      await local.store.importHubReviewComments(local.context, first, {
        grantIds: [local.grant.id],
      })
      const second = snapshot({
        number: 2,
        authors: [
          { login: "same", localId: 1 },
          { login: "same", localId: 1 },
        ],
        repository: "repositories/42",
      })
      for (const call of second.calls)
        call.result.target = { ...call.result.target, hubOrigin: "https://other-hub.example.com" }
      await local.store.importHubReviewComments(local.context, second, {
        grantIds: [local.grant.id],
      })
      const localActors = new Set(
        (await local.store.queryObservations(local.context, { purpose: "instruction" })).events
          .filter((event) => event.type === "human_comment")
          .map((event) => event.actor.id),
      )
      assert.equal(localActors.size, 2)
    })

    it("never restores an instruction purpose withdrawn before identity migration", async () => {
      const { store, context, grant } = await setup()
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "one" }, { login: "two" }],
        }),
        { grantIds: [grant.id] },
      )
      await store.withdrawGrant(context, grant.id, { purposes: ["instruction"] })
      await store.importHubReviewComments(
        context,
        snapshot({
          number: 2,
          authors: [
            { login: "one", githubId: 1 },
            { login: "two", githubId: 2 },
          ],
        }),
        { grantIds: [grant.id] },
      )
      assert.deepEqual(
        (await store.queryObservations(context, { purpose: "instruction" })).events,
        [],
      )
      assert.ok((await store.queryObservations(context, { purpose: "review" })).events.length > 0)
      assert.deepEqual((await store.recall(context)).memories, [])
    })

    it("supports real local user IDs without fabricating GitHub identities", async () => {
      const scope = { host: "local", repository: "repositories/42" }
      const { store, context, grant } = await setup(scope)
      const log = snapshot({
        authors: [
          { login: "local-one", localId: 1 },
          { login: "local-one", localId: 1 },
        ],
        repository: "repositories/42",
      })
      await store.importHubReviewComments(context, log, { grantIds: [grant.id] })
      await label(store, context)
      const observations = await store.queryObservations(context, { purpose: "instruction" })
      assert.ok(
        observations.events
          .filter((event) => event.type === "human_comment")
          .every((event) => event.actor.id === "hub-user:https://replica.example.com/1"),
      )
      const run = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator({ minReviewers: 1 }),
        window: WINDOW,
      })
      assert.equal(run.proposals.length, 1)
      assert.equal(run.proposals[0].support.distinctReviewers, 1)
      await assert.rejects(
        store.importHubReviewComments(
          context,
          snapshot({
            number: 2,
            authors: [
              { login: "fake", githubId: 1 },
              { login: "local-one", localId: 1 },
            ],
            repository: "repositories/42",
          }),
          { grantIds: [grant.id] },
        ),
        { code: "invalid_input" },
      )
    })

    it("preserves immutable reply and resolver identities with display logins", async () => {
      const { store, context, grant } = await setup()
      const log = weekOneLog({ snapshotId: "22222222-2222-4333-8444-000000000001" })
      for (const call of log.calls) {
        const messages = call.result.threads ?? (call.result.thread ? [call.result.thread] : [])
        for (const root of messages) {
          root.author.githubId = 41
          for (const reply of root.replies) reply.author.githubId = 42
          if (root.resolvedBy) root.resolvedBy.githubId = 43
        }
      }
      await store.importHubReviewComments(context, log, { grantIds: [grant.id] })
      const { events } = await store.queryObservations(context, { purpose: "instruction" })
      assert.equal(
        events.find((event) => event.type === "human_comment" && event.payload.role === "reply")
          .actor.id,
        "github-user:github.com/42",
      )
      const resolution = events.find((event) => event.type === "status_change")
      assert.equal(resolution.actor.id, "github-user:github.com/43")
      assert.equal(resolution.payload.by.id, resolution.actor.id)
      assert.equal(resolution.actor.login, "ben-manager")
      const invalid = snapshot({
        authors: [
          { login: "one", githubId: 1 },
          { login: "two", githubId: 2 },
        ],
      })
      invalid.calls[1].result.threads[0].resolvedBy = { login: "resolver", githubId: "43" }
      assert.throws(
        () => readHubReviewCollection(invalid, { repository: context.scope.repository }),
        { code: "invalid_input" },
      )
    })

    it("adopts a restrictive identity policy from a partial granted snapshot without widening coverage", async () => {
      const { store, provider, context, grant } = await setup()
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "old-name" }, { login: "new-name" }],
        }),
        { grantIds: [grant.id] },
      )
      await label(store, context)
      const initial = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      const pending = initial.proposals[0]
      const accepted = await store.acceptMemory(context, pending.id, {
        expectedDigest: pending.reviewDigest,
      })
      const stale = await store.proposeMemory(context, {
        schemaVersion: "replica.memory-proposal/v1",
        kind: "rule",
        content: "Another pending rule based on legacy identities.",
        evidence: pending.evidence,
        rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
        lifecycle: { action: "new" },
        consolidator: { id: "manual", version: "1" },
      })
      const before = await provider.readRecords("events", { scope: context.scope })
      const partial = snapshot({
        number: 2,
        onlySecond: true,
        authors: [{ login: "new-name", githubId: 41 }],
        filters: { read: "unread" },
      })
      partial.calls[1].result.hasMore = true
      partial.calls[1].result.nextCursor = `${partial.calls[1].result.snapshotId}:list:1`
      const imported = await store.importHubReviewComments(context, partial, {
        grantIds: [grant.id],
      })
      assert.equal(imported.complete, false)
      assert.equal(imported.collection.complete, false)
      assert.equal(imported.collection.filters.read, "unread")
      assert.equal(imported.collection.reviewerIdentity, "stable-user-id")
      assert.ok(imported.identityUpdates.memoryIds.includes(accepted.id))
      assert.equal((await store.getMemory(context, accepted.id)).status.identityNeedsReview, true)
      assert.deepEqual((await store.recall(context)).memories, [])
      await assert.rejects(
        store.acceptMemory(context, stale.id, { expectedDigest: stale.reviewDigest }),
        { code: "identity_revalidation_required" },
      )
      for (const event of before)
        assert.deepEqual(
          (
            await provider.readRecords("events", {
              scope: context.scope,
              ids: [event.id],
            })
          )[0],
          event,
        )
      const usable = await store.queryObservations(context, { purpose: "instruction" })
      const comments = usable.events.filter((event) => event.type === "human_comment")
      assert.equal(comments.length, 1)
      assert.equal(comments[0].payload.commentId, 103)
      assert.equal(comments[0].actor.id, "github-user:github.com/41")
      assert.equal(comments[0].at, before.find((event) => event.payload?.commentId === 103).at)
      assert.equal(
        (
          await store.queryObservations(context, {
            purpose: "instruction",
            since: "2026-10-07T00:00:00.000000Z",
          })
        ).events.filter((event) => event.type === "human_comment").length,
        0,
      )
      await label(store, context)
      const rebuilt = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      assert.deepEqual(rebuilt.proposals, [])
      assert.equal(rebuilt.status, "incomplete")
      assert.equal((await store.verify(context)).ok, true)
    })

    it("adopts an explicitly declared empty partial capture without fabricating evidence", async () => {
      const { store, provider, context, grant } = await setup()
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "old-name" }, { login: "new-name" }],
        }),
        { grantIds: [grant.id] },
      )
      await label(store, context)
      const {
        proposals: [pending],
      } = await store.consolidate(context, {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      const accepted = await store.acceptMemory(context, pending.id, {
        expectedDigest: pending.reviewDigest,
      })
      const before = await provider.readRecords("events", { scope: context.scope })
      const empty = snapshot({
        number: 2,
        authors: [{ login: "unused" }],
        onlyFirst: true,
        filters: { read: "unread" },
      })
      empty.reviewerIdentity = "stable-user-id"
      empty.calls[1].result.threads = []
      empty.calls[1].result.hasMore = true
      empty.calls[1].result.nextCursor = `${empty.calls[1].result.snapshotId}:list:0`
      const imported = await store.importHubReviewComments(context, empty, { grantIds: [grant.id] })
      assert.equal(imported.complete, false)
      assert.equal(imported.collection.counts.messages, 0)
      assert.equal(imported.collection.filters.read, "unread")
      assert.equal(imported.collection.reviewerIdentity, "stable-user-id")
      assert.deepEqual(imported.identityUpdates.eventIds, [])
      assert.deepEqual(imported.identityUpdates.memoryIds, [accepted.id])
      assert.deepEqual(await provider.readRecords("events", { scope: context.scope }), before)
      assert.equal((await store.getMemory(context, accepted.id)).status.identityNeedsReview, true)
      assert.deepEqual((await store.recall(context)).memories, [])
      const current = await store.queryObservations(context, { purpose: "instruction" })
      assert.deepEqual(current.events, [])
      assert.equal((await store.verify(context)).ok, true)
    })

    it("does not adopt identity policy from malformed or unauthorized captures", async () => {
      const { store, provider, context, grant } = await setup()
      await store.importHubReviewComments(
        context,
        snapshot({
          authors: [{ login: "old-name" }, { login: "new-name" }],
        }),
        { grantIds: [grant.id] },
      )
      const capture = snapshot({
        number: 2,
        authors: [
          { login: "same", githubId: 1 },
          { login: "same", githubId: 1 },
        ],
      })
      async function stored() {
        return Promise.all(
          ["events", "collections", "audit"].map((stream) =>
            provider.readRecords(stream, { scope: context.scope }),
          ),
        )
      }
      const before = await stored()
      for (const reviewerIdentity of [null, false, "legacy", 1]) {
        await assert.rejects(
          store.importHubReviewComments(
            context,
            {
              ...capture,
              reviewerIdentity,
            },
            { grantIds: [grant.id] },
          ),
          { code: "invalid_input" },
        )
        assert.deepEqual(await stored(), before)
      }
      await store.withdrawGrant(context, grant.id, { purposes: ["review"] })
      const withdrawn = await stored()
      await assert.rejects(
        store.importHubReviewComments(
          context,
          {
            ...capture,
            reviewerIdentity: "stable-user-id",
          },
          { grantIds: [grant.id] },
        ),
        { code: "grant_inactive" },
      )
      assert.deepEqual(await stored(), withdrawn)
      assert.ok(
        (await store.queryObservations(context, { purpose: "instruction" })).events.some(
          (event) => event.type === "human_comment",
        ),
      )
    })

    it("allows filtered first adoption and validates supplied IDs without fallback", async () => {
      const { store, context, grant } = await setup()
      for (const identity of [
        { githubId: null },
        { githubId: "41" },
        { githubId: 0 },
        { githubId: 1.5 },
        { githubId: 2 ** 53 },
        { githubId: 41, localId: 1 },
        { localId: null },
        { localId: "1" },
        { local: true },
      ]) {
        const log = snapshot({
          authors: [{ login: "valid-name", ...identity }, { login: "other" }],
        })

        assert.throws(
          () => readHubReviewCollection(log, { repository: context.scope.repository }),
          { code: "invalid_input" },
        )
      }
      const filtered = snapshot({
        authors: [
          { login: "one", githubId: 1 },
          { login: "two", githubId: 2 },
        ],
        filters: { read: "unread" },
      })
      const adoption = await store.importHubReviewComments(context, filtered, {
        grantIds: [grant.id],
      })
      assert.equal(adoption.collection.reviewerIdentity, "stable-user-id")
      assert.equal(adoption.collection.filters.read, "unread")
      const missingHost = { ...context, scope: { repository: context.scope.repository } }
      const hostlessGrant = await store.addGrant(missingHost, {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "Fixture.",
      })
      await assert.rejects(
        store.importHubReviewComments(
          missingHost,
          snapshot({
            authors: [
              { login: "one", githubId: 1 },
              { login: "two", githubId: 2 },
            ],
          }),
          { grantIds: [hostlessGrant.id] },
        ),
        { code: "invalid_input", message: /explicit GitHub host/ },
      )
    })
  })
}
