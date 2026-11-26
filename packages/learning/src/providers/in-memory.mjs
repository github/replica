import { LearningError, ProviderConflictError } from "../errors.mjs"
import { canonicalJson } from "../canonical-json.mjs"
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
  decisionGenerationFence,
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
  const generations = new Map()
  const targets = new Map()
  const episodeThreads = new Map()
  const episodes = new Map()
  const grantsBySource = new Map()
  const withdrawalsByGrant = new Map()
  const collectionsBySource = new Map()
  const collectionsBySnapshot = new Map()
  let recordOrder = 0

  function fence(scope) {
    assertQuery({ scope })
    return decisionGenerationFence(scope, generations.get(canonicalJson(scope)) ?? 0)
  }

  function changed(scope) {
    const key = canonicalJson(scope)
    const next = (generations.get(key) ?? 0) + 1
    if (!Number.isSafeInteger(next))
      throw new LearningError("storage_corrupt", "The decision generation is exhausted.")
    generations.set(key, next)
  }

  function threadKey(record) {
    const source = record.source
    if (
      source?.kind !== "hub_review_comments" ||
      [source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId].some(
        (value) => value === undefined,
      )
    )
      return null
    return canonicalJson([
      record.scope,
      source.hubOrigin,
      source.repositoryId,
      source.prototypeId,
      source.threadId,
    ])
  }

  /** Append to several streams at once. Every record is checked before any is stored. */
  function write(batch, { audit = [] } = {}) {
    const planned = [...batchWrites(batch, audit)].map(([stream, records]) => {
      const { fresh, existing } = newRecords(stream, streams.get(stream), records)
      return [stream, { fresh: structuredClone(fresh), existing }]
    })
    const scopes = new Map()
    for (const [stream, { fresh }] of planned)
      if (DECISION_FENCE_STREAMS.includes(stream))
        for (const record of fresh) scopes.set(canonicalJson(record.scope), record.scope)
    const indexUpdates = []
    const episodeUpdates = []
    let nextOrder = recordOrder
    for (const [stream, { fresh }] of planned) {
      for (const record of fresh) {
        const indexed = { record, order: nextOrder++ }
        function add(index, key) {
          indexUpdates.push([index, key, indexed])
        }
        if (stream === "episodes") {
          const key = threadKey(record)
          if (!key) continue
          const identity = canonicalJson([record.scope, record.id])
          episodeUpdates.push([identity, key, record.id])
        } else if (
          stream === "grants" &&
          Array.isArray(record.sources) &&
          Array.isArray(record.purposes)
        ) {
          for (const source of record.sources)
            if (typeof source === "string")
              for (const purpose of record.purposes)
                if (typeof purpose === "string")
                  add(grantsBySource, canonicalJson([record.scope, source, purpose]))
        } else if (stream === "withdrawals" && typeof record.grantId === "string") {
          add(withdrawalsByGrant, canonicalJson([record.scope, record.grantId]))
        } else if (stream === "collections") {
          if (typeof record.snapshotId === "string")
            add(collectionsBySnapshot, canonicalJson([record.scope, record.snapshotId]))
          if (record.reviewerIdentity === "stable-user-id")
            add(
              collectionsBySource,
              canonicalJson([
                record.scope,
                record.source?.hubOrigin ?? null,
                record.source?.repositoryId ?? null,
              ]),
            )
        }
      }
    }
    for (const key of scopes.keys())
      if (!Number.isSafeInteger((generations.get(key) ?? 0) + 1))
        throw new LearningError("storage_corrupt", "The decision generation is exhausted.")
    for (const scope of scopes.values()) changed(scope)
    for (const [stream, { fresh }] of planned)
      for (const record of fresh) streams.get(stream).push(record)
    for (const [index, key, entry] of indexUpdates) {
      if (!index.has(key)) index.set(key, new Set())
      index.get(key).add(entry)
    }
    for (const [identity, key, id] of episodeUpdates) {
      episodes.set(identity, key)
      if (!episodeThreads.has(key)) episodeThreads.set(key, new Set())
      episodeThreads.get(key).add(id)
    }
    recordOrder = nextOrder
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

    async readDecisionMemoryIds(scope, ids) {
      assertQuery({ scope })
      const links = targets.get(canonicalJson(scope)) ?? new Map()
      const selected = new Set(ids)
      const pending = [...selected]
      while (pending.length) {
        for (const id of links.get(pending.pop()) ?? [])
          if (!selected.has(id)) {
            selected.add(id)
            if (selected.size > 1000)
              throw new LearningError(
                "unsupported",
                "The learning replacement history is too large.",
              )
            pending.push(id)
          }
      }
      return [...selected]
    },

    async readRelatedEpisodeIds(scope, ids) {
      assertQuery({ scope })
      const related = new Set(ids)
      for (const id of ids) {
        const key = episodes.get(canonicalJson([scope, id]))
        for (const other of episodeThreads.get(key) ?? []) related.add(other)
      }
      return [...related]
    },

    async readDecisionInputs(scope, { evidence, at, purpose, hubSources, eventIds }) {
      assertQuery({ scope, ids: eventIds })
      function selected(index, keys) {
        const records = new Set()
        for (const key of keys) for (const entry of index.get(key) ?? []) records.add(entry)
        return [...records].sort((a, b) => a.order - b.order).map((entry) => entry.record)
      }
      const grants = selected(
        grantsBySource,
        evidence.map((item) => canonicalJson([scope, item.source, purpose])),
      ).filter(
        (grant) =>
          grant.purposes?.includes(purpose) &&
          grant.grantedAt <= at &&
          (!grant.expiresAt || at < grant.expiresAt) &&
          evidence.some(
            (item) =>
              grant.sources.includes(item.source) &&
              (!grant.evidenceFrom || item.at >= grant.evidenceFrom) &&
              (!grant.evidenceUntil || item.at < grant.evidenceUntil),
          ),
      )
      const withdrawals = selected(
        withdrawalsByGrant,
        grants.map((grant) => canonicalJson([scope, grant.id])),
      )
      const stableCollections = selected(
        collectionsBySource,
        hubSources.map((source) =>
          canonicalJson([scope, source.hubOrigin ?? null, source.repositoryId ?? null]),
        ),
      )
      const collections = selected(
        collectionsBySnapshot,
        stableCollections
          .filter((collection) => typeof collection.snapshotId === "string")
          .map((collection) => canonicalJson([scope, collection.snapshotId])),
      )
      return structuredClone({ grants, withdrawals, collections, origins: [] })
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
      changed(record.scope)
      memories.push(copy)
      const key = canonicalJson(record.scope)
      const links = targets.get(key) ?? new Map()
      for (const target of Array.isArray(record.supersedes) ? record.supersedes : []) {
        if (typeof target !== "string") continue
        if (!links.has(record.id)) links.set(record.id, new Set())
        if (!links.has(target)) links.set(target, new Set())
        links.get(record.id).add(target)
        links.get(target).add(record.id)
      }
      targets.set(key, links)
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
      changed(events[index].scope)
      events[index] = structuredClone(record)
      return { redacted: true }
    },
  }
}
