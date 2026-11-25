import { LearningError, ProviderConflictError } from "../errors.mjs"
import {
  PROVIDER_CONTRACT,
  DECISION_FENCE_STREAMS,
  REDACT_CAPABILITY,
  REQUIRED_CAPABILITIES,
  STREAMS,
  assertQuery,
  assertDecisionFence,
  assertStorable,
  assertStream,
  batchWrites,
  decisionFenceDigest,
  matchesQuery,
  newRecords,
  redactionProblem,
} from "../provider-contract.mjs"
import { PRODUCER, SCHEMA_VERSIONS } from "../records.mjs"

/**
 * Keeps learning records in process memory. Use it for tests and short-lived runs; it is also
 * the second, independent implementation that the conformance suite checks.
 */
export function createInMemoryProvider() {
  const streams = new Map(Object.keys(STREAMS).map((stream) => [stream, []]))
  const memories = []

  function fence(scope) {
    const query = { scope }
    assertQuery(query)
    return decisionFenceDigest(scope, {
      records: Object.fromEntries(
        DECISION_FENCE_STREAMS.map((stream) => [
          stream,
          streams.get(stream).filter((record) => matchesQuery(stream, record, query)),
        ]),
      ),
      memories: memories.filter((record) => matchesQuery("memories", record, query)),
    })
  }

  /** Append to several streams at once. Every record is checked before any is stored. */
  function write(batch, { audit = [] } = {}) {
    const planned = [...batchWrites(batch, audit)].map(([stream, records]) => {
      const { fresh, existing } = newRecords(stream, streams.get(stream), records)
      return [stream, { fresh: structuredClone(fresh), existing }]
    })
    for (const [stream, { fresh }] of planned)
      for (const record of fresh) streams.get(stream).push(record)
    return Object.fromEntries(
      planned
        .filter(([stream]) => Object.hasOwn(batch, stream))
        .map(([stream, { fresh, existing }]) => [stream, { appended: fresh.length, existing }]),
    )
  }

  return {
    atomicDecisionFence: true,

    async decisionFence(scope) {
      return fence(scope)
    },

    manifest() {
      return {
        schemaVersion: SCHEMA_VERSIONS.providerManifest,
        id: "in-memory",
        name: "In-process memory",
        version: PRODUCER.version,
        contract: { name: PROVIDER_CONTRACT.name, versions: [PROVIDER_CONTRACT.version] },
        capabilities: [...REQUIRED_CAPABILITIES, REDACT_CAPABILITY],
        storage: { kind: "memory" },
        externalCalls: [],
        dataRetention: "Records are lost when the process exits.",
      }
    },

    async health() {
      return { ok: true, detail: "In-process memory" }
    },

    async appendRecords(stream, records, options) {
      assertStream(stream)
      return write({ [stream]: records }, options)[stream]
    },

    async appendBatch(batch, options) {
      return write(batch, options)
    },

    async readRecords(stream, query) {
      assertStream(stream)
      assertQuery(query)
      return structuredClone(
        streams.get(stream).filter((record) => matchesQuery(stream, record, query)),
      )
    },

    async appendMemoryVersion(
      record,
      { expectedPreviousDigest = null, expectedDecisionFence, audit = [] } = {},
    ) {
      assertStorable([record])
      assertStorable(audit)
      if (expectedDecisionFence !== undefined)
        assertDecisionFence(expectedDecisionFence, fence(record.scope))
      let latest = null
      for (const version of memories) if (version.id === record.id) latest = version
      if ((latest?.digest ?? null) !== expectedPreviousDigest)
        throw new ProviderConflictError(`Memory ${record.id} changed since it was read.`)
      if (record.version !== (latest?.version ?? 0) + 1)
        throw new ProviderConflictError(
          `Memory ${record.id} version must follow ${latest?.version ?? 0}.`,
        )
      const receipts = structuredClone(newRecords("audit", streams.get("audit"), audit).fresh)
      const copy = structuredClone(record)
      memories.push(copy)
      for (const receipt of receipts) streams.get("audit").push(receipt)
    },

    async readMemoryVersions(query) {
      assertQuery(query)
      return structuredClone(memories.filter((record) => matchesQuery("memories", record, query)))
    },

    async redactRecord(stream, record) {
      if (stream !== "events")
        throw new LearningError("invalid_input", "Only events can be redacted.")
      const events = streams.get("events")
      const index = events.findIndex((item) => item.id === record?.id)
      const problem = redactionProblem(events[index], record)
      if (problem) throw problem
      if (events[index].payload === undefined) return { redacted: false }
      events[index] = structuredClone(record)
      return { redacted: true }
    },
  }
}
