import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { LearningError } from "../src/errors.mjs"
import { DELETE_CAPABILITY, REQUIRED_CAPABILITIES, STREAMS } from "../src/provider-contract.mjs"
import { SCHEMA_VERSIONS, sealEpisode, sealEvent, sealMemory, sealRecord } from "../src/records.mjs"
import { migrateRepositoryScope } from "../src/scope-migration.mjs"
import { createLearningStore } from "../src/store.mjs"
import { validateRecord } from "../src/validate.mjs"
import { REPOSITORY, weekOneLabels, weekOneLog, weekTwoLog } from "./fixtures.mjs"

export * from "./fixtures.mjs"

const NOW = Date.parse("2026-10-09T12:00:00Z")
const SCOPE = Object.freeze({ repository: REPOSITORY })
const OTHER = Object.freeze({ repository: "acme/other-prototypes" })
const WINDOW = Object.freeze({
  from: "2026-09-29T00:00:00.000000Z",
  to: "2026-10-05T18:00:00.000000Z",
})

export function designer(scope = SCOPE) {
  return { scope, principal: { kind: "human", id: "github:ana-designer", asserted: true } }
}
export function agent(scope = SCOPE) {
  return { scope, principal: { kind: "agent", id: "agent:copilot", model: "conformance" } }
}

/**
 * Register the memory provider conformance suite with node:test. createProvider must return
 * a new, empty provider each time. Every test runs against a fresh provider.
 *
 * The first group checks storage behavior directly. The second runs the learning store over
 * the provider and checks the rules every Replica deployment relies on, including the ten
 * Stage 1 cases: append-only evidence, digest-bound approval, purpose isolation, revocation,
 * supersession, no automatic learning, provider conformance itself, window safety, revision
 * pinning, and untrusted input.
 *
 * @param {{ name: string, createProvider: () => Promise<object> | object }} options
 */
export function memoryProviderConformance({ name, createProvider }) {
  async function fresh() {
    return createProvider()
  }
  async function open(wrap = (provider) => provider, clock = () => NOW, suppliedProvider) {
    const provider = suppliedProvider ?? (await fresh())
    const store = await createLearningStore({ provider: wrap(provider), clock })
    return { store, provider }
  }
  function supportsIndexedDecisions(provider) {
    return (
      provider.atomicDecisionFence === true &&
      [
        "decisionFence",
        "readDecisionMemoryIds",
        "readRelatedEpisodeIds",
        "readDecisionInputs",
      ].every((method) => typeof provider[method] === "function")
    )
  }

  describe(`${name}: storage contract`, () => {
    it("declares a valid manifest with every required capability", async () => {
      const manifest = (await fresh()).manifest()
      assert.deepEqual(validateRecord("providerManifest", manifest, { sealed: false }), {
        valid: true,
        errors: [],
      })
      assert.ok(manifest.contract.versions.includes(1))
      for (const capability of REQUIRED_CAPABILITIES)
        assert.ok(manifest.capabilities.includes(capability), capability)
    })

    it("reports health", async () => {
      const health = await (await fresh()).health()
      assert.equal(health.ok, true)
      assert.equal(typeof health.detail, "string")
    })

    it("returns appended records exactly and in append order", async () => {
      const provider = await fresh()
      const records = [
        grant("grant_aaaaaaaa1", "2026-10-01T00:00:00.000000Z"),
        grant("grant_aaaaaaaa2", "2026-09-01T00:00:00.000000Z"),
      ]
      assert.deepEqual(await provider.appendRecords("grants", records), {
        appended: 2,
        existing: 0,
      })
      assert.deepEqual(await provider.readRecords("grants", { scope: SCOPE }), records)
    })

    it("selects only grants matching the evidence, purpose, and decision time", async (t) => {
      const provider = await fresh()
      if (!supportsIndexedDecisions(provider)) {
        t.skip("Provider does not support indexed learning decisions.")
        return
      }
      const firstAt = "2026-10-03T00:00:00.000000Z"
      const secondAt = "2026-10-08T00:00:00.000000Z"
      const at = "2026-10-09T12:00:00.000000Z"
      function makeGrant(id, fields) {
        return sealRecord({ ...grant(id), ...fields })
      }
      const records = [
        makeGrant("grant_selected1", {
          grantedAt: at,
          expiresAt: "2026-10-10T00:00:00.000000Z",
          evidenceFrom: firstAt,
          evidenceUntil: "2026-10-04T00:00:00.000000Z",
        }),
        makeGrant("grant_selected2", { sources: ["other_source"], evidenceFrom: secondAt }),
        makeGrant("grant_wrongsource1", { sources: ["unselected_source"] }),
        makeGrant("grant_wrongpurpose1", { purposes: ["review"] }),
        makeGrant("grant_future1", { grantedAt: "2026-10-10T00:00:00.000000Z" }),
        makeGrant("grant_expired1", { expiresAt: at }),
        makeGrant("grant_outsidewindow1", { evidenceUntil: firstAt }),
        makeGrant("grant_wrongpair1", { evidenceFrom: "2026-10-06T00:00:00.000000Z" }),
        makeGrant("grant_otherscope1", { scope: OTHER }),
      ]
      await provider.appendRecords("grants", records)
      const inputs = await provider.readDecisionInputs(SCOPE, {
        evidence: [
          { source: "hub_review_comments", at: firstAt },
          { source: "other_source", at: secondAt },
        ],
        at,
        purpose: "instruction",
        hubSources: [],
        eventIds: [],
      })
      assert.deepEqual(
        inputs.grants.map(({ id }) => id),
        ["grant_selected1", "grant_selected2"],
      )
    })

    it("returns only the earliest stable collection for each Hub source", async (t) => {
      const provider = await fresh()
      if (!supportsIndexedDecisions(provider)) {
        t.skip("Provider does not support indexed learning decisions.")
        return
      }
      const source = { hubOrigin: "https://replica.example.com", repositoryId: 42 }
      function collection(id, fields) {
        return {
          id,
          scope: SCOPE,
          snapshotId: `snapshot-${id}`,
          reviewerIdentity: "stable-user-id",
          source,
          digest: `sha256:${id}`,
          ...fields,
        }
      }
      await provider.appendRecords("collections", [
        collection("collection_first"),
        collection("collection_second"),
        collection("collection_third"),
        collection("collection_othersource", { source: { ...source, repositoryId: 43 } }),
      ])
      const inputs = await provider.readDecisionInputs(SCOPE, {
        evidence: [],
        at: "2026-10-09T12:00:00.000000Z",
        purpose: "instruction",
        hubSources: [source],
        eventIds: [],
      })
      assert.deepEqual(
        inputs.collections.map(({ id }) => id),
        ["collection_first"],
      )
    })

    it("skips a record whose ID and digest are already stored", async () => {
      const provider = await fresh()
      const record = grant("grant_aaaaaaaa1")
      await provider.appendRecords("grants", [record])
      assert.deepEqual(await provider.appendRecords("grants", [record, record]), {
        appended: 0,
        existing: 2,
      })
      assert.equal((await provider.readRecords("grants", { scope: SCOPE })).length, 1)
    })

    it("refuses another record under a stored ID and writes nothing from that batch", async () => {
      const provider = await fresh()
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
      const changed = grant("grant_aaaaaaaa1", "2026-10-02T00:00:00.000000Z")
      await assert.rejects(provider.appendRecords("grants", [grant("grant_aaaaaaaa3"), changed]), {
        code: "conflict",
      })
      assert.deepEqual(
        (await provider.readRecords("grants", { scope: SCOPE })).map((item) => item.id),
        ["grant_aaaaaaaa1"],
      )
    })

    it("stores a change and the audit entries that record it together, or neither", async () => {
      const provider = await fresh()
      const [first, second, third] = ["1", "2", "3"].map((n) => auditEntry(`audit_aaaaaaaa${n}`))
      const changed = auditEntry("audit_aaaaaaaa1", "Another reason.")
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], { audit: [first] })
      await assert.rejects(
        provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], { audit: [changed] }),
        { code: "conflict" },
      )
      await assert.rejects(
        provider.appendRecords(
          "grants",
          [grant("grant_aaaaaaaa1", "2026-10-02T00:00:00.000000Z")],
          { audit: [second] },
        ),
        { code: "conflict" },
      )
      const version = memory("mem_bbbbbbbb1", 1)
      await assert.rejects(
        provider.appendMemoryVersion(version, { expectedPreviousDigest: null, audit: [changed] }),
        { code: "conflict" },
      )
      await assert.rejects(
        provider.appendMemoryVersion(version, {
          expectedPreviousDigest: `sha256:${"0".repeat(64)}`,
          audit: [second],
        }),
        { code: "conflict" },
      )
      assert.deepEqual(
        (await provider.readRecords("grants", { scope: SCOPE })).map((item) => item.id),
        ["grant_aaaaaaaa1"],
      )
      assert.deepEqual(await provider.readMemoryVersions({ scope: SCOPE }), [])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [first])
      await provider.appendMemoryVersion(version, { expectedPreviousDigest: null, audit: [second] })
      await provider.appendRecords("grants", [], { audit: [third] })
      assert.deepEqual(await provider.readMemoryVersions({ scope: SCOPE }), [version])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [
        first,
        second,
        third,
      ])
    })

    it("refuses a decision when its eligibility changes without writing its audit", async (t) => {
      const provider = await fresh()
      if (provider.atomicDecisionFence !== true) {
        t.skip("Provider does not claim atomic decision fences.")
        return
      }
      const fence = await provider.decisionFence(SCOPE)
      await provider.appendRecords("grants", [grant("grant_otherfence1", undefined, OTHER)])
      const first = memory("mem_fencefirst1", 1)
      const receipt = auditEntry("audit_fencefirst1")
      await provider.appendMemoryVersion(first, {
        expectedPreviousDigest: null,
        expectedDecisionFence: fence,
        audit: [receipt],
      })
      assert.notEqual(await provider.decisionFence(SCOPE), fence)
      const beforeWithdrawal = await provider.decisionFence(SCOPE)
      await provider.appendRecords("withdrawals", [
        sealRecord({ id: "withdraw_fence1", scope: SCOPE, at: "2026-10-02T00:00:00.000000Z" }),
      ])
      const second = memory("mem_fencesecond1", 1)
      const secondReceipt = auditEntry("audit_fencesecond1")
      await assert.rejects(
        provider.appendMemoryVersion(second, {
          expectedPreviousDigest: null,
          expectedDecisionFence: beforeWithdrawal,
          audit: [secondReceipt],
        }),
        { code: "conflict" },
      )
      assert.deepEqual(await provider.readMemoryVersions({ scope: SCOPE }), [first])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [receipt])
      await provider.appendMemoryVersion(second, {
        expectedPreviousDigest: null,
        expectedDecisionFence: await provider.decisionFence(SCOPE),
        audit: [secondReceipt],
      })
      assert.deepEqual(await provider.readMemoryVersions({ scope: SCOPE }), [first, second])
    })

    it("detects changes to each eligibility stream", async (t) => {
      const provider = await fresh()
      if (provider.atomicDecisionFence !== true) {
        t.skip("Provider does not claim atomic decision fences.")
        return
      }
      for (const stream of ["grants", "withdrawals", "collections", "episodes", "events"]) {
        const fence = await provider.decisionFence(SCOPE)
        const record = sealRecord({ id: `fence_${stream}`, scope: SCOPE })
        await provider.appendRecords(stream, [record])
        assert.notEqual(await provider.decisionFence(SCOPE), fence, stream)
      }
    })

    it("detects event redaction even though the event digest stays the same", async (t) => {
      const provider = await fresh()
      if (
        provider.atomicDecisionFence !== true ||
        !provider.manifest().capabilities.includes("observation.redact")
      ) {
        t.skip("Provider does not claim atomic decision fences and redaction.")
        return
      }
      const event = sealEvent({
        id: "ev_fenceredact1",
        scope: SCOPE,
        episodeId: "ep_fenceredact1",
        type: "annotation",
        at: "2026-10-01T00:00:00.000000Z",
        payload: { text: "Removed evidence" },
      })
      await provider.appendRecords("events", [event])
      const fence = await provider.decisionFence(SCOPE)
      const rest = { ...event }
      delete rest.payload
      await provider.redactRecord("events", {
        ...rest,
        redaction: {
          at: "2026-10-02T00:00:00.000000Z",
          by: designer().principal,
          reason: "Asked.",
        },
      })
      assert.equal((await provider.readRecords("events", { scope: SCOPE }))[0].digest, event.digest)
      await assert.rejects(
        provider.appendMemoryVersion(memory("mem_fenceredact1", 1), {
          expectedPreviousDigest: null,
          expectedDecisionFence: fence,
          audit: [auditEntry("audit_fenceredact1")],
        }),
        { code: "conflict" },
      )
      assert.deepEqual(await provider.readMemoryVersions({ scope: SCOPE }), [])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [])
    })

    it("invalidates both scopes when a migration mapping is added", async (t) => {
      const provider = await fresh()
      if (
        provider.atomicDecisionFence !== true ||
        (!provider.migrateScope && !provider.registerLegacyScope)
      ) {
        t.skip("Provider does not support repository scope migration.")
        return
      }
      const oldFence = await provider.decisionFence(OTHER)
      const newFence = await provider.decisionFence(SCOPE)
      if (provider.registerLegacyScope) await provider.registerLegacyScope(OTHER, SCOPE)
      else
        await provider.migrateScope({
          oldScope: OTHER,
          newScope: SCOPE,
          transform: ({ records, memories }) => ({
            records,
            memories,
            metadata: { oldScope: OTHER, newScope: SCOPE, digestMappings: [] },
          }),
        })
      assert.notEqual(await provider.decisionFence(OTHER), oldFence)
      assert.notEqual(await provider.decisionFence(SCOPE), newFence)
      await assert.rejects(
        provider.appendMemoryVersion(memory("mem_fencemigration1", 1), {
          expectedPreviousDigest: null,
          expectedDecisionFence: newFence,
          audit: [auditEntry("audit_fencemigration1")],
        }),
        { code: "conflict" },
      )
      assert.deepEqual(await provider.readMemoryVersions({ scope: SCOPE }), [])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [])
    })

    it("appends to several streams and their audit entries in one write, or writes nothing", async () => {
      const provider = await fresh()
      const at = "2026-10-01T00:00:00.000000Z"
      const episode = sealRecord({ id: "ep_aaaaaaaa1", scope: SCOPE, startedAt: at })
      const event = sealRecord({ id: "ev_aaaaaaaa1", scope: SCOPE, episodeId: episode.id, at })
      const later = sealRecord({ ...event, id: "ev_aaaaaaaa2" })
      const [first, second] = ["1", "2"].map((n) => auditEntry(`audit_aaaaaaaa${n}`))
      assert.deepEqual(
        await provider.appendBatch({ episodes: [episode], events: [event] }, { audit: [first] }),
        { episodes: { appended: 1, existing: 0 }, events: { appended: 1, existing: 0 } },
      )
      const changed = sealRecord({ ...episode, startedAt: "2026-10-02T00:00:00.000000Z" })
      await assert.rejects(
        provider.appendBatch({ events: [later], episodes: [changed] }, { audit: [second] }),
        { code: "conflict" },
      )
      await assert.rejects(provider.appendBatch({ unknown: [event] }), { code: "invalid_input" })
      assert.deepEqual(await provider.readRecords("events", { scope: SCOPE }), [event])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [first])
      assert.deepEqual(
        await provider.appendBatch(
          { episodes: [episode], events: [event, later] },
          { audit: [second] },
        ),
        { episodes: { appended: 0, existing: 1 }, events: { appended: 1, existing: 1 } },
      )
      assert.deepEqual(await provider.readRecords("events", { scope: SCOPE }), [event, later])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [first, second])
    })

    it("counts both explicit and companion audit entries, including duplicates", async () => {
      const provider = await fresh()
      const [first, second, third] = ["1", "2", "3"].map((n) => auditEntry(`audit_mergedlist${n}`))
      assert.deepEqual(
        await provider.appendBatch({ audit: [first, second] }, { audit: [second, third] }),
        { audit: { appended: 3, existing: 1 } },
      )
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [
        first,
        second,
        third,
      ])
      assert.deepEqual(
        await provider.appendRecords("audit", [first], { audit: [first, second, third] }),
        { appended: 0, existing: 4 },
      )
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), [
        first,
        second,
        third,
      ])
    })

    it("redacts only the same event, in place, and refuses anything else", async () => {
      const { store, provider } = await open()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const grantId = (await store.addGrant(designer(), grantInput())).id
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      await store.annotate(agent(), weekOneLabels().labels)
      const before = await provider.readRecords("events", { scope: SCOPE })
      const [first, second] = before.filter((event) => event.type === "human_comment")
      const label = before.find((event) => event.type === "annotation")
      const unnamed = {
        at: "2026-10-09T12:00:00.000000Z",
        by: designer().principal,
        reason: "Asked.",
      }
      const note = { ...unnamed, commentId: first.payload.commentId }
      const { payload, ...rest } = first
      assert.ok(payload)
      const copy = { ...rest, redaction: note }
      const bareLabel = { ...label }
      delete bareLabel.payload
      const refused = [
        ["grants", copy, "invalid_input"],
        ["events", { ...first, redaction: note }, "invalid_input"],
        ["events", rest, "invalid_input"],
        ["events", { ...copy, id: "ev_zzzzzzzz9" }, "not_found"],
        ["events", { ...copy, digest: second.digest }, "conflict"],
        ["events", { ...rest, redaction: unnamed }, "invalid_input"],
        [
          "events",
          { ...rest, redaction: { ...unnamed, commentId: second.payload.commentId } },
          "invalid_input",
        ],
        ["events", { ...bareLabel, redaction: note }, "invalid_input"],
      ]
      for (const [stream, record, code] of refused)
        await assert.rejects(provider.redactRecord(stream, record), { code }, code)
      assert.deepEqual(await provider.readRecords("events", { scope: SCOPE }), before)
      assert.deepEqual(await provider.redactRecord("events", copy), { redacted: true })
      assert.deepEqual(await provider.redactRecord("events", copy), { redacted: false })
      assert.deepEqual(
        await provider.readRecords("events", { scope: SCOPE }),
        before.map((event) => (event.id === first.id ? copy : event)),
      )
    })

    it("lets only one of two racing redactions of an event remove its payload", async () => {
      const { store, provider } = await open()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const grantId = (await store.addGrant(designer(), grantInput())).id
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      const [event] = (await provider.readRecords("events", { scope: SCOPE })).filter(
        (item) => item.payload !== undefined,
      )
      const bare = { ...event }
      delete bare.payload
      const copies = ["first", "second"].map((reason) => ({
        ...bare,
        redaction: {
          at: "2026-10-09T12:00:00.000000Z",
          by: designer().principal,
          reason,
          ...(event.type === "human_comment" ? { commentId: event.payload.commentId } : {}),
        },
      }))
      const results = await Promise.all(copies.map((copy) => provider.redactRecord("events", copy)))
      assert.deepEqual(results.map((result) => result.redacted).sort(), [false, true])
      const [stored] = await provider.readRecords("events", { scope: SCOPE, ids: [event.id] })
      assert.deepEqual(stored, copies[results.findIndex((result) => result.redacted)])
    })

    it("refuses a query without a scope, even when it holds nothing", async () => {
      const provider = await fresh()
      await assert.rejects(provider.readRecords("grants", {}), { code: "invalid_input" })
      await assert.rejects(provider.readMemoryVersions({}), { code: "invalid_input" })
    })

    it("filters by scope, IDs, and time, and never returns another scope's records", async () => {
      const provider = await fresh()
      await provider.appendRecords("grants", [
        grant("grant_aaaaaaaa1", "2026-09-01T00:00:00.000000Z"),
        grant("grant_aaaaaaaa2", "2026-10-01T00:00:00.000000Z"),
        grant("grant_aaaaaaaa3", "2026-10-01T00:00:00.000000Z", OTHER),
      ])
      async function ids(query) {
        return (await provider.readRecords("grants", query)).map((item) => item.id)
      }
      assert.deepEqual(await ids({ scope: SCOPE }), ["grant_aaaaaaaa1", "grant_aaaaaaaa2"])
      assert.deepEqual(await ids({ scope: OTHER }), ["grant_aaaaaaaa3"])
      assert.deepEqual(await ids({ scope: SCOPE, ids: ["grant_aaaaaaaa2", "grant_aaaaaaaa3"] }), [
        "grant_aaaaaaaa2",
      ])
      assert.deepEqual(await ids({ scope: SCOPE, since: "2026-09-15T00:00:00.000000Z" }), [
        "grant_aaaaaaaa2",
      ])
      assert.deepEqual(await ids({ scope: SCOPE, until: "2026-09-15T00:00:00.000000Z" }), [
        "grant_aaaaaaaa1",
      ])
      await assert.rejects(provider.readRecords("grants", {}), { code: "invalid_input" })
      await assert.rejects(provider.readRecords("unknown", { scope: SCOPE }), {
        code: "invalid_input",
      })
    })

    it("filters audit operations together with scope, IDs, and time", async () => {
      const provider = await fresh()
      const records = [
        auditEntry("audit_operation01"),
        sealRecord({ ...auditEntry("audit_operation02"), operation: "memory.recall" }),
        sealRecord({ ...auditEntry("audit_operation03"), operation: "evidence.redact" }),
        sealRecord({
          ...auditEntry("audit_operation04"),
          operation: "evidence.redact",
          scope: OTHER,
        }),
      ]
      await provider.appendRecords("audit", records)
      assert.deepEqual(
        await provider.readRecords("audit", {
          scope: SCOPE,
          operations: ["evidence.redact"],
        }),
        [records[2]],
      )
      assert.deepEqual(
        await provider.readRecords("audit", {
          scope: SCOPE,
          operations: ["grant.add", "evidence.redact"],
          ids: records.slice(1).map((record) => record.id),
          since: records[2].at,
        }),
        [records[2]],
      )
      assert.deepEqual(
        await provider.readRecords("audit", {
          scope: SCOPE,
          operations: ["evidence.redact"],
          until: records[2].at,
        }),
        [],
      )
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE, operations: [] }), [])
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), records.slice(0, 3))
    })

    it("filters events by episode", async () => {
      const { store } = await open()
      const id = (await store.addGrant(designer(), grantInput())).id
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [id] })
      const { episodes, events } = await store.queryObservations(designer(), { purpose: "review" })
      const target = episodes[0].id
      assert.ok(events.some((event) => event.episodeId !== target))
      const filtered = await store.queryObservations(designer(), {
        purpose: "review",
        episodeIds: [target],
      })
      assert.ok(filtered.events.length > 0)
      assert.ok(filtered.events.every((event) => event.episodeId === target))
    })

    it("appends a memory version only from the expected previous digest", async () => {
      const provider = await fresh()
      const first = memory("mem_bbbbbbbb1", 1)
      await assert.rejects(
        provider.appendMemoryVersion(first, { expectedPreviousDigest: "sha256:" + "0".repeat(64) }),
        { code: "conflict" },
      )
      await provider.appendMemoryVersion(first, { expectedPreviousDigest: null })
      const second = memory("mem_bbbbbbbb1", 2, first.digest)
      await assert.rejects(provider.appendMemoryVersion(second, { expectedPreviousDigest: null }), {
        code: "conflict",
      })
      await assert.rejects(
        provider.appendMemoryVersion(memory("mem_bbbbbbbb1", 3, first.digest), {
          expectedPreviousDigest: first.digest,
        }),
        { code: "conflict" },
      )
      await provider.appendMemoryVersion(second, { expectedPreviousDigest: first.digest })
      assert.deepEqual(
        await provider.readMemoryVersions({ scope: SCOPE, ids: ["mem_bbbbbbbb1"] }),
        [first, second],
      )
      assert.deepEqual(await provider.readMemoryVersions({ scope: OTHER }), [])
    })

    it("lets exactly one of two concurrent updates win", async () => {
      const provider = await fresh()
      const first = memory("mem_bbbbbbbb1", 1)
      await provider.appendMemoryVersion(first, { expectedPreviousDigest: null })
      const results = await Promise.allSettled([
        provider.appendMemoryVersion(memory("mem_bbbbbbbb1", 2, first.digest, "Left"), {
          expectedPreviousDigest: first.digest,
        }),
        provider.appendMemoryVersion(memory("mem_bbbbbbbb1", 2, first.digest, "Right"), {
          expectedPreviousDigest: first.digest,
        }),
      ])
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
      assert.equal(results.find((result) => result.status === "rejected").reason.code, "conflict")
      assert.equal((await provider.readMemoryVersions({ scope: SCOPE })).length, 2)
    })

    it("returns copies that callers cannot use to change stored records", async () => {
      const provider = await fresh()
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
      const [copy] = await provider.readRecords("grants", { scope: SCOPE })
      copy.purposes.push("training")
      copy.basis = "changed"
      const [stored] = await provider.readRecords("grants", { scope: SCOPE })
      assert.deepEqual(stored, grant("grant_aaaaaaaa1"))
    })
  })

  describe(`${name}: learning rules`, () => {
    async function imported(wrap, provider) {
      const opened = await open(wrap, undefined, provider)
      const grantId = (await opened.store.addGrant(designer(), grantInput())).id
      await opened.store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      return { ...opened, grantId }
    }

    async function proposed(wrap, provider) {
      const opened = await imported(wrap, provider)
      await opened.store.annotate(agent(), weekOneLabels().labels)
      const result = await opened.store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      return { ...opened, result, proposal: result.proposals[0] }
    }

    it("finds matching review threads only in the same repository", async (t) => {
      const provider = await fresh()
      if (!supportsIndexedDecisions(provider)) {
        t.skip("Provider does not support indexed learning decisions.")
        return
      }
      await imported(undefined, provider)
      const [template] = await provider.readRecords("episodes", { scope: SCOPE })
      const source = { ...template.source, threadId: 987_654 }
      const selected = sealEpisode({ ...template, id: "ep_relatedselected1", source })
      const copy = sealEpisode({
        ...selected,
        id: "ep_relatedcopy1",
        source: { ...source, buildNumber: source.buildNumber + 1 },
      })
      const differentThread = sealEpisode({
        ...selected,
        id: "ep_relatedthread1",
        source: { ...source, threadId: source.threadId + 1 },
      })
      const differentPrototype = sealEpisode({
        ...selected,
        id: "ep_relatedprototype1",
        source: { ...source, prototypeId: source.prototypeId + 1 },
      })
      const differentRepository = sealEpisode({
        ...selected,
        id: "ep_relatedrepository1",
        source: { ...source, repositoryId: source.repositoryId + 1 },
      })
      const differentOrigin = sealEpisode({
        ...selected,
        id: "ep_relatedorigin1",
        source: { ...source, hubOrigin: "https://other.example.com" },
      })
      const differentScope = sealEpisode({
        ...copy,
        id: "ep_relatedscope1",
        scope: OTHER,
      })
      await provider.appendRecords("episodes", [
        selected,
        copy,
        differentThread,
        differentPrototype,
        differentRepository,
        differentOrigin,
        differentScope,
      ])
      assert.deepEqual(
        new Set(await provider.readRelatedEpisodeIds(SCOPE, [selected.id])),
        new Set([selected.id, copy.id]),
      )
      assert.deepEqual(await provider.readRelatedEpisodeIds(SCOPE, []), [])
    })

    const decisionRaces = [
      { decision: "edit", change: "withdrawal" },
      { decision: "reinstate", change: "redaction" },
      { decision: "edit", change: "supersession" },
      { decision: "reinstate", change: "supersession" },
      { decision: "reinstate", change: "scope migration" },
      { decision: "edit", change: "another repository" },
    ]
    for (const { decision, change } of decisionRaces) {
      const name =
        change === "another repository"
          ? `${decision} succeeds while another repository changes`
          : `${decision} refuses a concurrent ${change}`
      it(name, { timeout: 60_000 }, async (t) => {
        const provider = await fresh()
        if (!supportsIndexedDecisions(provider)) {
          t.skip("Provider does not support indexed learning decisions.")
          return
        }
        if (
          change === "redaction" &&
          !provider.manifest().capabilities.includes("observation.redact")
        ) {
          t.skip("Provider does not support redaction.")
          return
        }
        if (
          change === "scope migration" &&
          !provider.migrateScope &&
          !provider.registerLegacyScope
        ) {
          t.skip("Provider does not support repository scope migration.")
          return
        }
        const ready = Promise.withResolvers()
        const resume = Promise.withResolvers()
        let pause = false
        const { store, grantId, proposal } = await proposed(
          (inner) => ({
            ...inner,
            async appendMemoryVersion(record, options) {
              if (pause && record.accepted?.decision === decision) {
                ready.resolve()
                await resume.promise
              }
              return inner.appendMemoryVersion(record, options)
            },
          }),
          provider,
        )

        function replacementInput(lifecycle) {
          return {
            schemaVersion: SCHEMA_VERSIONS.memoryProposal,
            kind: "rule",
            content: "Keep field labels visible while people type.",
            evidence: proposal.evidence,
            rationale: {
              recurrence: "The same feedback supports this wording.",
              expectedBenefit: "Clearer fields.",
              falsification: "Reviewers still report problems.",
            },
            lifecycle,
            consolidator: { id: "manual", version: "1" },
          }
        }

        let target = proposal
        let current
        let replaced
        let replacement
        if (decision === "edit" || change === "supersession") {
          replaced = await store.acceptMemory(designer(), proposal.id, {
            expectedDigest: proposal.reviewDigest,
          })
        }
        if (decision === "edit") current = replaced
        else {
          if (change === "supersession") {
            target = await store.proposeMemory(
              designer(),
              replacementInput({ action: "supersede", targets: [replaced.id] }),
            )
          }
          current = await store.rejectMemory(designer(), target.id, {
            expectedDigest: target.reviewDigest,
            reason: "Review later.",
          })
        }
        if (change === "supersession") {
          const candidate = await store.proposeMemory(
            designer(),
            replacementInput({ action: "new" }),
          )
          replacement = await store.acceptMemory(designer(), candidate.id, {
            expectedDigest: candidate.reviewDigest,
          })
        }
        let comment
        if (change === "redaction") {
          const evidence = new Set(target.evidence.flatMap((reference) => reference.eventIds))
          const { events } = await store.queryObservations(designer(), { purpose: "review" })
          comment = events.find((event) => evidence.has(event.id) && event.type === "human_comment")
          assert.ok(comment)
        }
        const versions = await provider.readMemoryVersions({ scope: SCOPE, ids: [target.id] })
        const operation = `memory.${decision}`
        const audits = await provider.readRecords("audit", {
          scope: SCOPE,
          operations: [operation],
        })
        pause = true
        const pending =
          decision === "edit"
            ? store.editMemory(designer(), target.id, {
                expectedDigest: current.digest,
                title: "Keep labels visible",
                reason: "Clarify the guidance.",
              })
            : store.reinstateMemory(designer(), target.id, {
                expectedDigest: current.digest,
                reason: "The team confirmed the guidance.",
              })
        let resultScope = SCOPE
        try {
          await Promise.race([
            ready.promise,
            pending.then(
              () => {
                throw new Error("The decision finished before its write was paused.")
              },
              (error) => {
                throw error
              },
            ),
          ])
          if (change === "withdrawal")
            await store.withdrawGrant(designer(), grantId, { purposes: ["instruction"] })
          else if (change === "redaction")
            await store.redactComment(designer(), comment.id, { reason: "The author asked." })
          else if (change === "supersession")
            await store.supersedeMemory(designer(), [replaced.id], replacement.id)
          else if (change === "scope migration") {
            if (provider.registerLegacyScope) await provider.registerLegacyScope(OTHER, SCOPE)
            else {
              resultScope = { host: "github.com", repository: "repositories/123456" }
              await migrateRepositoryScope({
                provider,
                oldScope: SCOPE,
                newScope: resultScope,
                clock: () => NOW,
              })
            }
          } else {
            const old = { repository: "acme/another-legacy-repository" }
            if (provider.registerLegacyScope) await provider.registerLegacyScope(old, OTHER)
            else if (provider.migrateScope)
              await provider.migrateScope({
                oldScope: old,
                newScope: OTHER,
                transform: ({ records, memories }) => ({
                  records,
                  memories,
                  metadata: { oldScope: old, newScope: OTHER, digestMappings: [] },
                }),
              })
            await store.addGrant(designer(OTHER), grantInput())
            const event = sealEvent({
              id: "ev_otherdecision1",
              scope: OTHER,
              episodeId: "ep_otherdecision1",
              type: "annotation",
              at: "2026-10-01T00:00:00.000000Z",
              payload: { text: "Other repository evidence." },
            })
            await provider.appendRecords("events", [event])
            if (provider.manifest().capabilities.includes("observation.redact"))
              await provider.redactRecord("events", redacted(event))
            await provider.appendMemoryVersion(
              sealMemory({ ...memory("mem_otherdecision1", 1), scope: OTHER }),
              { expectedPreviousDigest: null },
            )
          }
          resume.resolve()
          if (change === "another repository") {
            const saved = await pending
            const after = await provider.readMemoryVersions({ scope: SCOPE, ids: [target.id] })
            assert.equal(after.length, versions.length + 1)
            assert.equal(after.at(-1).digest, saved.digest)
            assert.equal(
              (await provider.readRecords("audit", { scope: SCOPE, operations: [operation] }))
                .length,
              audits.length + 1,
            )
          } else {
            await assert.rejects(pending, (error) =>
              [
                "conflict",
                "stale_review",
                "purpose_not_granted",
                "invalid_transition",
                "not_found",
              ].includes(error.code),
            )
            if (change === "supersession") {
              const retry =
                decision === "edit"
                  ? store.editMemory(designer(), target.id, {
                      expectedDigest: current.digest,
                      title: "Keep labels visible",
                      reason: "Clarify the guidance.",
                    })
                  : store.reinstateMemory(designer(), target.id, {
                      expectedDigest: current.digest,
                      reason: "The team confirmed the guidance.",
                    })
              await assert.rejects(retry, { code: "invalid_transition" })
            }
            const after = await provider.readMemoryVersions({
              scope: resultScope,
              ids: [target.id],
            })
            assert.deepEqual(
              after.map((version) => version.version),
              versions.map((version) => version.version),
            )
            assert.equal(
              (
                await provider.readRecords("audit", {
                  scope: resultScope,
                  operations: [operation],
                })
              ).length,
              audits.length,
            )
          }
        } finally {
          resume.resolve()
          await pending.catch(() => {})
        }
      })
    }

    it("edit reads only the learning's evidence and replacement history", async (t) => {
      const provider = await fresh()
      if (!supportsIndexedDecisions(provider)) {
        t.skip("Provider does not support indexed learning decisions.")
        return
      }
      const reads = []
      let trackReads = false
      const { store, proposal } = await proposed(
        (inner) => ({
          ...inner,
          async readRecords(stream, query) {
            const records = await inner.readRecords(stream, query)
            if (trackReads && (stream === "events" || stream === "episodes"))
              reads.push({ stream, records })
            return records
          },
          async readMemoryVersions(query) {
            const records = await inner.readMemoryVersions(query)
            if (trackReads) reads.push({ stream: "memories", records })
            return records
          },
          async readDecisionInputs(scope, query) {
            const inputs = await inner.readDecisionInputs(scope, query)
            if (trackReads)
              for (const stream of ["grants", "withdrawals", "collections"])
                reads.push({ stream, records: inputs[stream] })
            return inputs
          },
        }),
        provider,
      )
      const current = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      const unrelated = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content: "Use clear labels for unrelated guidance.",
        evidence: proposal.evidence,
        rationale: {
          recurrence: "Other guidance.",
          expectedBenefit: "Clearer fields.",
          falsification: "Reviewers still report problems.",
        },
        lifecycle: { action: "new" },
        consolidator: { id: "manual", version: "1" },
      })
      const unrelatedGrant = await store.addGrant(designer(), {
        ...grantInput(),
        sources: ["unrelated_source"],
      })
      await store.withdrawGrant(designer(), unrelatedGrant.id, { purposes: ["instruction"] })
      const relevantEpisodes = new Set(
        [...proposal.evidence, ...(proposal.contradictions ?? [])].map(
          (reference) => reference.episodeId,
        ),
      )
      const episodes = await provider.readRecords("episodes", { scope: SCOPE })
      const events = await provider.readRecords("events", { scope: SCOPE })
      const unrelatedEpisodes = episodes.filter((episode) => !relevantEpisodes.has(episode.id))
      const unrelatedIds = new Set(unrelatedEpisodes.map((episode) => episode.id))
      assert.ok(unrelatedEpisodes.length > 0)
      assert.ok(events.some((event) => unrelatedIds.has(event.episodeId)))

      trackReads = true
      const saved = await store.editMemory(designer(), proposal.id, {
        expectedDigest: current.digest,
        title: "Keep labels visible",
        reason: "Clarify the guidance.",
      })
      trackReads = false
      assert.equal(saved.version, current.version + 1)
      for (const stream of ["episodes", "events", "memories", "grants", "withdrawals"])
        assert.ok(
          reads.some((read) => read.stream === stream),
          stream,
        )
      assert.ok(
        reads
          .filter(({ stream }) => stream === "episodes")
          .flatMap(({ records }) => records)
          .every((episode) => !unrelatedIds.has(episode.id)),
      )
      assert.ok(
        reads
          .filter(({ stream }) => stream === "events")
          .flatMap(({ records }) => records)
          .every((event) => !unrelatedIds.has(event.episodeId)),
      )
      assert.ok(
        reads
          .filter(({ stream }) => stream === "memories")
          .flatMap(({ records }) => records)
          .every((memory) => memory.id !== unrelated.id),
      )
      assert.ok(
        reads
          .filter(({ stream }) => stream === "grants")
          .flatMap(({ records }) => records)
          .every((grant) => grant.id !== unrelatedGrant.id),
      )
      assert.ok(
        reads
          .filter(({ stream }) => stream === "withdrawals")
          .flatMap(({ records }) => records)
          .every((withdrawal) => withdrawal.grantId !== unrelatedGrant.id),
      )
    })

    it("refuses invalid recall limits through the public store API", async () => {
      const { store, proposal } = await proposed()
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null])
        await assert.rejects(store.recall(agent(), { limit }), {
          code: "invalid_input",
          message: /recall limit must be a positive safe integer/,
        })
      assert.equal((await store.recall(agent(), { limit: 1 })).memories.length, 1)
    })

    it("refuses non-JSON event payloads before persisting any part of the append", async () => {
      const { store, provider } = await imported()
      const before = await provider.readRecords("events", { scope: SCOPE })
      const audits = await provider.readRecords("audit", { scope: SCOPE })
      let invoked = 0
      function serialize() {
        invoked++
        return "Different stored content."
      }
      for (const payload of [
        { observed: new Date("2026-10-01T00:00:00Z") },
        { observed: new Map([["value", true]]) },
        { observed: { toJSON: serialize } },
        { observed: Object.defineProperty([1], "toJSON", { value: serialize }) },
        Object.defineProperty({}, "observed", { enumerable: true, get: serialize }),
      ]) {
        const event = {
          schemaVersion: SCHEMA_VERSIONS.event,
          id: "ev_nonjsonpayload1",
          episodeId: before[0].episodeId,
          type: "x-acme.checkout_step",
          at: "2026-10-01T00:00:00.000000Z",
          actor: agent().principal,
        }
        await assert.rejects(
          store.appendObservations(agent(), {
            events: [
              { ...event, id: "ev_validpayload1", payload: { observed: true } },
              { ...event, payload },
            ],
          }),
          /RFC 8785 has no form/,
        )
        assert.deepEqual(await provider.readRecords("events", { scope: SCOPE }), before)
        assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), audits)
        assert.equal((await store.verify(designer())).ok, true)
      }
      assert.equal(invoked, 0)
    })

    it("selects only requested eligible events and their episodes", async () => {
      const reads = []
      let trackReads = false
      const { store, provider, grantId } = await proposed((inner) => ({
        ...inner,
        async readRecords(stream, query) {
          const records = await inner.readRecords(stream, query)
          if (trackReads && (stream === "events" || stream === "episodes"))
            reads.push({ stream, records })
          return records
        },
      }))
      const all = await store.queryObservations(designer(), { purpose: "review" })
      const label = all.events.find((event) => event.type === "annotation")
      const comment = all.events.find((event) => event.id === label.parentEventId)
      const eventIds = [label.id, comment.id]
      assert.ok(all.events.some((event) => event.episodeId !== comment.episodeId))
      trackReads = true
      const selected = await store.queryObservations(designer(), { purpose: "review", eventIds })
      trackReads = false
      assert.ok(reads.some(({ stream }) => stream === "events"))
      assert.ok(
        reads
          .filter(({ stream }) => stream === "events")
          .flatMap(({ records }) => records)
          .every((event) => event.episodeId === comment.episodeId),
      )
      assert.ok(
        reads
          .filter(({ stream }) => stream === "episodes")
          .flatMap(({ records }) => records)
          .every((episode) => episode.id === comment.episodeId),
      )
      assert.deepEqual(
        selected.events,
        all.events.filter((event) => eventIds.includes(event.id)),
      )
      assert.deepEqual(
        selected.episodes,
        all.episodes.filter((episode) => episode.id === comment.episodeId),
      )
      assert.deepEqual(
        (
          await store.queryObservations(designer(), {
            purpose: "review",
            eventIds: Array(100).fill(comment.id),
          })
        ).events,
        [comment],
      )
      for (const ids of [[], ["ev_missingevent1"]])
        assert.deepEqual(
          await store.queryObservations(designer(), { purpose: "review", eventIds: ids }),
          {
            episodes: [],
            events: [],
          },
        )
      for (const ids of [
        null,
        "ev_missingevent1",
        ["not-an-id"],
        Array(1),
        Array(101).fill(comment.id),
      ])
        await assert.rejects(
          store.queryObservations(designer(), { purpose: "review", eventIds: ids }),
          { code: "invalid_input" },
        )
      assert.deepEqual(
        await store.queryObservations(designer(), {
          purpose: "review",
          eventIds,
          episodeIds: [],
        }),
        { episodes: [], events: [] },
      )
      const typed = await store.queryObservations(designer(), {
        purpose: "review",
        eventIds,
        types: ["annotation"],
        since: "2026-10-09T00:00:00.000000Z",
      })
      assert.deepEqual(typed.events, [label])
      assert.equal(typed.episodes.length, 1)
      const foreign = sealEvent({ ...comment, id: "ev_foreignscope1", scope: OTHER })
      await provider.appendRecords("events", [foreign])
      assert.deepEqual(
        await store.queryObservations(designer(), { purpose: "review", eventIds: [foreign.id] }),
        { episodes: [], events: [] },
      )
      await store.withdrawGrant(designer(), grantId, { purposes: ["instruction"] })
      assert.deepEqual(
        await store.queryObservations(designer(), { purpose: "instruction", eventIds }),
        { episodes: [], events: [] },
      )
      await store.appendObservations(agent(), {
        events: [retractionOf(comment, "ev_selectedretract1")],
      })
      assert.deepEqual(await store.queryObservations(designer(), { purpose: "review", eventIds }), {
        episodes: [],
        events: [],
      })
      if (provider.manifest().capabilities.includes("observation.redact")) {
        const other = all.events.find(
          (event) => event.type === "human_comment" && event.episodeId !== comment.episodeId,
        )
        await store.redactComment(designer(), other.id, { reason: "The author asked." })
        assert.deepEqual(
          await store.queryObservations(designer(), { purpose: "review", eventIds: [other.id] }),
          { episodes: [], events: [] },
        )
      }
    })

    it("refuses non-enumerable required comment fields before storing records or audit entries", async () => {
      const { store, provider } = await imported()
      const before = await provider.readRecords("events", { scope: SCOPE })
      const audits = await provider.readRecords("audit", { scope: SCOPE })
      const comment = before.find((event) => event.type === "human_comment")
      const payload = Object.defineProperty({ ...comment.payload }, "body", {
        value: comment.payload.body,
        enumerable: false,
      })
      await assert.rejects(
        store.appendObservations(agent(), {
          events: [
            { ...comment, id: "ev_visiblefields1" },
            { ...comment, id: "ev_hiddenfields1", payload },
          ],
        }),
        /RFC 8785 has no form/,
      )
      assert.deepEqual(await provider.readRecords("events", { scope: SCOPE }), before)
      assert.deepEqual(await provider.readRecords("audit", { scope: SCOPE }), audits)
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("imports Enterprise Managed User identities without changing their names", async () => {
      const { store, provider } = await open()
      const person = {
        ...designer(),
        principal: { kind: "human", id: "github:designer_enterprise" },
      }
      const grant = await store.addGrant(person, grantInput())
      const log = weekOneLog()
      const root = log.calls[1].result.threads[0]
      root.author.login = "designer_enterprise"
      root.replies[0].author.login = "reviewer_enterprise"
      root.resolvedAt = "2026-10-04T12:00:00.000000Z"
      root.resolvedBy = { login: "resolver_enterprise" }
      await store.importHubReviewComments(agent(), log, { grantIds: [grant.id] })
      const { events } = await store.queryObservations(person, { purpose: "review" })
      for (const login of ["designer_enterprise", "reviewer_enterprise", "resolver_enterprise"])
        assert.ok(events.some((event) => event.actor.id === `github:${login}`))
      assert.equal(
        (await provider.readRecords("grants", { scope: SCOPE }))[0].grantedBy.id,
        person.principal.id,
      )
      assert.equal((await store.verify(person)).ok, true)
    })

    it("append-only evidence: an edit or deletion adds events and changes none", async () => {
      const { store, grantId } = await imported()
      const before = await store.queryObservations(designer(), { purpose: "review" })
      const original = before.events.find((event) => event.payload?.commentId === 112)
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] })
      const after = await store.queryObservations(designer(), { purpose: "review" })
      for (const event of before.events.filter((item) => item.payload?.commentId !== 107))
        assert.deepEqual(
          after.events.find((item) => item.id === event.id),
          event,
        )
      const edit = after.events.find((event) => event.supersedes === original.id)
      assert.match(edit.payload.body, /16px/)
      assert.ok(after.events.some((event) => event.type === "retraction"))
      assert.ok(
        !after.events.some(
          (event) => event.payload?.commentId === 107 && event.type === "human_comment",
        ),
      )
      assert.equal((await store.verify(designer())).ok, true)
      const again = await store.importHubReviewComments(agent(), weekTwoLog(), {
        grantIds: [grantId],
      })
      assert.deepEqual([again.addedEpisodes, again.addedEvents], [0, 0])
    })

    it("imports a snapshot again without changing its collection or what the audit names", async () => {
      const { store, provider, grantId } = await imported()
      const [collection] = await provider.readRecords("collections", { scope: SCOPE })
      for (const log of [weekOneLog(), weekOneLog({ pageSize: 2 })]) {
        const again = await store.importHubReviewComments(agent(), log, { grantIds: [grantId] })
        assert.deepEqual(again.collection, collection)
      }
      assert.deepEqual(await provider.readRecords("collections", { scope: SCOPE }), [collection])
      const imports = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "collection.import",
      )
      assert.equal(imports.length, 3)
      for (const entry of imports)
        assert.deepEqual(entry.subjects[0], {
          kind: "collection",
          id: collection.id,
          digest: collection.digest,
        })
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("refuses a new older snapshot without restoring edited or deleted comments", async () => {
      const { store, provider } = await open()
      const grant = await store.addGrant(designer(), grantInput())
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grant.id] })
      const streams = ["events", "collections", "audit"]
      const before = await Promise.all(
        streams.map((stream) => provider.readRecords(stream, { scope: SCOPE })),
      )
      await assert.rejects(
        store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] }),
        { code: "conflict", message: /older than a snapshot already imported/ },
      )
      assert.deepEqual(
        await Promise.all(streams.map((stream) => provider.readRecords(stream, { scope: SCOPE }))),
        before,
      )
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      assert.ok(
        events.find((event) => event.payload?.commentId === 112).payload.body.includes("16px"),
      )
      assert.ok(!events.some((event) => event.payload?.commentId === 107 && event.payload.body))
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("replays a known older snapshot without changing the current evidence", async () => {
      const { store, provider, grantId } = await imported()
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] })
      const before = await provider.readRecords("events", { scope: SCOPE })
      const result = await store.importHubReviewComments(agent(), weekOneLog(), {
        grantIds: [grantId],
      })
      assert.deepEqual([result.addedEpisodes, result.addedEvents], [0, 0])
      assert.deepEqual(await provider.readRecords("events", { scope: SCOPE }), before)
    })

    it("preserves a session source pin and rejects one naming a different session", async () => {
      const { store, provider } = await imported()
      const grant = await store.addGrant(designer(), {
        ...grantInput(),
        sources: ["agent_session"],
      })
      const [original] = await provider.readRecords("episodes", { scope: SCOPE })
      const episode = {
        ...original,
        id: "ep_sessionevidence1",
        source: { kind: "agent_session", sessionId: "session-one" },
        grants: [grant.id],
      }
      const event = {
        schemaVersion: SCHEMA_VERSIONS.event,
        id: "ev_sessionevidence1",
        episodeId: episode.id,
        type: "user_message",
        at: "2026-10-09T12:00:00.000000Z",
        actor: agent().principal,
        payload: { text: "Keep form labels visible." },
      }
      await store.appendObservations(agent(), { episodes: [episode], events: [event] })
      const proposal = {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content: "Keep form labels visible.",
        evidence: [{ episodeId: episode.id, eventIds: [event.id], source: episode.source }],
        rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
        lifecycle: NEW,
        consolidator: { id: "manual", version: "1" },
      }
      const stored = await store.proposeMemory(designer(), proposal)
      assert.deepEqual(stored.evidence[0].source, episode.source)
      proposal.evidence[0].source = { ...episode.source, sessionId: "session-two" }
      await assert.rejects(store.proposeMemory(designer(), proposal), {
        code: "invalid_input",
        message: /Evidence source/,
      })
    })

    it("refuses other comments under a snapshot ID already imported, before storing any", async () => {
      const { store, provider, grantId } = await imported()
      async function stored() {
        return Promise.all(
          ["episodes", "events", "collections", "audit"].map((stream) =>
            provider.readRecords(stream, { scope: SCOPE }),
          ),
        )
      }
      const before = await stored()
      const edited = JSON.parse(
        JSON.stringify(weekOneLog()).replace("Put each label above its field.", "Edited."),
      )
      await assert.rejects(
        store.importHubReviewComments(agent(), edited, { grantIds: [grantId] }),
        { code: "conflict", message: /already imported with different contents/ },
      )
      assert.deepEqual(await stored(), before)
    })

    it("digest-bound approval: a stale or agent approval is refused, and edits bind to the new content", async () => {
      const { store, proposal } = await proposed()
      await assert.rejects(
        store.acceptMemory(designer(), proposal.id, { expectedDigest: `sha256:${"1".repeat(64)}` }),
        { code: "stale_review" },
      )
      await assert.rejects(
        store.acceptMemory(agent(), proposal.id, { expectedDigest: proposal.reviewDigest }),
        { code: "human_required" },
      )
      const content =
        "Put a visible label above every form field. Placeholder text never replaces it."
      const record = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
        content,
      })
      assert.equal(record.accepted.edited, true)
      assert.equal(record.accepted.reviewedDigest, proposal.reviewDigest)
      assert.equal(record.accepted.contentDigest, record.contentDigest)
      assert.notEqual(record.contentDigest, proposal.contentDigest)
      const tampered = { ...record, content: "Use placeholders as labels." }
      assert.equal(validateRecord("memoryRecord", tampered).valid, false)
      await assert.rejects(
        store.acceptMemory(designer(), proposal.id, { expectedDigest: record.reviewDigest }),
        { code: "invalid_transition" },
      )
    })

    it("purpose isolation: review-only evidence never reaches training or instruction", async () => {
      const { store } = await open()
      const reviewOnly = await store.addGrant(designer(), { ...grantInput(), purposes: ["review"] })
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [reviewOnly.id] })
      assert.ok(
        (await store.queryObservations(designer(), { purpose: "review" })).events.length > 0,
      )
      assert.deepEqual(
        (await store.queryObservations(designer(), { purpose: "training" })).events,
        [],
      )
      assert.deepEqual(
        (await store.queryObservations(designer(), { purpose: "instruction" })).events,
        [],
      )
      await assert.rejects(
        store.exportRecords(designer(), { purpose: "training", destination: "training.json" }),
        { code: "purpose_not_granted" },
      )
      await store.annotate(agent(), weekOneLabels().labels)
      const result = await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      assert.deepEqual(result.proposals, [])
    })

    it("revocation: withdrawing a purpose removes evidence and the learnings built on it", async () => {
      const { store, grantId, proposal } = await proposed()
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      assert.equal((await store.recall(agent())).memories.length, 1)
      await assert.rejects(store.withdrawGrant(agent(), grantId, { purposes: ["instruction"] }), {
        code: "human_required",
      })
      const result = await store.withdrawGrant(designer(), grantId, {
        purposes: ["instruction"],
        reason: "Team asked to stop.",
      })
      assert.deepEqual(result.memoriesNeedingRebuild, [proposal.id])
      assert.deepEqual(
        (await store.queryObservations(designer(), { purpose: "instruction" })).events,
        [],
      )
      assert.ok(
        (await store.queryObservations(designer(), { purpose: "review" })).events.length > 0,
      )
      assert.equal((await store.recall(agent())).memories.length, 0)
      const { status } = await store.getMemory(designer(), proposal.id)
      assert.equal(status.needsRebuild, true)
    })

    it("supersession: recall returns the replacement while history stays inspectable", async () => {
      const { store, proposal } = await proposed()
      const first = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      const replacement = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content:
          "Show a visible label above every form field and keep it visible while people type.",
        evidence: first.evidence,
        rationale: {
          recurrence: "Same evidence, clearer wording.",
          expectedBenefit: "Clearer rule.",
          falsification: "Reviewers still raise it.",
        },
        lifecycle: { action: "supersede", targets: [first.id] },
        consolidator: { id: "manual", version: "1" },
      })
      const accepted = await store.acceptMemory(designer(), replacement.id, {
        expectedDigest: replacement.reviewDigest,
      })
      assert.deepEqual(accepted.supersedes, [first.id])
      const recalled = await store.recall(agent())
      assert.deepEqual(
        recalled.memories.map((item) => item.id),
        [replacement.id],
      )
      const old = await store.getMemory(designer(), first.id, { history: true })
      assert.equal(old.record.state, "accepted")
      assert.equal(old.record.supersededBy, undefined)
      assert.equal(old.status.superseded, true)
      assert.deepEqual(old.status.supersededBy, [replacement.id])
      assert.equal(old.status.recallEligible, false)
      assert.deepEqual(
        old.versions.map((version) => version.state),
        ["proposed", "accepted"],
      )
      const again = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content: "Keep a visible label above each field.",
        evidence: first.evidence,
        rationale: {
          recurrence: "Another rewording.",
          expectedBenefit: "None.",
          falsification: "None.",
        },
        lifecycle: { action: "supersede", targets: [first.id] },
        consolidator: { id: "manual", version: "1" },
      })
      await assert.rejects(
        store.acceptMemory(designer(), again.id, { expectedDigest: again.reviewDigest }),
        { code: "invalid_transition" },
      )
      await store.retireMemory(designer(), replacement.id, { reason: "No longer needed." })
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.equal((await store.getMemory(designer(), first.id)).status.superseded, true)
    })

    it("usage: recall records what an agent got, and a report is stored once", async () => {
      const { store, provider, proposal } = await proposed()
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })

      const recalled = await store.recall(agent(), { session: { id: "session-one" } })
      const [delivery] = await provider.readRecords("deliveries", { scope: SCOPE })
      const report = {
        reportId: "change-1",
        guidanceIds: [recalled.guidanceId],
        commitSha: "a".repeat(40),
        used: [{ deliveryId: recalled.memories[0].deliveryId }],
      }
      const first = await store.reportUsage(agent(), report)
      const again = await store.reportUsage(agent(), report)

      assert.equal(delivery.memoryId, proposal.id)
      assert.equal(delivery.text.includes(recalled.memories[0].content), true)
      assert.deepEqual([first.stored, again.stored], [true, false])
      await assert.rejects(store.reportUsage(agent(), { ...report, used: [] }), {
        code: "conflict",
      })
      const [used] = await provider.readRecords("usedLearnings", { scope: SCOPE })
      assert.equal(used.memoryId, proposal.id)
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("deletion: a deleted learning takes its usage records, and old guidance expires", async (t) => {
      let now = NOW
      const { store, provider, proposal } = await proposed(undefined, undefined)
      if (!provider.manifest().capabilities.includes(DELETE_CAPABILITY)) {
        t.skip("Provider does not delete records.")
        return
      }
      const clocked = await createLearningStore({ provider, clock: () => now })
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      const recalled = await clocked.recall(agent())
      await clocked.reportUsage(agent(), {
        reportId: "change-1",
        guidanceIds: [recalled.guidanceId],
        commitSha: "a".repeat(40),
        used: [{ deliveryId: recalled.memories[0].deliveryId }],
      })

      await clocked.deleteMemory(designer(), proposal.id, { reason: "The rule was wrong." })
      now += 366 * 24 * 60 * 60 * 1000
      const expired = await clocked.expireGuidance(designer())

      for (const stream of ["deliveries", "usedLearnings", "usageReports", "guidance"])
        assert.deepEqual(await provider.readRecords(stream, { scope: SCOPE }), [], stream)
      assert.equal(expired.records.guidance, 1)
      assert.equal(
        (await clocked.getMemory(designer(), proposal.id).catch((e) => e)).code,
        "not_found",
      )
      const checked = await clocked.verify(designer())
      assert.equal(checked.ok, true, JSON.stringify(checked.problems ?? checked))
    })

    it("no automatic learning: consolidation stores proposals only, and nothing is recalled", async () => {
      const { store, result } = await proposed()
      assert.equal(result.proposals.length, 1)
      assert.ok(result.proposals.every((record) => record.state === "proposed"))
      assert.equal((await store.recall(agent())).memories.length, 0)
      const listing = await store.queryMemory(designer())
      assert.ok(
        listing.every(
          ({ record, status }) => record.state === "proposed" && !status.recallEligible,
        ),
      )
    })

    it("reaches themes past the proposal budget while earlier ones wait for a person", async () => {
      const { store, proposal } = await proposed()
      const consolidator = {
        manifest: { id: "three-themes", version: "1" },
        async consolidate() {
          return {
            proposals: [1, 2, 3].map((number) => ({
              schemaVersion: SCHEMA_VERSIONS.memoryProposal,
              kind: "rule",
              themeKey: `theme-${number}`,
              content: `Rule ${number}.`,
              evidence: proposal.evidence,
              rationale: {
                recurrence: "Fixture.",
                expectedBenefit: "Fixture.",
                falsification: "None.",
              },
              lifecycle: NEW,
              consolidator: { id: "three-themes", version: "1" },
            })),
          }
        },
      }
      const runs = []
      for (let run = 1; run <= 3; run++)
        runs.push(
          await store.consolidate(agent(), { consolidator, window: WINDOW, maxProposals: 2 }),
        )
      assert.deepEqual(
        runs.map((run) => run.proposals.map((record) => record.themeKey)),
        [
          ["theme-1", "theme-2"],
          ["theme-1", "theme-2", "theme-3"],
          ["theme-1", "theme-2", "theme-3"],
        ],
      )
      assert.deepEqual(
        runs.map((run) => [run.changed.length, run.overBudget]),
        [
          [2, 1],
          [1, 0],
          [0, 0],
        ],
      )
      assert.match(runs[0].diagnostics.find((item) => item.code === "budget").message, /^1 /)
    })

    it("spends the proposal budget only on proposals it stores", async () => {
      const { store, proposal } = await proposed()
      function theme(key, evidence = proposal.evidence) {
        return {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          themeKey: key,
          content: `Rule for ${key}.`,
          evidence,
          rationale: {
            recurrence: "Fixture.",
            expectedBenefit: "Fixture.",
            falsification: "None.",
          },
          lifecycle: NEW,
          consolidator: { id: "budget-check", version: "1" },
        }
      }
      const missing = [
        { episodeId: proposal.evidence[0].episodeId, eventIds: ["ev_neverstored01"] },
      ]
      const run = await store.consolidate(agent(), {
        consolidator: {
          manifest: { id: "budget-check", version: "1" },
          async consolidate() {
            return { proposals: [theme("refused", missing), theme("first"), theme("second")] }
          },
        },
        window: WINDOW,
        maxProposals: 2,
      })
      assert.deepEqual(
        run.proposals.map((record) => record.themeKey),
        ["first", "second"],
      )
      assert.equal(run.overBudget, 0)
      assert.deepEqual(
        run.diagnostics.map((item) => [item.code, item.themeKey]),
        [["proposal_refused", "refused"]],
      )
    })

    it("stores only one of two imports that race with different contents under one snapshot ID", async () => {
      const { store, provider } = await open()
      const grantId = (await store.addGrant(designer(), grantInput())).id
      const partial = weekOneLog()
      partial.calls = partial.calls.slice(0, 2)
      const results = await Promise.allSettled(
        [weekOneLog(), partial].map((log) =>
          store.importHubReviewComments(agent(), log, { grantIds: [grantId] }),
        ),
      )
      assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"])
      const winner = results.find((result) => result.status === "fulfilled").value
      assert.match(
        results.find((result) => result.status === "rejected").reason.message,
        /already imported with different contents/,
      )
      assert.deepEqual(await provider.readRecords("collections", { scope: SCOPE }), [
        winner.collection,
      ])
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("window safety: a partial scan is incomplete, never empty", async () => {
      const { store } = await open()
      const grantId = (await store.addGrant(designer(), grantInput())).id
      const log = weekOneLog()
      log.calls = log.calls.slice(0, 2)
      const result = await store.importHubReviewComments(agent(), log, { grantIds: [grantId] })
      assert.equal(result.complete, false)
      assert.match(result.problems.join(" "), /more results remain/)
      const run = await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      assert.equal(run.status, "incomplete")
      assert.doesNotMatch(run.summary, /no theme met/i)
      const late = await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: { from: WINDOW.from, to: "2026-10-09T00:00:00.000000Z" },
      })
      assert.equal(late.status, "incomplete")
    })

    it("revision pinning: evidence names the prototype and Build the reviewer commented on", async () => {
      const { store, grantId, proposal } = await proposed()
      const builds = proposal.evidence.map(
        (reference) =>
          `${reference.source.prototypeId}#${reference.source.buildNumber}#${reference.source.commentId}`,
      )
      assert.deepEqual(builds.sort(), ["11#3#101", "11#3#102", "12#2#103", "13#5#104"])
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] })
      const { episodes } = await store.queryObservations(designer(), { purpose: "review" })
      assert.equal(
        episodes.find((episode) => episode.source.threadId === 101).source.buildNumber,
        3,
      )
      assert.equal(
        episodes.find((episode) => episode.source.threadId === 114).source.buildNumber,
        3,
      )
      assert.equal(
        episodes.find((episode) => episode.source.threadId === 114).source.prototypeId,
        12,
      )
    })

    it("untrusted input: comment text stays data and changes no setting or decision", async () => {
      const { store, result } = await proposed()
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const injected = events.find((event) => event.payload?.commentId === 108)
      assert.match(injected.payload.body, /Ignore all previous instructions/)
      assert.equal(store.manifest.id, (await fresh()).manifest().id)
      assert.ok(result.proposals.every((record) => !/Ignore all previous/.test(record.content)))
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.ok(!(await store.recall(agent())).text.includes("Ignore all previous"))
    })

    it("scope: one scope cannot read or change another scope's records", async () => {
      const { store, proposal } = await proposed()
      await assert.rejects(
        store.importHubReviewComments(agent(OTHER), weekOneLog(), {
          grantIds: ["grant_aaaaaaaa1"],
        }),
        LearningError,
      )
      await assert.rejects(
        store.acceptMemory(designer(OTHER), proposal.id, {
          expectedDigest: proposal.reviewDigest,
        }),
        { code: "not_found" },
      )
      assert.deepEqual(
        (await store.queryObservations(designer(OTHER), { purpose: "review" })).events,
        [],
      )
      const otherGrant = await store.addGrant(designer(OTHER), grantInput())
      await assert.rejects(
        store.importHubReviewComments(agent(OTHER), weekOneLog(), { grantIds: [otherGrant.id] }),
        { code: "scope_violation" },
      )
      const github = { host: "github.com", repository: REPOSITORY }
      const enterprise = { host: "ghe.example.com", repository: REPOSITORY }
      const hosted = await store.addGrant(designer(github), grantInput())
      await store.importHubReviewComments(agent(github), weekOneLog(), { grantIds: [hosted.id] })
      assert.ok(
        (await store.queryObservations(designer(github), { purpose: "review" })).events.length,
      )
      assert.deepEqual(
        (await store.queryObservations(designer(enterprise), { purpose: "review" })).events,
        [],
      )
      await assert.rejects(
        store.importHubReviewComments(agent(enterprise), weekOneLog(), {
          grantIds: [hosted.id],
        }),
        LearningError,
      )
    })

    it("redaction: a comment's text leaves every purpose but its digest still verifies", async () => {
      const { store, provider, proposal, grantId } = await proposed()
      if (!provider.manifest().capabilities.includes("observation.redact")) {
        await assert.rejects(
          store.redactComment(designer(), "ev_aaaaaaaa1", { reason: "The author asked." }),
          { code: "unsupported" },
        )
        return
      }
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      const copy = await store.exportRecords(designer(), {
        purpose: "instruction",
        destination: "copy.json",
      })
      const learnings = await store.exportRecords(designer(), {
        purpose: "instruction",
        destination: "learnings.json",
        contents: "learnings",
      })
      assert.equal(learnings.manifest.counts.memories, 1)
      assert.equal(learnings.manifest.counts.events, 0)
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const comment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 101,
      )
      const reason = "The author asked to remove it."
      await assert.rejects(store.redactComment(agent(), comment.id, { reason }), {
        code: "human_required",
      })
      const result = await store.redactComment(designer(), comment.id, { reason })
      const reply = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 102,
      )
      assert.equal(reply.episodeId, comment.episodeId)
      const [replyAfter] = await provider.readRecords("events", { scope: SCOPE, ids: [reply.id] })
      assert.deepEqual(
        replyAfter.payload,
        reply.payload,
        "a reply in the same thread keeps its text",
      )
      const labels = events.filter(
        (event) => event.type === "annotation" && event.parentEventId === comment.id,
      )
      assert.ok(labels.length)
      assert.deepEqual(
        [...result.redacted].sort(),
        [comment.id, ...labels.map((event) => event.id)].sort(),
      )
      assert.deepEqual(result.memoriesNeedingRebuild, [proposal.id])
      assert.deepEqual(
        result.exportsToFollowUp.map((item) => item.id).sort(),
        [copy.manifest.id, learnings.manifest.id].sort(),
      )
      const [stored] = await provider.readRecords("events", { scope: SCOPE, ids: [comment.id] })
      assert.equal(stored.payload, undefined)
      assert.equal(stored.digest, comment.digest)
      assert.equal(stored.redaction.reason, reason)
      for (const purpose of ["review", "instruction"]) {
        const after = await store.queryObservations(designer(), { purpose })
        assert.ok(!after.events.some((event) => result.redacted.includes(event.id)), purpose)
      }
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.equal((await store.verify(designer())).ok, true)
      const repeat = await store.redactComment(designer(), comment.id, { reason })
      assert.deepEqual(
        repeat,
        { ...result, redacted: [] },
        "a second call reports the same follow-ups",
      )
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.flatMap((entry) => entry.subjects.map((subject) => subject.id)).sort(),
        [...result.redacted].sort(),
        "each removal is audited once",
      )
      assert.ok(
        audits.every(
          (entry) => entry.reason === reason && entry.actor.id === designer().principal.id,
        ),
      )
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      const again = await store.queryObservations(designer(), { purpose: "review" })
      assert.ok(
        !again.events.some((event) => event.payload?.commentId === 101),
        "importing the same snapshot again does not bring the text back",
      )
    })

    it("redaction: comment removal and deleted imports read only redaction audit entries", async () => {
      let checking = false
      const reads = []
      const { store, provider, proposal, grantId } = await proposed((inner) => ({
        ...inner,
        async readRecords(stream, query) {
          if (checking && stream === "audit")
            assert.deepEqual(query.operations, ["evidence.redact"])
          const records = await inner.readRecords(stream, query)
          if (checking && stream === "audit") {
            assert.ok(records.every((entry) => entry.operation === "evidence.redact"))
            reads.push(records.length)
          }
          return records
        },
      }))
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      await store.recall(agent())
      const [recall] = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "memory.recall",
      )
      const history = Array.from({ length: 250 }, (_, index) =>
        sealRecord({
          ...recall,
          id: `audit_recallhistory${String(index).padStart(8, "0")}`,
        }),
      )
      await provider.appendRecords("audit", history)

      checking = true
      const removed = await store.redactHubComment(designer(), 101)
      assert.ok(removed.redacted.length > 0)
      assert.deepEqual((await store.redactHubComment(designer(), 101)).redacted, [])
      const options = { grantIds: [grantId], redactDeleted: true }
      const imported = await store.importHubReviewComments(agent(), weekTwoLog(), options)
      assert.ok(imported.redacted.length > 0)
      assert.deepEqual(
        (await store.importHubReviewComments(agent(), weekTwoLog(), options)).redacted,
        [],
      )
      assert.ok(reads.length >= 4)
      assert.ok(
        reads.every((length) => length <= removed.redacted.length + imported.redacted.length),
      )
      checking = false

      assert.equal(
        (await provider.readRecords("audit", { scope: SCOPE })).filter(
          (entry) => entry.operation === "memory.recall",
        ).length,
        history.length + 1,
        "every recall audit entry is retained",
      )
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("redaction: two people removing a comment at once remove and audit each event once", async () => {
      const { store, provider } = await proposed()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const comment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 101,
      )
      const chosen = events
        .filter(
          (event) =>
            event.id === comment.id ||
            (event.type === "annotation" && event.parentEventId === comment.id),
        )
        .map((event) => event.id)
        .sort()
      const results = await Promise.all(
        ["First.", "Second."].map((reason) =>
          store.redactComment(designer(), comment.id, { reason }),
        ),
      )
      const removed = results.flatMap((result) => result.redacted).sort()
      assert.deepEqual(removed, chosen, "each event was removed by exactly one call")
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.flatMap((entry) => entry.subjects.map((subject) => subject.id)).sort(),
        chosen,
        "each removal is audited once",
      )
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("redaction: an earlier audit entry in another form still counts", async () => {
      const { store, provider } = await proposed()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const comment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 101,
      )
      const chosen = events.filter(
        (event) =>
          event.id === comment.id ||
          (event.type === "annotation" && event.parentEventId === comment.id),
      )
      const note = {
        at: "2026-10-09T12:00:00.000000Z",
        by: designer().principal,
        reason: "Removed earlier.",
      }
      for (const event of chosen) {
        const copy = {
          ...event,
          redaction: {
            ...note,
            ...(event.type === "human_comment" ? { commentId: event.payload.commentId } : {}),
          },
        }
        delete copy.payload
        assert.deepEqual(await provider.redactRecord("events", copy), { redacted: true })
      }
      const manifest = provider.manifest()
      const earlier = sealRecord({
        schemaVersion: SCHEMA_VERSIONS.auditEntry,
        id: "audit_earlierform1",
        at: note.at,
        actor: note.by,
        operation: "evidence.redact",
        scope: SCOPE,
        subjects: chosen.map((event) => ({ kind: "event", id: event.id, digest: event.digest })),
        outcome: "ok",
        reason: note.reason,
        provider: { id: manifest.id, version: manifest.version },
      })
      await provider.appendRecords("audit", [earlier])
      const result = await store.redactComment(designer(), comment.id, { reason: "Asked again." })
      assert.deepEqual(result.redacted, [])
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.map((entry) => entry.id),
        [earlier.id],
      )
    })

    it("redaction: every version of an edited comment goes", async () => {
      const { store, provider, grantId } = await imported()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] })
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const versions = events.filter(
        (event) => event.type === "human_comment" && event.payload.commentId === 112,
      )
      assert.equal(versions.length, 2)
      const result = await store.redactComment(designer(), versions[1].id, {
        reason: "The author asked.",
      })
      assert.deepEqual([...result.redacted].sort(), versions.map((event) => event.id).sort())
    })

    it("redaction: a Hub comment ID removes every version and label, with no grant and no import", async () => {
      const { store, provider, grantId } = await proposed()
      if (!provider.manifest().capabilities.includes("observation.redact")) {
        await assert.rejects(store.redactHubComment(designer(), 112), { code: "unsupported" })
        return
      }
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] })
      await store.withdrawGrant(designer(), grantId, { purposes: grantInput().purposes })
      async function stored() {
        const streams = ["episodes", "events", "collections"]
        const records = await Promise.all(
          streams.map((stream) => provider.readRecords(stream, { scope: SCOPE })),
        )
        return Object.fromEntries(streams.map((stream, index) => [stream, records[index]]))
      }
      const before = await stored()
      const versions = before.events.filter(
        (event) => event.type === "human_comment" && event.payload.commentId === 112,
      )
      const labels = before.events.filter(
        (event) =>
          event.type === "annotation" &&
          versions.some((version) => version.id === event.parentEventId),
      )
      assert.equal(versions.length, 2)
      assert.equal(labels.length, 1)
      for (const commentId of [0, 1.5, "112"])
        await assert.rejects(store.redactHubComment(designer(), commentId), {
          code: "invalid_input",
        })
      await assert.rejects(store.redactHubComment(designer(), 112, { reason: " " }), {
        code: "invalid_input",
      })
      await assert.rejects(store.redactHubComment(agent(), 112), { code: "human_required" })

      const result = await store.redactHubComment(designer(), 112)
      const chosen = [...versions, ...labels].map((event) => event.id).sort()
      assert.deepEqual([...result.redacted].sort(), chosen)
      const after = await stored()
      assert.deepEqual(after.episodes, before.episodes)
      assert.deepEqual(after.collections, before.collections)
      assert.deepEqual(
        after.events.map((event) => event.id),
        before.events.map((event) => event.id),
        "it neither imports nor labels",
      )
      for (const event of after.events)
        if (chosen.includes(event.id)) {
          assert.equal(event.payload, undefined)
          assert.equal(event.redaction.reason, "The comment was deleted at its source.")
        } else
          assert.deepEqual(
            event,
            before.events.find((item) => item.id === event.id),
          )
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.flatMap((entry) => entry.subjects.map((subject) => subject.id)).sort(),
        chosen,
      )
      assert.equal((await store.verify(designer())).ok, true)
      assert.deepEqual(await store.redactHubComment(designer(), 112), { ...result, redacted: [] })
      assert.deepEqual(await store.redactHubComment(designer(), 999_999), {
        redacted: [],
        memoriesNeedingRebuild: [],
        exportsToFollowUp: [],
      })
    })

    it("redaction: refuses a history that links the comment to another one, and removes nothing", async () => {
      const { store, provider } = await imported()
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const stored = await provider.readRecords("events", { scope: SCOPE })
      function comment(id) {
        return stored.find(
          (event) => event.type === "human_comment" && event.payload.commentId === id,
        )
      }
      const [root, reply, elsewhere] = [comment(101), comment(102), comment(103)]
      assert.notEqual(elsewhere.episodeId, root.episodeId)
      for (const [name, previous] of [
        ["another comment in the thread", reply],
        ["a comment in another thread", elsewhere],
      ]) {
        const edit = sealEvent({
          ...root,
          id: `ev_forged${previous.payload.commentId}aa`,
          at: "2026-10-03T09:00:00.000000Z",
          payload: { ...root.payload, body: "Edited.", editedAt: "2026-10-03T09:00:00.000000Z" },
          supersedes: previous.id,
        })
        await provider.appendRecords("events", [edit])
        await assert.rejects(
          store.redactComment(designer(), edit.id, { reason: "The author asked." }),
          { code: "conflict" },
          name,
        )
        const after = await provider.readRecords("events", {
          scope: SCOPE,
          ids: [root.id, reply.id, elsewhere.id, edit.id],
        })
        assert.equal(after.length, 4)
        assert.ok(
          after.every((event) => event.payload !== undefined),
          `${name}: nothing was removed`,
        )
      }
    })

    it("export: records what left, holds back what was not permitted, and audits it", async () => {
      const { store, proposal } = await proposed()
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      await assert.rejects(
        store.exportRecords(agent(), { purpose: "instruction", destination: "out.json" }),
        { code: "human_required" },
      )
      const { manifest, bundle } = await store.exportRecords(designer(), {
        purpose: "instruction",
        destination: "out.json",
      })
      assert.equal(validateRecord("exportManifest", manifest).valid, true)
      assert.equal(manifest.contents, "all")
      assert.equal(manifest.counts.memories, 1)
      assert.equal(bundle.episodes.length, manifest.counts.episodes)
      assert.ok(bundle.episodes.every((episode) => validateRecord("episode", episode).valid))
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("export: a copy of learnings alone holds no review comments, and a withdrawal still finds it", async () => {
      const { store, grantId, proposal } = await proposed()
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      await assert.rejects(
        store.exportRecords(designer(), {
          purpose: "instruction",
          destination: "out.json",
          contents: "everything",
        }),
        { code: "invalid_input" },
      )
      const { manifest, bundle } = await store.exportRecords(designer(), {
        purpose: "instruction",
        destination: "memory-repo/replica/design-learnings.md",
        contents: "learnings",
      })
      assert.equal(validateRecord("exportManifest", manifest).valid, true)
      assert.equal(manifest.contents, "learnings")
      assert.deepEqual(bundle.episodes, [])
      assert.deepEqual(
        bundle.memories.map((memory) => memory.id),
        [proposal.id],
      )
      assert.deepEqual([...new Set(manifest.records.map((record) => record.kind))].sort(), [
        "grant",
        "memory",
      ])
      assert.deepEqual(
        [manifest.counts.episodes, manifest.counts.events, manifest.counts.memories],
        [0, 0, 1],
      )
      assert.deepEqual(
        bundle.grants.map((grant) => grant.id),
        [grantId],
      )
      assert.ok(!JSON.stringify(bundle).includes("vanish as soon as I type"))
      const { exportsToFollowUp } = await store.withdrawGrant(designer(), grantId, {
        purposes: ["instruction"],
      })
      assert.ok(exportsToFollowUp.some((item) => item.id === manifest.id))
    })
  })

  describe(`${name}: adversarial cases`, () => {
    async function proposedWith(wrap, clock) {
      const opened = await open(wrap, clock)
      const grantId = (await opened.store.addGrant(designer(), grantInput())).id
      await opened.store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      await opened.store.annotate(agent(), weekOneLabels().labels)
      const result = await opened.store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      return { ...opened, grantId, proposal: result.proposals[0] }
    }

    /** Week one, labelled, plus dissent on comment 110, which only the later of two grants covers. */
    async function proposedWithDissent() {
      const opened = await open()
      const { store } = opened
      const early = await store.addGrant(designer(), {
        ...grantInput(),
        evidenceUntil: "2026-10-03T00:00:00.000000Z",
      })
      const late = await store.addGrant(designer(), {
        ...grantInput(),
        evidenceFrom: "2026-10-03T00:00:00.000000Z",
      })
      await store.importHubReviewComments(agent(), weekOneLog(), {
        grantIds: [early.id, late.id],
      })
      await store.annotate(agent(), weekOneLabels().labels)
      await store.annotate(agent(), [dissent()])
      const { proposals } = await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      return { ...opened, early, late, proposal: proposals[0] }
    }

    it("fails closed when a provider returns a damaged withdrawal", async () => {
      let damage = false
      const { store, grantId, proposal } = await proposedWith((provider) => ({
        ...provider,
        manifest: () => provider.manifest(),
        async readRecords(stream, query) {
          const records = await provider.readRecords(stream, query)
          return damage && stream === "withdrawals"
            ? records.map((record) => ({ ...record, purposes: ["review"] }))
            : records
        },
      }))
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      await store.withdrawGrant(designer(), grantId, { purposes: ["instruction"] })
      damage = true
      await assert.rejects(store.recall(agent()), { code: "storage_corrupt" })
      assert.equal((await store.verify(designer())).ok, false)
      assert.equal((await store.status(designer())).counts, null)
    })

    it("writes no change whose audit entry the provider could not store", async () => {
      // An audit entry the provider already holds, sent again with other content, makes the
      // provider refuse the write it arrives with.
      let poison = null
      function poisoned(options = {}) {
        return poison ? { ...options, audit: [...(options.audit ?? []), poison] } : options
      }
      const { store, provider, proposal, grantId } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        appendRecords: (stream, records, options) =>
          inner.appendRecords(stream, records, poisoned(options)),
        appendBatch: (batch, options) => inner.appendBatch(batch, poisoned(options)),
        appendMemoryVersion: (record, options) =>
          inner.appendMemoryVersion(record, poisoned(options)),
      }))
      function manual(content) {
        return {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content,
          evidence: proposal.evidence,
          rationale: {
            recurrence: "Fixture.",
            expectedBenefit: "Fixture.",
            falsification: "None.",
          },
          lifecycle: NEW,
          consolidator: { id: "manual", version: "1" },
        }
      }
      const accepted = []
      for (const content of ["Keep each error next to its field.", "Group related fields."]) {
        const memory = await store.proposeMemory(designer(), manual(content))
        accepted.push(
          await store.acceptMemory(designer(), memory.id, { expectedDigest: memory.reviewDigest }),
        )
      }
      const [kept, replaced] = accepted
      await provider.appendRecords("audit", [auditEntry("audit_heldentry1")])
      async function stored() {
        const streams = {}
        for (const stream of Object.keys(STREAMS))
          streams[stream] = await provider.readRecords(stream, { scope: SCOPE })
        return { streams, memories: await provider.readMemoryVersions({ scope: SCOPE }) }
      }
      const before = await stored()
      poison = auditEntry("audit_heldentry1", "Another reason.")
      const review = { expectedDigest: proposal.reviewDigest }
      const attempts = {
        "memory.propose": () => store.proposeMemory(designer(), manual("Mark optional fields.")),
        "memory.accept": () => store.acceptMemory(designer(), proposal.id, review),
        "memory.reject": () =>
          store.rejectMemory(designer(), proposal.id, { ...review, reason: "Not ours." }),
        "memory.retire": () => store.retireMemory(designer(), kept.id, { reason: "Done." }),
        "memory.supersede": () => store.supersedeMemory(designer(), [replaced.id], kept.id),
        "grant.add": () => store.addGrant(designer(), grantInput()),
        "grant.withdraw": () =>
          store.withdrawGrant(designer(), grantId, { purposes: ["instruction"] }),
        "export.create": () =>
          store.exportRecords(designer(), { purpose: "review", destination: "out.json" }),
        "collection.import": () =>
          store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] }),
      }
      for (const [operation, attempt] of Object.entries(attempts)) {
        await assert.rejects(attempt(), { code: /^(conflict|stale_review)$/ }, operation)
        assert.deepEqual(await stored(), before, `${operation} changed nothing`)
      }
      poison = null
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("reports a change that has no audit entry", async () => {
      let drop = false
      function dropped(options = {}) {
        return drop ? without(options, "audit") : options
      }
      const { store, proposal } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        appendRecords: (stream, records, options) =>
          inner.appendRecords(stream, records, dropped(options)),
        appendMemoryVersion: (record, options) =>
          inner.appendMemoryVersion(record, dropped(options)),
      }))
      assert.deepEqual((await store.verify(designer())).problems, [])
      drop = true
      const added = await store.addGrant(designer(), grantInput())
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      assert.deepEqual((await store.verify(designer())).problems, [
        `grants ${added.id}: no grant.add audit entry records it`,
        `memories ${proposal.id}: no memory.accept audit entry records version 2`,
      ])
    })

    it("stores nothing from an import or appended observations when their events cannot be stored", async () => {
      let fail = false
      const refused = /the event write failed/
      const { store, provider } = await open((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async appendRecords(stream, records, options) {
          if (fail && stream === "events") throw new Error("the event write failed")
          return inner.appendRecords(stream, records, options)
        },
        async appendBatch(batch, options) {
          if (fail && batch.events?.length) throw new Error("the event write failed")
          return inner.appendBatch(batch, options)
        },
      }))
      async function stored() {
        return Promise.all(
          ["episodes", "events", "collections", "audit"].map((stream) =>
            provider.readRecords(stream, { scope: SCOPE }),
          ),
        )
      }
      const grantId = (await store.addGrant(designer(), grantInput())).id
      const empty = await stored()
      fail = true
      await assert.rejects(
        store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] }),
        refused,
      )
      assert.deepEqual(await stored(), empty)
      fail = false
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      const [episode] = await provider.readRecords("episodes", { scope: SCOPE })
      const [comment] = (await provider.readRecords("events", { scope: SCOPE })).filter(
        (event) => event.type === "human_comment" && event.episodeId === episode.id,
      )
      const imported = await stored()
      fail = true
      await assert.rejects(
        store.appendObservations(agent(), {
          episodes: [{ ...episode, id: "ep_appendedthread1" }],
          events: [{ ...comment, id: "ev_appendedcomment1", episodeId: "ep_appendedthread1" }],
        }),
        refused,
      )
      assert.deepEqual(await stored(), imported)
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("reports an episode or event that no audit entry records", async () => {
      const { store, provider } = await proposedWith()
      const [episode] = await provider.readRecords("episodes", { scope: SCOPE })
      const [comment] = (await provider.readRecords("events", { scope: SCOPE })).filter(
        (event) => event.type === "human_comment" && event.episodeId === episode.id,
      )
      const orphan = sealEpisode({ ...episode, id: "ep_orphanthread01" })
      const stray = sealEvent({ ...comment, id: "ev_straycomment01" })
      await provider.appendRecords("episodes", [orphan])
      await provider.appendRecords("events", [stray])
      assert.deepEqual((await store.verify(designer())).problems, [
        `episodes ${orphan.id}: no audit entry records it`,
        `events ${stray.id}: no audit entry records it`,
      ])
    })

    it("reports an audit entry that names a record the store does not hold", async () => {
      const { store, provider } = await proposedWith()
      const [collection] = await provider.readRecords("collections", { scope: SCOPE })
      const other = `sha256:${"0".repeat(64)}`
      const entry = sealRecord({
        ...auditEntry("audit_danglingentry1"),
        operation: "collection.import",
        subjects: [
          { kind: "collection", id: collection.id, digest: other },
          { kind: "grant", id: "grant_neverstored1" },
        ],
      })
      await provider.appendRecords("audit", [entry])
      assert.deepEqual((await store.verify(designer())).problems, [
        `audit ${entry.id}: collection ${collection.id} with digest ${other} is not stored`,
        `audit ${entry.id}: grant grant_neverstored1 is not stored`,
      ])
    })

    it("redaction: a call that fails part way is finished, and audited once, by the next", async () => {
      const failures = { redact: 0, audit: 0 }
      const { store, provider, proposal } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async redactRecord(stream, record) {
          const result = await inner.redactRecord(stream, record)
          if (failures.redact > 0) {
            failures.redact -= 1
            throw new Error("The connection dropped after the write.")
          }
          return result
        },
        async appendRecords(stream, records, options) {
          if (stream === "audit" && failures.audit > 0) {
            failures.audit -= 1
            throw new Error("The audit write failed.")
          }
          return inner.appendRecords(stream, records, options)
        },
      }))
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      const learnings = await store.exportRecords(designer(), {
        purpose: "instruction",
        destination: "learnings.json",
        contents: "learnings",
      })
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const comment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 101,
      )
      const reason = "The author asked."
      failures.redact = 1
      await assert.rejects(store.redactComment(designer(), comment.id, { reason }), /dropped/)
      failures.audit = 1
      await assert.rejects(store.redactComment(designer(), comment.id, { reason }), /audit/)
      const interrupted = await store.verify(designer())
      assert.equal(interrupted.ok, false)
      assert.ok(interrupted.problems.some((problem) => problem.includes("no evidence.redact")))
      const finished = await store.redactComment(designer(), comment.id, { reason })
      assert.deepEqual(finished.redacted, [])
      assert.deepEqual(finished.memoriesNeedingRebuild, [proposal.id])
      assert.deepEqual(
        finished.exportsToFollowUp.map((item) => item.id),
        [learnings.manifest.id],
      )
      const chosen = events.filter(
        (event) =>
          event.id === comment.id ||
          (event.type === "annotation" && event.parentEventId === comment.id),
      )
      const stored = await provider.readRecords("events", {
        scope: SCOPE,
        ids: chosen.map((event) => event.id),
      })
      assert.ok(stored.every((event) => event.payload === undefined))
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.flatMap((entry) => entry.subjects.map((subject) => subject.id)).sort(),
        chosen.map((event) => event.id).sort(),
        "each removal is audited once",
      )
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("redaction: a retry still finds a version of the comment that no edit link joins", async () => {
      const failures = { redact: 0 }
      const { store, provider } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async redactRecord(stream, record) {
          const result = await inner.redactRecord(stream, record)
          if (failures.redact > 0) {
            failures.redact -= 1
            throw new Error("The connection dropped after the write.")
          }
          return result
        },
      }))
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const root = (await provider.readRecords("events", { scope: SCOPE })).find(
        (event) => event.type === "human_comment" && event.payload.commentId === 101,
      )
      const unlinked = sealEvent({
        ...root,
        id: "ev_unlinked101a",
        at: "2026-10-02T09:00:00.000000Z",
        payload: {
          ...root.payload,
          body: "The same comment, stored again with no edit link.",
          editedAt: "2026-10-02T09:00:00.000000Z",
        },
      })
      await provider.appendRecords("events", [unlinked])
      const copy = await store.exportRecords(designer(), {
        purpose: "review",
        destination: "copy.json",
      })
      assert.ok(copy.manifest.records.some((record) => record.id === unlinked.id))
      const reason = "The author asked."
      failures.redact = 1
      await assert.rejects(store.redactComment(designer(), root.id, { reason }), /dropped/)
      const [first] = await provider.readRecords("events", { scope: SCOPE, ids: [root.id] })
      assert.equal(first.payload, undefined, "the first call removed the comment it was given")
      assert.equal(first.redaction.commentId, 101)
      const retry = await store.redactComment(designer(), root.id, { reason })
      assert.ok(retry.redacted.includes(unlinked.id))
      assert.ok(retry.exportsToFollowUp.some((item) => item.id === copy.manifest.id))
      const [after] = await provider.readRecords("events", { scope: SCOPE, ids: [unlinked.id] })
      assert.equal(after.payload, undefined)
    })

    /** The IDs of comment 107, which week two deletes, and of the labels on it, sorted. */
    async function deletedInWeekTwo(store) {
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const comment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 107,
      )
      const labels = events.filter(
        (event) => event.type === "annotation" && event.parentEventId === comment.id,
      )
      assert.ok(labels.length)
      return { comment, ids: [comment.id, ...labels.map((event) => event.id)].sort() }
    }

    it("redaction: an import retries missing audit entries after all deleted text is gone", async () => {
      let fail = true
      const { store, provider, grantId } = await proposedWith((inner) => ({
        ...inner,
        async appendRecords(stream, records, options) {
          if (
            fail &&
            stream === "audit" &&
            records.some((record) => record.operation === "evidence.redact")
          )
            throw new Error("The audit write failed.")
          return inner.appendRecords(stream, records, options)
        },
      }))
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const options = { grantIds: [grantId], redactDeleted: true }
      await assert.rejects(
        store.importHubReviewComments(agent(), weekTwoLog(), options),
        /audit write/,
      )
      assert.equal((await store.verify(designer())).ok, false)
      fail = false
      const finished = await store.importHubReviewComments(agent(), weekTwoLog(), options)
      assert.deepEqual(finished.redacted, [])
      assert.equal((await store.verify(designer())).ok, true)
      const receipts = await provider.readRecords("audit", { scope: SCOPE })
      await store.importHubReviewComments(agent(), weekTwoLog(), options)
      assert.equal(
        (await provider.readRecords("audit", { scope: SCOPE })).filter(
          (entry) => entry.operation === "evidence.redact",
        ).length,
        receipts.filter((entry) => entry.operation === "evidence.redact").length,
      )
    })

    it("redaction: an import that asks removes the text of comments deleted at the source", async () => {
      const { store, provider, grantId } = await proposedWith()
      const options = { grantIds: [grantId], redactDeleted: true }
      if (!provider.manifest().capabilities.includes("observation.redact")) {
        await assert.rejects(store.importHubReviewComments(agent(), weekTwoLog(), options), {
          code: "unsupported",
        })
        const plain = await store.importHubReviewComments(agent(), weekTwoLog(), {
          grantIds: [grantId],
        })
        assert.ok(plain.addedEvents > 0, "the refused import wrote nothing")
        return
      }
      const copy = await store.exportRecords(designer(), {
        purpose: "review",
        destination: "copy.json",
      })
      const { comment, ids } = await deletedInWeekTwo(store)
      const kept = await store.importHubReviewComments(agent(), weekTwoLog(), {
        grantIds: [grantId],
      })
      assert.deepEqual(kept.redacted, [])
      const [retracted] = await provider.readRecords("events", { scope: SCOPE, ids: [comment.id] })
      assert.deepEqual(retracted.payload, comment.payload, "a deletion alone keeps the text")

      const result = await store.importHubReviewComments(agent(), weekTwoLog(), options)
      assert.deepEqual([...result.redacted].sort(), ids)
      assert.deepEqual(
        result.exportsToFollowUp.map((item) => item.id),
        [copy.manifest.id],
      )
      for (const event of await provider.readRecords("events", { scope: SCOPE, ids })) {
        assert.equal(event.payload, undefined)
        assert.deepEqual(event.redaction.by, agent().principal)
        assert.equal(event.redaction.reason, "The comment was deleted at its source.")
      }
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.flatMap((entry) => entry.subjects.map((subject) => subject.id)).sort(),
        ids,
      )
      assert.equal((await store.verify(designer())).ok, true)
      const after = await store.exportRecords(designer(), {
        purpose: "review",
        destination: "after.json",
      })
      assert.deepEqual(
        after.manifest.excluded.find((item) => item.reason === "event-redacted"),
        { reason: "event-redacted", count: ids.length },
        "a comment both deleted and removed is held back once",
      )
      const again = await store.importHubReviewComments(agent(), weekTwoLog(), options)
      assert.deepEqual(
        [again.addedEvents, again.redacted, again.exportsToFollowUp],
        [0, [], []],
        "a removed comment is not imported anew, and nothing is left to remove",
      )
    })

    it("redaction: an import cut short while removing deleted text is finished by the next", async () => {
      const failures = { redact: 0 }
      const { store, provider, grantId } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async redactRecord(stream, record) {
          const result = await inner.redactRecord(stream, record)
          if (failures.redact > 0) {
            failures.redact -= 1
            throw new Error("The connection dropped after the write.")
          }
          return result
        },
      }))
      if (!provider.manifest().capabilities.includes("observation.redact")) return
      const { comment, ids } = await deletedInWeekTwo(store)
      const options = { grantIds: [grantId], redactDeleted: true }
      async function imports() {
        const audit = await provider.readRecords("audit", { scope: SCOPE })
        return audit.filter((entry) => entry.operation === "collection.import").length
      }
      const before = await imports()
      failures.redact = 1
      await assert.rejects(store.importHubReviewComments(agent(), weekTwoLog(), options), /dropped/)
      assert.equal(await imports(), before + 1, "the import was audited before the removal failed")
      const [first] = await provider.readRecords("events", { scope: SCOPE, ids: [comment.id] })
      assert.equal(first.payload, undefined, "the comment went first, and its labels kept text")

      const finished = await store.importHubReviewComments(agent(), weekTwoLog(), options)
      assert.deepEqual(
        [...finished.redacted].sort(),
        ids.filter((id) => id !== comment.id),
      )
      const stored = await provider.readRecords("events", { scope: SCOPE, ids })
      assert.ok(stored.every((event) => event.payload === undefined))
      const audits = (await provider.readRecords("audit", { scope: SCOPE })).filter(
        (entry) => entry.operation === "evidence.redact",
      )
      assert.deepEqual(
        audits.flatMap((entry) => entry.subjects.map((subject) => subject.id)).sort(),
        ids,
        "each removal is audited once",
      )
    })

    it("never recalls an approval that no person made", async () => {
      const { store, provider, proposal } = await proposedWith()
      const forged = sealMemory({
        ...proposal,
        version: 2,
        previousDigest: proposal.digest,
        state: "accepted",
        accepted: {
          by: { kind: "agent", id: "agent:copilot" },
          at: "2026-10-09T12:00:00.000000Z",
          contentDigest: proposal.contentDigest,
          reviewedDigest: proposal.reviewDigest,
          edited: false,
        },
      })
      await provider.appendMemoryVersion(forged, { expectedPreviousDigest: proposal.digest })
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.ok(
        (await store.verify(designer())).problems.some((problem) => problem.includes(proposal.id)),
      )
    })

    it("never recalls an approval of something other than the version reviewed", async () => {
      const { store, provider, proposal } = await proposedWith()
      const forged = sealMemory({
        ...proposal,
        version: 2,
        previousDigest: proposal.digest,
        state: "accepted",
        content: "Use placeholder text instead of labels.",
        accepted: {
          by: { kind: "human", id: "github:ana-designer" },
          at: "2026-10-09T12:00:00.000000Z",
          contentDigest: "sha256:" + "0".repeat(64),
          reviewedDigest: proposal.reviewDigest,
          edited: false,
        },
      })
      forged.accepted.contentDigest = forged.contentDigest
      await provider.appendMemoryVersion(sealMemory(forged), {
        expectedPreviousDigest: proposal.digest,
      })
      assert.equal((await store.recall(agent())).memories.length, 0)
    })

    it("applies a grant's time bounds to each comment, not to its thread", async () => {
      const { store } = await open()
      const bounded = await store.addGrant(designer(), {
        ...grantInput(),
        evidenceUntil: "2026-09-30T10:30:00.000000Z",
      })
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [bounded.id] })
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      assert.deepEqual(
        events
          .filter((event) => event.type === "human_comment")
          .map((event) => event.payload.commentId),
        [101],
      )
    })

    it("refuses evidence whose pin does not match the stored records", async () => {
      const { store, proposal } = await proposedWith()
      const forged = structuredClone(proposal.evidence)
      forged[0].source.prototypeId = 999
      forged[0].source.buildNumber = 777
      await assert.rejects(
        store.proposeMemory(designer(), {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content: "A different learning.",
          evidence: forged,
          rationale: { recurrence: "Forged.", expectedBenefit: "None.", falsification: "Always." },
          lifecycle: { action: "new" },
          consolidator: { id: "manual", version: "1" },
        }),
        { code: "invalid_input" },
      )
      const moved = structuredClone(proposal.evidence)
      moved[0].episodeId =
        moved[1].episodeId === moved[0].episodeId ? moved[2].episodeId : moved[1].episodeId
      delete moved[0].source
      await assert.rejects(
        store.proposeMemory(designer(), {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content: "Evidence from another thread.",
          evidence: [moved[0]],
          rationale: { recurrence: "Moved.", expectedBenefit: "None.", falsification: "Always." },
          lifecycle: { action: "new" },
          consolidator: { id: "manual", version: "1" },
        }),
        { code: "purpose_not_granted" },
      )
    })

    it("stops using a label once the comment it judges is retracted", async () => {
      const { store, grantId } = await proposedWith()
      const { events } = await store.queryObservations(designer(), { purpose: "instruction" })
      const praise = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 107,
      )
      const label = events.find(
        (event) => event.type === "annotation" && event.payload.target.eventId === praise.id,
      )
      const memory = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "example",
        content: "Illustrations on welcome steps land well.",
        evidence: [{ episodeId: label.episodeId, eventIds: [label.id] }],
        rationale: {
          recurrence: "One label.",
          expectedBenefit: "Example.",
          falsification: "Reviewers object.",
        },
        lifecycle: { action: "new" },
        consolidator: { id: "manual", version: "1" },
      })
      await store.acceptMemory(designer(), memory.id, { expectedDigest: memory.reviewDigest })
      assert.equal((await store.recall(agent())).memories.length, 1)
      await store.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grantId] })
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.equal((await store.getMemory(designer(), memory.id)).status.needsRebuild, true)
    })

    it("refreshes a proposal when new dissent arrives, so an older review is stale", async () => {
      const { store, proposal } = await proposedWith()
      await store.annotate(agent(), [
        {
          target: { commentId: 110 },
          theme: { key: "visible-form-labels", statement: "Labels can stay inside short inputs." },
          signal: "accessibility",
          observation: "observed",
          stance: "contradicts",
        },
      ])
      const run = await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      const [revised] = run.proposals
      assert.equal(revised.id, proposal.id)
      assert.equal(revised.version, 2)
      assert.equal(revised.contradictions.length, 1)
      assert.notEqual(revised.reviewDigest, proposal.reviewDigest)
      await assert.rejects(
        store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest }),
        { code: "stale_review" },
      )
    })

    it("recalls only one of two replacements accepted for the same learning", async () => {
      const { store, proposal } = await proposedWith()
      const original = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      function replacement(content) {
        return store.proposeMemory(designer(), {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content,
          evidence: original.evidence,
          rationale: {
            recurrence: "Rewording.",
            expectedBenefit: "Clarity.",
            falsification: "Confusion.",
          },
          lifecycle: { action: "supersede", targets: [original.id] },
          consolidator: { id: "manual", version: "1" },
        })
      }
      const left = await replacement("Keep every form label visible above its field.")
      const right = await replacement("Place a persistent label above each input.")
      const results = await Promise.allSettled([
        store.acceptMemory(designer(), left.id, { expectedDigest: left.reviewDigest }),
        store.acceptMemory(designer(), right.id, { expectedDigest: right.reviewDigest }),
      ])
      assert.ok(results.some((result) => result.status === "fulfilled"))
      const recalled = await store.recall(agent())
      assert.equal(recalled.memories.length, 1)
      assert.ok([left.id, right.id].includes(recalled.memories[0].id))
      assert.ok(!recalled.memories.some((memory) => memory.id === original.id))
    })

    it("stops recalling a learning once its counterevidence may not be used", async () => {
      const { store, late, proposal } = await proposedWithDissent()
      assert.equal(proposal.contradictions.length, 1)
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      assert.equal((await store.recall(agent())).memories.length, 1)
      await store.withdrawGrant(designer(), late.id, { purposes: ["instruction"] })
      const comments = (
        await store.queryObservations(designer(), { purpose: "instruction" })
      ).events.filter((event) => event.type === "human_comment")
      assert.ok(comments.some((event) => event.payload.commentId === 101))
      assert.ok(!comments.some((event) => event.payload.commentId === 110))
      assert.equal((await store.recall(agent())).memories.length, 0)
      const reading = await store.getMemory(designer(), proposal.id, { purpose: "instruction" })
      assert.equal(reading.status.needsRebuild, true)
      assert.equal(reading.withheld, true)
      assert.equal(reading.record.contradictions, undefined)
    })

    it("shows each version of a learning's history only as far as the purpose allows", async () => {
      const { store, late, proposal } = await proposedWithDissent()
      await store.withdrawGrant(designer(), late.id, { purposes: ["instruction"] })
      const [revised] = (
        await store.consolidate(agent(), {
          consolidator: createRecurrenceConsolidator(),
          window: WINDOW,
        })
      ).proposals
      assert.equal(revised.id, proposal.id)
      assert.equal(revised.version, 2)
      assert.equal((revised.contradictions ?? []).length, 0)
      const instruction = await store.getMemory(designer(), proposal.id, {
        history: true,
        purpose: "instruction",
      })
      assert.equal(instruction.withheld, false)
      const [first, second] = instruction.versions
      assert.equal(first.withheld, true)
      for (const field of ["content", "evidence", "contradictions", "proposal"])
        assert.equal(first[field], undefined, field)
      assert.equal(second.withheld, undefined)
      assert.equal(second.content, revised.content)
      const review = await store.getMemory(designer(), proposal.id, {
        history: true,
        purpose: "review",
      })
      assert.equal(review.versions[0].contradictions.length, 1)
    })

    it("never recalls an acceptance that changes more than the reviewed text", async () => {
      const variants = [
        [
          "different evidence behind an edit",
          (proposal) => ({
            content: "Reworded, so the evidence change hides behind an edit.",
            evidence: proposal.evidence.slice(1),
            edited: true,
          }),
        ],
        ["a replacement nobody reviewed", () => ({ supersedes: ["mem_aaaaaaaa1"], edited: false })],
        ["an edit flag without an edit", () => ({ edited: true })],
      ]
      for (const [label, change] of variants) {
        const { store, provider, proposal } = await proposedWith()
        const { edited, ...fields } = change(proposal)
        const forged = sealMemory({
          ...proposal,
          ...fields,
          version: 2,
          previousDigest: proposal.digest,
          state: "accepted",
          accepted: {
            by: { kind: "human", id: "github:ana-designer" },
            at: "2026-10-09T12:00:00.000000Z",
            contentDigest: `sha256:${"0".repeat(64)}`,
            reviewedDigest: proposal.reviewDigest,
            edited,
          },
        })
        forged.accepted.contentDigest = forged.contentDigest
        await provider.appendMemoryVersion(sealMemory(forged), {
          expectedPreviousDigest: proposal.digest,
        })
        assert.equal((await store.recall(agent())).memories.length, 0, label)
        assert.equal((await store.verify(designer())).ok, false, label)
      }
    })

    it("refuses a proposal that would replace learnings its review digest does not show", async () => {
      const { store, provider, proposal } = await proposedWith()
      const hidden = sealMemory({
        ...proposal,
        version: 2,
        previousDigest: proposal.digest,
        supersedes: ["mem_aaaaaaaa1"],
      })
      assert.equal(hidden.reviewDigest, proposal.reviewDigest)
      await provider.appendMemoryVersion(hidden, { expectedPreviousDigest: proposal.digest })
      await assert.rejects(
        store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest }),
        { code: "invalid_record" },
      )
    })

    it("lets a losing merge remove nothing it did not win", async () => {
      let now = NOW
      let frozen = null
      const { store, provider, proposal } = await proposedWith(
        (inner) => ({
          ...inner,
          manifest: () => inner.manifest(),
          async readMemoryVersions(query) {
            const versions = frozen ?? (await inner.readMemoryVersions(query))
            return query.ids ? versions.filter((item) => query.ids.includes(item.id)) : versions
          },
        }),
        () => now,
      )
      function propose(content, lifecycle, evidence) {
        return store.proposeMemory(designer(), {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content,
          evidence,
          rationale: {
            recurrence: "Fixture.",
            expectedBenefit: "Fixture.",
            falsification: "None.",
          },
          lifecycle,
          consolidator: { id: "manual", version: "1" },
        })
      }
      function accept(memory) {
        now += 1000
        return store.acceptMemory(designer(), memory.id, { expectedDigest: memory.reviewDigest })
      }
      const labels = await accept(proposal)
      const errors = await accept(
        await propose(
          "Keep each error message next to its field.",
          { action: "new" },
          labels.evidence,
        ),
      )
      const reworded = await propose(
        "Keep every form label visible above its field.",
        { action: "supersede", targets: [labels.id] },
        labels.evidence,
      )
      const merged = await propose(
        "Label every field and keep its errors beside it.",
        { action: "merge", targets: [labels.id, errors.id] },
        labels.evidence,
      )
      frozen = await provider.readMemoryVersions({ scope: SCOPE })
      await accept(reworded)
      await accept(merged)
      frozen = null
      assert.deepEqual(
        (await store.recall(agent())).memories.map((memory) => memory.id).sort(),
        [reworded.id, errors.id].sort(),
      )
      await assertExportMatchesRecall(store)
      const loser = await store.getMemory(designer(), merged.id)
      assert.equal(loser.record.state, "accepted")
      assert.equal(loser.status.recallEligible, false)
      assert.equal(loser.status.inEffect, false)
      assert.deepEqual(loser.status.conflicts, [`${reworded.id} replaced ${labels.id} first`])
      assert.equal((await store.getMemory(designer(), errors.id)).status.superseded, false)
      assert.deepEqual((await store.getMemory(designer(), labels.id)).status.supersededBy, [
        reworded.id,
      ])
    })

    it("reads redacted events without failing and never uses them as evidence", async () => {
      const hide = { annotations: false, commentIds: [] }
      function hidden(record) {
        return (
          (hide.annotations && record.type === "annotation") ||
          hide.commentIds.includes(record.payload?.commentId)
        )
      }
      const { store, proposal } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async readRecords(stream, query) {
          const records = await inner.readRecords(stream, query)
          return stream === "events"
            ? records.map((record) => (hidden(record) ? redacted(record) : record))
            : records
        },
      }))
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      hide.annotations = true
      const hiddenLabels = await store.verify(designer())
      assert.equal(hiddenLabels.ok, false)
      assert.ok(hiddenLabels.problems.every((problem) => problem.includes("no evidence.redact")))
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      assert.ok(!events.some((event) => event.type === "annotation"))
      assert.equal((await store.recall(agent())).memories.length, 1, "labels are not evidence")
      await store.annotate(agent(), [dissent()])
      await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      hide.commentIds = [101]
      const hiddenComment = await store.verify(designer())
      assert.equal(hiddenComment.ok, false)
      assert.ok(hiddenComment.problems.every((problem) => problem.includes("no evidence.redact")))
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.equal((await store.getMemory(designer(), proposal.id)).status.needsRebuild, true)
      assert.notEqual((await store.status(designer())).counts, null)
    })

    it("keeps a retraction in force when its payload is redacted, and needs its target", async () => {
      const hide = { retractions: false }
      const { store, provider, proposal } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async readRecords(stream, query) {
          const records = await inner.readRecords(stream, query)
          return stream === "events" && hide.retractions
            ? records.map((record) => (record.type === "retraction" ? redacted(record) : record))
            : records
        },
      }))
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      const { events } = await store.queryObservations(designer(), { purpose: "review" })
      const comment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 101,
      )
      await store.appendObservations(agent(), {
        events: [retractionOf(comment, "ev_retracts101")],
      })
      assert.equal((await store.recall(agent())).memories.length, 0)
      hide.retractions = true
      assert.deepEqual((await store.verify(designer())).problems, [
        "events ev_retracts101: no evidence.redact audit entry records its redaction",
      ])
      assert.equal((await store.recall(agent())).memories.length, 0)
      assert.equal((await store.getMemory(designer(), proposal.id)).status.needsRebuild, true)
      const unbound = retractionOf(comment, "ev_unbound101")
      delete unbound.parentEventId
      await provider.appendRecords("events", [sealEvent(unbound)])
      await assert.rejects(store.recall(agent()), { code: "storage_corrupt" })
      assert.equal((await store.verify(designer())).ok, false)
    })

    it("never shows a damaged learning's content, now or in its history", async () => {
      const damage = { evidence: false }
      const { store, grantId, proposal } = await proposedWith((inner) => ({
        ...inner,
        manifest: () => inner.manifest(),
        async readMemoryVersions(query) {
          const versions = await inner.readMemoryVersions(query)
          return damage.evidence
            ? versions.map((version) => without(version, "evidence"))
            : versions
        },
      }))
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      damage.evidence = true
      assert.equal((await store.verify(designer())).ok, false)
      assert.equal((await store.recall(agent())).memories.length, 0)
      function assertMetadataOnly(reading) {
        assert.equal(reading.withheld, true)
        assert.ok(reading.status.problems.length)
        assert.ok(Object.keys(reading.record).every((key) => METADATA_KEYS.includes(key)))
        for (const version of reading.versions ?? []) {
          assert.equal(version.withheld, true)
          assert.ok(
            Object.keys(version).every((key) => [...METADATA_KEYS, "withheld"].includes(key)),
          )
        }
      }
      for (const purpose of ["review", "instruction"])
        assertMetadataOnly(
          await store.getMemory(designer(), proposal.id, { purpose, history: true }),
        )
      assertMetadataOnly((await store.queryMemory(designer()))[0])
      await store.withdrawGrant(designer(), grantId, { purposes: ["review", "instruction"] })
      assertMetadataOnly(await store.getMemory(designer(), proposal.id, { history: true }))
    })

    it("keeps one learning in recall when two racing replacements form a cycle", async () => {
      let frozen = null
      const { store, provider, proposal } = await proposedWith((inner) => ({
        ...inner,
        async readMemoryVersions(query) {
          const versions = frozen ?? (await inner.readMemoryVersions(query))
          return query.ids ? versions.filter((version) => query.ids.includes(version.id)) : versions
        },
      }))
      const first = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      const pending = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content: "Keep each form label visible above its input.",
        evidence: first.evidence,
        rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
        lifecycle: NEW,
        consolidator: { id: "manual", version: "1" },
      })
      const second = await store.acceptMemory(designer(), pending.id, {
        expectedDigest: pending.reviewDigest,
      })
      frozen = await provider.readMemoryVersions({ scope: SCOPE })
      await Promise.all([
        store.supersedeMemory(designer(), [first.id], second.id),
        store.supersedeMemory(designer(), [second.id], first.id),
      ])
      frozen = null
      const items = await store.queryMemory(designer())
      assert.equal(items.filter((item) => item.status.recallEligible).length, 1)
      assert.equal(items.filter((item) => item.status.conflicts.length).length, 1)
      assert.equal((await store.recall(agent())).memories.length, 1)
      await assertExportMatchesRecall(store)
      assert.equal((await store.verify(designer())).ok, true)
    })

    it("records what a learning replaces once, so a later step never undoes it", async () => {
      let now = NOW
      let frozen = null
      const { store, provider, proposal } = await proposedWith(
        (inner) => ({
          ...inner,
          manifest: () => inner.manifest(),
          async readMemoryVersions(query) {
            const versions = frozen ?? (await inner.readMemoryVersions(query))
            return query.ids ? versions.filter((item) => query.ids.includes(item.id)) : versions
          },
        }),
        () => now,
      )
      async function accepted(content, lifecycle, evidence) {
        const memory = await store.proposeMemory(designer(), {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content,
          evidence,
          rationale: {
            recurrence: "Fixture.",
            expectedBenefit: "Fixture.",
            falsification: "None.",
          },
          lifecycle,
          consolidator: { id: "manual", version: "1" },
        })
        now += 1000
        return store.acceptMemory(designer(), memory.id, { expectedDigest: memory.reviewDigest })
      }
      now += 1000
      const labels = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      const { evidence } = labels
      const reworded = await accepted(
        "Keep every form label visible above its field.",
        { action: "supersede", targets: [labels.id] },
        evidence,
      )
      const errors = await accepted("Keep each error message next to its field.", NEW, evidence)
      const grouping = await accepted("Group related fields under a heading.", NEW, evidence)
      const optional = await accepted("Mark optional fields, not required ones.", NEW, evidence)
      await assert.rejects(store.supersedeMemory(designer(), [grouping.id], reworded.id), {
        code: "invalid_transition",
      })
      frozen = await provider.readMemoryVersions({ scope: SCOPE })
      now += 1000
      await store.supersedeMemory(designer(), [grouping.id], errors.id)
      now += 1000
      await store.supersedeMemory(designer(), [grouping.id], optional.id)
      frozen = null
      assert.deepEqual(
        (await store.recall(agent())).memories.map((memory) => memory.id).sort(),
        [reworded.id, errors.id, optional.id].sort(),
      )
      await assertExportMatchesRecall(store)
      const lost = await store.getMemory(designer(), optional.id)
      assert.equal(lost.status.recallEligible, true)
      assert.equal(lost.status.inEffect, true)
      assert.deepEqual(lost.status.conflicts, [`${errors.id} replaced ${grouping.id} first`])
      assert.deepEqual((await store.getMemory(designer(), grouping.id)).status.supersededBy, [
        errors.id,
      ])
      assert.deepEqual((await store.getMemory(designer(), labels.id)).status.supersededBy, [
        reworded.id,
      ])
    })

    it("lets only a learning recall uses replace one it uses", async () => {
      let now = NOW
      const { store } = await open(undefined, () => now)
      const early = await store.addGrant(designer(), {
        ...grantInput(),
        evidenceUntil: "2026-10-03T00:00:00.000000Z",
      })
      const late = await store.addGrant(designer(), {
        ...grantInput(),
        evidenceFrom: "2026-10-03T00:00:00.000000Z",
      })
      await store.importHubReviewComments(agent(), weekOneLog(), {
        grantIds: [early.id, late.id],
      })
      await store.annotate(agent(), weekOneLabels().labels)
      const {
        proposals: [proposal],
      } = await store.consolidate(agent(), {
        consolidator: createRecurrenceConsolidator(),
        window: WINDOW,
      })
      const kept = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      const { events } = await store.queryObservations(designer(), { purpose: "instruction" })
      const lateComment = events.find(
        (event) => event.type === "human_comment" && event.payload.commentId === 105,
      )
      function manual(content, extra) {
        return {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content,
          evidence: kept.evidence,
          rationale: {
            recurrence: "Fixture.",
            expectedBenefit: "Fixture.",
            falsification: "None.",
          },
          lifecycle: NEW,
          consolidator: { id: "manual", version: "1" },
          ...extra,
        }
      }
      async function accepted(content, extra) {
        const memory = await store.proposeMemory(designer(), manual(content, extra))
        return store.acceptMemory(designer(), memory.id, { expectedDigest: memory.reviewDigest })
      }
      const expired = await accepted("Keep each label visible.", {
        expiresAt: "2026-10-09T13:00:00.000000Z",
      })
      const future = await accepted("Keep each label above its field.", {
        validFrom: "2026-10-10T12:00:00.000000Z",
      })
      const withdrawn = await accepted("Label every field.", {
        evidence: [{ episodeId: lateComment.episodeId, eventIds: [lateComment.id] }],
      })
      await store.withdrawGrant(designer(), late.id, { purposes: ["instruction"] })
      now = Date.parse("2026-10-09T14:00:00Z")
      for (const [replacement, reason] of [
        [expired, /it has expired/],
        [future, /it does not apply yet/],
        [withdrawn, /its evidence no longer permits instruction/],
      ])
        await assert.rejects(store.supersedeMemory(designer(), [kept.id], replacement.id), {
          code: "invalid_transition",
          message: reason,
        })
      for (const [extra, reason] of [
        [{ expiresAt: "2026-10-09T13:30:00.000000Z" }, /it has expired/],
        [{ validFrom: "2026-10-10T12:00:00.000000Z" }, /it does not apply yet/],
      ]) {
        const merge = await store.proposeMemory(
          designer(),
          manual("Keep labels outside inputs.", {
            ...extra,
            lifecycle: { action: "supersede", targets: [kept.id] },
          }),
        )
        await assert.rejects(
          store.acceptMemory(designer(), merge.id, { expectedDigest: merge.reviewDigest }),
          { code: "invalid_transition", message: reason },
        )
      }
      assert.deepEqual(
        (await store.recall(agent())).memories.map((memory) => memory.id),
        [kept.id],
      )
    })

    it("keeps what a damaged replacement replaced out of recall", async () => {
      const { store, provider, proposal } = await proposedWith()
      const labels = await store.acceptMemory(designer(), proposal.id, {
        expectedDigest: proposal.reviewDigest,
      })
      async function accepted(content, lifecycle) {
        const memory = await store.proposeMemory(designer(), {
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: "rule",
          content,
          evidence: labels.evidence,
          rationale: {
            recurrence: "Fixture.",
            expectedBenefit: "Fixture.",
            falsification: "None.",
          },
          lifecycle,
          consolidator: { id: "manual", version: "1" },
        })
        return store.acceptMemory(designer(), memory.id, { expectedDigest: memory.reviewDigest })
      }
      const reworded = await accepted("Keep every form label visible above its field.", {
        action: "supersede",
        targets: [labels.id],
      })
      const errors = await accepted("Keep each error message next to its field.", NEW)
      const extended = sealMemory({
        ...reworded,
        version: reworded.version + 1,
        previousDigest: reworded.digest,
        supersedes: [labels.id, errors.id],
        updatedAt: "2026-10-09T13:00:00.000000Z",
      })
      await provider.appendMemoryVersion(extended, { expectedPreviousDigest: reworded.digest })
      const pending = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content: "Show errors only after a field loses focus.",
        evidence: labels.evidence,
        rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "None." },
        lifecycle: NEW,
        consolidator: { id: "manual", version: "1" },
      })
      const forged = sealMemory({
        ...pending,
        version: 2,
        previousDigest: pending.digest,
        state: "accepted",
        supersedes: [errors.id],
        updatedAt: "2026-10-09T13:00:00.000000Z",
        accepted: {
          by: { kind: "human", id: "github:ana-designer" },
          at: "2026-10-09T13:00:00.000000Z",
          contentDigest: pending.contentDigest,
          reviewedDigest: pending.reviewDigest,
          edited: false,
        },
      })
      await provider.appendMemoryVersion(forged, { expectedPreviousDigest: pending.digest })
      assert.equal((await store.verify(designer())).ok, false)
      assert.deepEqual(
        (await store.recall(agent())).memories.map((memory) => memory.id),
        [errors.id],
      )
      assert.deepEqual((await store.getMemory(designer(), labels.id)).status.supersededBy, [
        reworded.id,
      ])
      assert.equal((await store.getMemory(designer(), errors.id)).status.superseded, false)
    })

    it("finds every export a grant permitted, even one that covers only a reply", async () => {
      const { store } = await open()
      const grant = await store.addGrant(designer(), {
        ...grantInput(),
        evidenceFrom: "2026-09-30T10:30:00.000000Z",
        evidenceUntil: "2026-09-30T12:00:00.000000Z",
      })
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
      const { events } = await store.queryObservations(designer(), { purpose: "instruction" })
      assert.deepEqual(
        events.map((event) => event.payload.commentId),
        [102],
        "the thread began before the grant's range; only its reply is covered",
      )
      const learning = await store.proposeMemory(designer(), {
        schemaVersion: SCHEMA_VERSIONS.memoryProposal,
        kind: "rule",
        content: "Keep each field's label in view while people type.",
        evidence: [{ episodeId: events[0].episodeId, eventIds: [events[0].id] }],
        rationale: {
          recurrence: "One reply.",
          expectedBenefit: "Fixture.",
          falsification: "None.",
        },
        lifecycle: NEW,
        consolidator: { id: "manual", version: "1" },
      })
      await store.acceptMemory(designer(), learning.id, { expectedDigest: learning.reviewDigest })
      const copies = []
      for (const contents of ["all", "learnings"])
        copies.push(
          (
            await store.exportRecords(designer(), {
              purpose: "instruction",
              destination: `copy-${contents}.json`,
              contents,
            })
          ).manifest.id,
        )
      const { exportsToFollowUp } = await store.withdrawGrant(designer(), grant.id, {
        purposes: ["instruction"],
      })
      assert.deepEqual(exportsToFollowUp.map((item) => item.id).sort(), copies.sort())
    })

    it("shows a consolidator no content from evidence its purpose may not use", async () => {
      const { store, grantId, proposal } = await proposedWith()
      await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
      await store.withdrawGrant(designer(), grantId, { purposes: ["instruction"] })
      let seen
      await store.consolidate(agent(), {
        consolidator: {
          manifest: { id: "spy", version: "1" },
          async consolidate(request, view) {
            seen = view
            return { proposals: [], diagnostics: [] }
          },
        },
        window: WINDOW,
      })
      assert.deepEqual(seen.events, [])
      const memory = seen.memories.find((item) => item.id === proposal.id)
      assert.equal(memory.content, undefined)
      assert.equal(memory.evidence, undefined)
      assert.equal(memory.effective, false)
      assert.ok(Object.isFrozen(seen) && Object.isFrozen(seen.memories))
    })
  })
}

const NEW = Object.freeze({ action: "new" })

/** With every purpose granted, an instruction export holds exactly the learnings recall uses. */
async function assertExportMatchesRecall(store) {
  const recalled = (await store.recall(agent())).memories.map((memory) => memory.id).sort()
  const { bundle } = await store.exportRecords(designer(), {
    purpose: "instruction",
    destination: "out.json",
  })
  assert.deepEqual(bundle.memories.map((memory) => memory.id).sort(), recalled)
}
const METADATA_KEYS = [
  "id",
  "version",
  "state",
  "kind",
  "themeKey",
  "updatedAt",
  "contentDigest",
  "reviewDigest",
  "digest",
]

/** A retraction of a stored comment, as a source would record a deletion. */
function retractionOf(comment, id) {
  const at = "2026-10-09T11:00:00.000000Z"
  return sealEvent({
    schemaVersion: SCHEMA_VERSIONS.event,
    id,
    episodeId: comment.episodeId,
    scope: comment.scope,
    type: "retraction",
    at,
    parentEventId: comment.id,
    actor: { kind: "system", id: "system:hub_review_comments" },
    payload: { target: { eventId: comment.id }, reason: "deleted_at_source", at },
  })
}

function without(record, key) {
  const copy = structuredClone(record)
  delete copy[key]
  return copy
}

function dissent() {
  return {
    target: { commentId: 110 },
    theme: { key: "visible-form-labels", statement: "Labels can stay inside short inputs." },
    signal: "accessibility",
    observation: "observed",
    stance: "contradicts",
  }
}

/** A stored event with its payload removed and a note saying why, as the contract allows. */
function redacted(record) {
  const copy = structuredClone(record)
  delete copy.payload
  copy.redaction = {
    at: "2026-10-09T12:00:00.000000Z",
    by: { kind: "human", id: "github:ana-designer" },
    reason: "Removed at the author's request.",
  }
  return copy
}

function grantInput() {
  return {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "Conformance fixture agreement.",
  }
}

function grant(id, grantedAt = "2026-10-01T00:00:00.000000Z", scope = SCOPE) {
  return sealRecord({
    schemaVersion: SCHEMA_VERSIONS.consentGrant,
    id,
    scope,
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    grantedBy: { kind: "human", id: "github:ana-designer" },
    grantedAt,
    basis: "Conformance fixture agreement.",
  })
}

function auditEntry(id, reason = "Conformance fixture.") {
  return sealRecord({
    schemaVersion: SCHEMA_VERSIONS.auditEntry,
    id,
    at: "2026-10-09T12:00:00.000000Z",
    actor: { kind: "human", id: "github:ana-designer" },
    operation: "grant.add",
    scope: SCOPE,
    subjects: [],
    outcome: "ok",
    reason,
    provider: { id: "conformance", version: "1" },
  })
}

function memory(
  id,
  version,
  previousDigest,
  content = "Show a visible label above every form field.",
) {
  const at = `2026-10-0${version}T00:00:00.000000Z`
  return sealMemory({
    schemaVersion: SCHEMA_VERSIONS.memoryRecord,
    id,
    version,
    ...(previousDigest ? { previousDigest } : {}),
    scope: SCOPE,
    kind: "rule",
    state: "proposed",
    content,
    evidence: [{ episodeId: "ep_cccccccc1", eventIds: ["ev_cccccccc1"] }],
    proposal: {
      consolidator: { id: "manual", version: "1" },
      rationale: { recurrence: "Fixture.", expectedBenefit: "Fixture.", falsification: "Fixture." },
      lifecycle: { action: "new" },
      proposedAt: at,
      proposedBy: { kind: "agent", id: "agent:copilot" },
      proposalDigest: `sha256:${"2".repeat(64)}`,
    },
    provenance: {
      producer: { name: "@github/replica-learning", version: "0.0.0" },
      method: "propose:manual",
      createdAt: at,
      createdBy: { kind: "agent", id: "agent:copilot" },
    },
    createdAt: "2026-10-01T00:00:00.000000Z",
    updatedAt: at,
  })
}
