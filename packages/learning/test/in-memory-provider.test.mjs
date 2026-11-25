import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { agent, designer, weekOneLabels, weekOneLog } from "../conformance/index.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { digestOf } from "../src/canonical-json.mjs"
import { LearningError } from "../src/errors.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { sealMemory } from "../src/records.mjs"
import { createLearningStore } from "../src/store.mjs"

describe("in-memory provider atomic writes", () => {
  it("reports an unknown outcome when a proposal commits but its response is lost", async () => {
    const provider = createInMemoryProvider()
    const store = await createLearningStore({
      provider: {
        ...provider,
        async appendMemoryVersion(version, options) {
          await provider.appendMemoryVersion(version, options)
          throw new LearningError("storage_outcome_unknown", "Response lost after commit.")
        },
      },
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })

    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    await assert.rejects(
      store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
      }),
      { code: "storage_outcome_unknown" },
    )
    assert.equal((await provider.readMemoryVersions({ scope: agent().scope })).length, 1)
  })

  it("stores a batch larger than the JavaScript argument limit with all its audit entries", async () => {
    const provider = createInMemoryProvider()
    const scope = { repository: "acme/prototypes" }
    const episode = { id: "ep_largebatch1", digest: "sha256:episode", scope }
    const events = Array.from({ length: 180_000 }, (_, index) => ({
      id: `ev_${String(index).padStart(8, "0")}`,
      digest: `sha256:${index}`,
      scope,
      episodeId: episode.id,
    }))
    const audit = [{ id: "audit_largebatch1", digest: "sha256:audit", scope }]
    assert.deepEqual(await provider.appendBatch({ episodes: [episode], events }, { audit }), {
      episodes: { appended: 1, existing: 0 },
      events: { appended: events.length, existing: 0 },
    })
    assert.deepEqual(await provider.readRecords("episodes", { scope }), [episode])
    assert.deepEqual(await provider.readRecords("events", { scope }), events)
    assert.deepEqual(await provider.readRecords("audit", { scope }), audit)
  })

  it("stores a memory version with an audit list larger than the JavaScript argument limit", async () => {
    const provider = createInMemoryProvider()
    const scope = { repository: "acme/prototypes" }
    const version = { id: "mem_largeaudit1", version: 1, digest: "sha256:memory", scope }
    const audit = Array.from({ length: 180_000 }, (_, index) => ({
      id: `audit_${String(index).padStart(8, "0")}`,
      digest: `sha256:${index}`,
      scope,
    }))
    await provider.appendMemoryVersion(version, { expectedPreviousDigest: null, audit })
    assert.deepEqual(await provider.readMemoryVersions({ scope }), [version])
    assert.deepEqual(await provider.readRecords("audit", { scope }), audit)
  })

  it("clones every stream and audit entry before storing any part of a write", async () => {
    const provider = createInMemoryProvider()
    const scope = { repository: "acme/prototypes" }
    const episode = { id: "ep_clonefailure1", digest: "sha256:episode", scope }
    const invalid = { id: "ev_clonefailure1", digest: "sha256:event", scope, callback: () => {} }
    const audit = { id: "audit_clonefailure1", digest: "sha256:audit", scope }
    await assert.rejects(
      provider.appendBatch({ episodes: [episode], events: [invalid] }, { audit: [audit] }),
      { name: "DataCloneError" },
    )
    for (const stream of ["episodes", "events", "audit"])
      assert.deepEqual(await provider.readRecords(stream, { scope }), [])
    const version = { id: "mem_clonefailure1", version: 1, digest: "sha256:memory", scope }
    await assert.rejects(
      provider.appendMemoryVersion(version, {
        expectedPreviousDigest: null,
        audit: [{ ...audit, callback: () => {} }],
      }),
      { name: "DataCloneError" },
    )
    assert.deepEqual(await provider.readMemoryVersions({ scope }), [])
    assert.deepEqual(await provider.readRecords("audit", { scope }), [])
  })
})

describe("learning decisions", () => {
  it("refuses an edit when the provider cannot fence eligibility", async () => {
    const provider = { ...createInMemoryProvider(), atomicDecisionFence: false }
    const store = await createLearningStore({ provider })
    await assert.rejects(
      store.editMemory(designer(), "mem_example", {
        expectedDigest: `sha256:${"0".repeat(64)}`,
        content: "Updated guidance",
        reason: "Clarify the guidance.",
      }),
      { code: "unsupported" },
    )
  })

  it("adds a short title to a recurrence proposal", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })

    assert.equal(proposals.length, 1)
    assert.equal(typeof proposals[0].title, "string")
    assert.ok(proposals[0].title.trim().length > 0)
    assert.doesNotMatch(proposals[0].title, /[\r\n]/)
  })

  it("preserves historical content digests when the title is absent", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = await store.proposeMemory(designer(), {
      schemaVersion: "replica.memory-proposal/v1",
      kind: "rule",
      content: "Keep field labels visible.",
      evidence: proposals[0].evidence,
      rationale: {
        recurrence: "Repeated feedback.",
        expectedBenefit: "Clearer fields.",
        falsification: "Reviewers still report problems.",
      },
      lifecycle: { action: "new" },
      consolidator: { id: "manual", version: "1" },
    })
    const historicalDigest = digestOf({
      scope: proposal.scope,
      kind: proposal.kind,
      content: proposal.content,
      appliesTo: proposal.appliesTo ?? [],
      lifecycle: proposal.proposal?.lifecycle ?? null,
      evidence: proposal.evidence,
      validFrom: proposal.validFrom ?? null,
      validUntil: proposal.validUntil ?? null,
      expiresAt: proposal.expiresAt ?? null,
    })
    assert.equal(proposal.title, undefined)
    assert.equal(proposal.contentDigest, historicalDigest)
    await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
    assert.equal((await store.verify(designer())).ok, true)
  })

  it("records separate title and content edits and safely retries an edit", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const accepted = await store.acceptMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
    })
    const titleEdit = {
      expectedDigest: accepted.digest,
      title: "Keep labels visible",
      reason: "Make the title clearer.",
      operationId: "11111111-1111-4111-8111-111111111111",
    }
    const titled = await store.editMemory(designer(), proposal.id, titleEdit)
    const retried = await store.editMemory(designer(), proposal.id, titleEdit)
    assert.equal(retried.digest, titled.digest)
    await assert.rejects(
      store.editMemory(designer(), proposal.id, { ...titleEdit, reason: "A different decision." }),
      { code: "conflict" },
    )
    await assert.rejects(
      store.editMemory(designer(), proposal.id, { ...titleEdit, content: accepted.content }),
      { code: "conflict" },
    )
    assert.equal(titled.title, titleEdit.title)
    assert.equal(titled.content, accepted.content)
    assert.notEqual(titled.contentDigest, accepted.contentDigest)
    assert.equal(titled.previousDigest, accepted.digest)
    assert.deepEqual(titled.accepted.by, designer().principal)
    assert.equal(titled.accepted.at, "2026-10-09T12:00:00.000000Z")
    assert.ok(JSON.stringify(titled.accepted).includes(titleEdit.reason))
    assert.equal(titled.accepted.contentDigest, titled.contentDigest)

    const contentEdit = {
      expectedDigest: titled.digest,
      title: titled.title,
      content: "Keep labels visible above fields while people type.",
      reason: "Clarify the expected behavior.",
      operationId: "22222222-2222-4222-8222-222222222222",
    }
    const edited = await store.editMemory(designer(), proposal.id, contentEdit)
    assert.equal(
      (await store.editMemory(designer(), proposal.id, contentEdit)).digest,
      edited.digest,
    )
    const withoutTitle = { ...contentEdit }
    delete withoutTitle.title
    await assert.rejects(store.editMemory(designer(), proposal.id, withoutTitle), {
      code: "conflict",
    })
    assert.equal(edited.title, titleEdit.title)
    assert.equal(edited.content, contentEdit.content)
    assert.equal(edited.previousDigest, titled.digest)
    assert.ok(JSON.stringify(edited.accepted).includes(contentEdit.reason))
    const history = await store.getMemory(designer(), proposal.id, { history: true })
    assert.deepEqual(
      history.versions.map((version) => version.digest),
      [proposal.digest, accepted.digest, titled.digest, edited.digest],
    )
    assert.equal((await store.recall(agent())).memories[0].content, contentEdit.content)
    assert.equal((await store.verify(designer())).ok, true)
  })

  it("refuses stale or nonhuman edits without changing history", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const accepted = await store.acceptMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      content: "Keep labels visible.",
    })
    const input = {
      title: "Form labels",
      reason: "Clarify the title.",
      operationId: "33333333-3333-4333-8333-333333333333",
    }
    await assert.rejects(
      store.editMemory(agent(), proposal.id, { ...input, expectedDigest: accepted.digest }),
      { code: "human_required" },
    )
    await assert.rejects(
      store.editMemory(designer(), proposal.id, { ...input, expectedDigest: proposal.digest }),
      { code: "stale_review" },
    )
    const history = await store.getMemory(designer(), proposal.id, { history: true })
    assert.deepEqual(
      history.versions.map((version) => version.digest),
      [proposal.digest, accepted.digest],
    )
  })

  it("reinstates a rejected learning once and keeps its decision history", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const rejected = await store.rejectMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      reason: "Needs another review.",
    })
    const input = {
      expectedDigest: rejected.digest,
      reason: "The team confirmed the guidance.",
      operationId: "44444444-4444-4444-8444-444444444444",
    }
    const restored = await store.reinstateMemory(designer(), proposal.id, input)
    assert.equal(
      (await store.reinstateMemory(designer(), proposal.id, input)).digest,
      restored.digest,
    )
    assert.equal(restored.state, "accepted")
    assert.equal(restored.previousDigest, rejected.digest)
    assert.deepEqual(restored.accepted.by, designer().principal)
    assert.equal(restored.accepted.at, "2026-10-09T12:00:00.000000Z")
    assert.ok(JSON.stringify(restored.accepted).includes(input.reason))
    assert.equal(restored.accepted.contentDigest, restored.contentDigest)
    const history = await store.getMemory(designer(), proposal.id, { history: true })
    assert.deepEqual(
      history.versions.map((version) => version.state),
      ["proposed", "rejected", "accepted"],
    )
    assert.equal((await store.recall(agent())).memories[0].id, proposal.id)
    assert.equal((await store.verify(designer())).ok, true)
  })

  it("reinstates a retired learning only against the reviewed version", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const accepted = await store.acceptMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      content: "Keep labels visible.",
    })
    const retired = await store.retireMemory(designer(), proposal.id, { reason: "Out of date." })
    const input = {
      expectedDigest: retired.digest,
      reason: "The guidance applies again.",
      operationId: "55555555-5555-4555-8555-555555555555",
    }
    await assert.rejects(store.reinstateMemory(agent(), proposal.id, input), {
      code: "human_required",
    })
    await assert.rejects(
      store.reinstateMemory(designer(), proposal.id, {
        ...input,
        expectedDigest: accepted.digest,
      }),
      { code: "stale_review" },
    )
    const restored = await store.reinstateMemory(designer(), proposal.id, input)
    assert.equal(restored.previousDigest, retired.digest)
    assert.equal(restored.content, accepted.content)
    const history = await store.getMemory(designer(), proposal.id, { history: true })
    assert.deepEqual(
      history.versions.map((version) => version.state),
      ["proposed", "accepted", "retired", "accepted"],
    )
    assert.equal((await store.recall(agent())).memories[0].id, proposal.id)
    assert.equal((await store.verify(designer())).ok, true)
  })

  it("refuses a stale reinstatement after the learning is restored and retired again", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const rejected = await store.rejectMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      reason: "Reconsider later.",
    })
    await store.reinstateMemory(designer(), proposal.id, {
      expectedDigest: rejected.digest,
      reason: "The team confirmed the guidance.",
      operationId: "99999999-9999-4999-8999-999999999991",
    })
    const retired = await store.retireMemory(designer(), proposal.id, { reason: "Out of date." })
    assert.equal(retired.reviewDigest, rejected.reviewDigest)
    await assert.rejects(
      store.reinstateMemory(designer(), proposal.id, {
        expectedDigest: rejected.digest,
        reason: "An outdated review.",
        operationId: "99999999-9999-4999-8999-999999999992",
      }),
      { code: "stale_review" },
    )
    const history = await store.getMemory(designer(), proposal.id, { history: true })
    assert.equal(history.record.digest, retired.digest)
    assert.deepEqual(
      history.versions.map((version) => version.state),
      ["proposed", "rejected", "accepted", "retired"],
    )
    assert.equal((await store.verify(designer())).ok, true)
  })

  it("refuses reinstatement when counterevidence no longer permits instruction", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const early = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Early evidence.",
      evidenceUntil: "2026-10-03T00:00:00.000000Z",
    })
    const late = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Later evidence.",
      evidenceFrom: "2026-10-03T00:00:00.000000Z",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [early.id, late.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    await store.annotate(agent(), [
      {
        target: { commentId: 110 },
        theme: { key: "visible-form-labels", statement: "Labels can stay inside short inputs." },
        signal: "accessibility",
        observation: "observed",
        stance: "contradicts",
      },
    ])
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    assert.ok(proposal.contradictions.length > 0)
    const rejected = await store.rejectMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      reason: "Reconsider later.",
    })
    await store.withdrawGrant(designer(), late.id, { purposes: ["instruction"] })
    await assert.rejects(
      store.reinstateMemory(designer(), proposal.id, {
        expectedDigest: rejected.digest,
        reason: "Try again.",
        operationId: "66666666-6666-4666-8666-666666666666",
      }),
      { code: "purpose_not_granted" },
    )
    assert.deepEqual(
      (await store.getMemory(designer(), proposal.id, { history: true })).versions.map(
        (version) => version.state,
      ),
      ["proposed", "rejected"],
    )
    assert.equal((await store.recall(agent())).memories.length, 0)
  })

  it("refuses to reinstate a learning after its supporting comment is redacted", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const rejected = await store.rejectMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      reason: "Reconsider later.",
    })
    const evidenceIds = new Set(proposal.evidence.flatMap((ref) => ref.eventIds))
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const comment = events.find(
      (event) => evidenceIds.has(event.id) && event.type === "human_comment",
    )
    assert.ok(comment)
    await store.redactComment(designer(), comment.id, { reason: "The author asked." })
    await assert.rejects(
      store.reinstateMemory(designer(), proposal.id, {
        expectedDigest: rejected.digest,
        reason: "Try again.",
        operationId: "77777777-7777-4777-8777-777777777777",
      }),
    )
    assert.equal((await store.getMemory(designer(), proposal.id)).record.state, "rejected")
    assert.equal((await store.recall(agent())).memories.length, 0)
  })

  it("detects an edited approval that does not name the reviewed version", async () => {
    const provider = createInMemoryProvider()
    let damage = false
    const store = await createLearningStore({
      provider: {
        ...provider,
        async readMemoryVersions(query) {
          const versions = await provider.readMemoryVersions(query)
          return damage
            ? versions.map((version) =>
                version.version === 3
                  ? sealMemory({
                      ...version,
                      accepted: { ...version.accepted, reviewedDigest: `sha256:${"f".repeat(64)}` },
                    })
                  : version,
              )
            : versions
        },
      },
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const accepted = await store.acceptMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
    })
    await store.editMemory(designer(), proposal.id, {
      expectedDigest: accepted.digest,
      title: "Keep labels visible",
      reason: "Clarify the title.",
      operationId: "88888888-8888-4888-8888-888888888888",
    })
    assert.equal((await store.verify(designer())).ok, true)
    damage = true
    assert.equal((await store.verify(designer())).ok, false)
    assert.equal((await store.recall(agent())).memories.length, 0)
  })

  it("withholds decision reasons from current records and history when review consent ends", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const rejectReason = "Private rejection explanation."
    const restoreReason = "Private reinstatement explanation."
    const editReason = "Private edit explanation."
    const retireReason = "Private retirement explanation."
    const rejected = await store.rejectMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      reason: rejectReason,
    })
    assert.equal(
      (await store.getMemory(designer(), proposal.id)).record.rejected.reason,
      rejectReason,
    )
    assert.equal((await store.queryMemory(designer()))[0].record.rejected.reason, rejectReason)
    await store.withdrawGrant(designer(), grant.id, { purposes: ["review"] })
    const withheldRejected = await store.getMemory(designer(), proposal.id, { history: true })
    const rejectedListing = await store.queryMemory(designer())
    assert.equal(withheldRejected.withheld, true)
    assert.equal(rejectedListing[0].withheld, true)
    assert.ok(!JSON.stringify(withheldRejected).includes(rejectReason))
    assert.ok(!JSON.stringify(rejectedListing).includes(rejectReason))
    const reviewGrant = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "Review resumed.",
    })
    const restored = await store.reinstateMemory(designer(), proposal.id, {
      expectedDigest: rejected.digest,
      reason: restoreReason,
    })
    await store.editMemory(designer(), proposal.id, {
      expectedDigest: restored.digest,
      title: "Keep labels visible",
      reason: editReason,
    })
    assert.equal((await store.getMemory(designer(), proposal.id)).record.accepted.note, editReason)
    assert.equal((await store.queryMemory(designer()))[0].record.accepted.note, editReason)
    await store.withdrawGrant(designer(), reviewGrant.id, { purposes: ["review"] })
    const withheldAccepted = await store.getMemory(designer(), proposal.id, { history: true })
    const acceptedListing = await store.queryMemory(designer())
    assert.equal(withheldAccepted.withheld, true)
    assert.equal(acceptedListing[0].withheld, true)
    for (const reason of [rejectReason, restoreReason, editReason]) {
      assert.ok(!JSON.stringify(withheldAccepted).includes(reason))
      assert.ok(!JSON.stringify(acceptedListing).includes(reason))
    }
    const resumed = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "Review resumed again.",
    })
    await store.retireMemory(designer(), proposal.id, { reason: retireReason })
    const visible = await store.getMemory(designer(), proposal.id, { history: true })
    assert.equal(visible.record.retired.reason, retireReason)
    assert.equal(visible.versions[1].rejected.reason, rejectReason)
    assert.equal(visible.versions[2].accepted.note, restoreReason)
    assert.equal(visible.versions[3].accepted.note, editReason)
    assert.equal((await store.queryMemory(designer()))[0].record.retired.reason, retireReason)

    await store.withdrawGrant(designer(), resumed.id, { purposes: ["review"] })
    const withheld = await store.getMemory(designer(), proposal.id, { history: true })
    const listing = await store.queryMemory(designer())
    assert.equal(withheld.withheld, true)
    assert.equal(listing[0].withheld, true)
    for (const reason of [rejectReason, restoreReason, editReason, retireReason]) {
      assert.ok(!JSON.stringify(withheld).includes(reason))
      assert.ok(!JSON.stringify(listing).includes(reason))
    }
    const instruction = await store.getMemory(designer(), proposal.id, {
      history: true,
      purpose: "instruction",
    })
    assert.equal(instruction.withheld, false)
    assert.equal(instruction.record.retired.reason, retireReason)
    assert.equal(instruction.versions[3].accepted.note, editReason)
  })

  it("does not commit an edit after instruction consent is withdrawn at append", async () => {
    const provider = createInMemoryProvider()
    const ready = Promise.withResolvers()
    const resume = Promise.withResolvers()
    let pause = false
    const store = await createLearningStore({
      provider: {
        ...provider,
        async appendMemoryVersion(record, options) {
          if (pause && record.accepted?.decision === "edit") {
            ready.resolve()
            await resume.promise
          }
          return provider.appendMemoryVersion(record, options)
        },
      },
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const accepted = await store.acceptMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
    })
    const before = await provider.readMemoryVersions({ scope: agent().scope })
    pause = true
    const pending = store.editMemory(designer(), proposal.id, {
      expectedDigest: accepted.digest,
      title: "Keep labels visible",
      reason: "Clarify the guidance.",
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })
    try {
      await Promise.race([
        ready.promise,
        pending.then(
          () => {
            throw new Error("The edit finished before its write was paused.")
          },
          (error) => {
            throw error
          },
        ),
      ])
      await store.withdrawGrant(designer(), grant.id, { purposes: ["instruction"] })
      resume.resolve()
      await assert.rejects(pending)
      assert.deepEqual(await provider.readMemoryVersions({ scope: agent().scope }), before)
      assert.deepEqual(
        await provider.readRecords("audit", {
          scope: agent().scope,
          operations: ["memory.edit"],
        }),
        [],
      )
    } finally {
      resume.resolve()
      await pending.catch(() => {})
    }
  })

  it("does not commit a reinstatement after supporting evidence is redacted at append", async () => {
    const provider = createInMemoryProvider()
    const ready = Promise.withResolvers()
    const resume = Promise.withResolvers()
    let pause = false
    const store = await createLearningStore({
      provider: {
        ...provider,
        async appendMemoryVersion(record, options) {
          if (pause && record.accepted?.decision === "reinstate") {
            ready.resolve()
            await resume.promise
          }
          return provider.appendMemoryVersion(record, options)
        },
      },
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const rejected = await store.rejectMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
      reason: "Review later.",
    })
    const evidenceIds = new Set(proposal.evidence.flatMap((ref) => ref.eventIds))
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const comment = events.find(
      (event) => evidenceIds.has(event.id) && event.type === "human_comment",
    )
    assert.ok(comment)
    const before = await provider.readMemoryVersions({ scope: agent().scope })
    pause = true
    const pending = store.reinstateMemory(designer(), proposal.id, {
      expectedDigest: rejected.digest,
      reason: "The team confirmed the guidance.",
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    })
    try {
      await Promise.race([
        ready.promise,
        pending.then(
          () => {
            throw new Error("The reinstatement finished before its write was paused.")
          },
          (error) => {
            throw error
          },
        ),
      ])
      await store.redactComment(designer(), comment.id, { reason: "The author asked." })
      resume.resolve()
      await assert.rejects(pending)
      assert.deepEqual(await provider.readMemoryVersions({ scope: agent().scope }), before)
      assert.deepEqual(
        await provider.readRecords("audit", {
          scope: agent().scope,
          operations: ["memory.reinstate"],
        }),
        [],
      )
    } finally {
      resume.resolve()
      await pending.catch(() => {})
    }
  })
})
