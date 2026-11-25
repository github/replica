import { canonicalJson } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import { matchesQuery, STREAMS } from "./provider-contract.mjs"
import { memoryContentDigest, sealEpisode, sealEvent, sealMemory, sealRecord } from "./records.mjs"
import { createLearningStore, scopeProblem } from "./store.mjs"

const KINDS = {
  episodes: "episode",
  events: "event",
  grants: "grant",
  withdrawals: "withdrawal",
  collections: "collection",
  exports: "export",
  audit: "audit",
}

/**
 * Move an intact legacy repository scope to a GitHub repository ID. The provider must offer
 * migrateScope({ oldScope, newScope, transform }), an atomic, exclusive rewrite that fences
 * old-scope writes and persists the transform's metadata for retries. Providers without this
 * guarantee are refused without reading or changing their data.
 *
 * Returns { oldScope, newScope, digestMappings, migrated }. Each digest mapping identifies a
 * record and digest field, preserving the link from its old digest to its new one.
 *
 * @param {{ provider: object, oldScope: object, newScope: object, clock?: () => number }} options
 */
export async function migrateRepositoryScope({
  provider,
  oldScope,
  newScope,
  clock = Date.now,
} = {}) {
  if (scopeProblem(oldScope) || scopeProblem(newScope))
    throw new LearningError("invalid_input", "Both repository scopes must be valid.")
  if (
    Object.keys(newScope).length !== 2 ||
    newScope.host !== "github.com" ||
    !/^repositories\/[1-9][0-9]*$/.test(newScope.repository ?? "")
  )
    throw new LearningError("invalid_input", "The target must name a numeric GitHub repository ID.")
  if (canonicalJson(oldScope) === canonicalJson(newScope))
    throw new LearningError("invalid_input", "The old and new repository scopes must differ.")
  if (typeof provider?.migrateScope !== "function")
    throw new LearningError(
      "unsupported",
      "This provider cannot atomically migrate and fence a repository scope. Its data is unchanged.",
    )
  const manifest = provider.manifest()
  return provider.migrateScope({
    oldScope,
    newScope,
    transform: async ({ records, memories }) => {
      await verifySnapshot({ records, memories, scope: oldScope, manifest, clock })
      assertReferences(records, memories)

      const digestMappings = []
      const lookup = new Map()
      function remember(kind, old, updated, field = "digest") {
        const key = `${kind} ${old.id} ${old[field]}`
        const value = updated[field]
        if (lookup.has(key) && lookup.get(key) !== value)
          throw new LearningError("storage_corrupt", `Ambiguous ${kind} digest for ${old.id}.`)
        lookup.set(key, value)
        digestMappings.push({ kind, id: old.id, field, oldDigest: old[field], newDigest: value })
      }
      function mapped(kind, id, digest) {
        const result = lookup.get(`${kind} ${id} ${digest}`)
        if (!result)
          throw new LearningError(
            "storage_corrupt",
            `Missing ${kind} ${id} with digest ${digest} during scope migration.`,
          )
        return result
      }
      const changed = Object.fromEntries(Object.keys(STREAMS).map((stream) => [stream, []]))
      for (const stream of ["grants", "withdrawals", "collections", "episodes"]) {
        for (const record of records[stream]) {
          if (stream === "episodes" && record.timeline !== undefined)
            throw new LearningError("storage_corrupt", "A stored episode contains a timeline.")
          const draft = { ...record, scope: newScope }
          const updated = stream === "episodes" ? sealEpisode(draft) : sealRecord(draft)
          changed[stream].push(updated)
          remember(KINDS[stream], record, updated)
        }
      }
      const versions = []
      for (const record of memories) {
        const draft = structuredClone({ ...record, scope: newScope })
        if (draft.previousDigest)
          draft.previousDigest = mapped("memory", record.id, draft.previousDigest)
        if (draft.accepted) {
          draft.accepted.reviewedDigest = mapped(
            "memory-review",
            record.id,
            draft.accepted.reviewedDigest,
          )
          draft.accepted.contentDigest = memoryContentDigest(draft)
        }
        if (draft.rejected)
          draft.rejected.reviewedDigest = mapped(
            "memory-review",
            record.id,
            draft.rejected.reviewedDigest,
          )
        const updated = sealMemory(draft)
        versions.push(updated)
        remember("memory", record, updated)
        remember("memory", record, updated, "contentDigest")
        remember("memory-review", record, updated, "reviewDigest")
      }
      for (const record of records.events) {
        const draft = structuredClone({ ...record, scope: newScope })
        if (draft.type === "memory_retrieved" && draft.payload)
          for (const item of draft.payload.memories)
            item.contentDigest = mapped("memory", item.id, item.contentDigest)
        const updated = sealEvent(draft)
        changed.events.push(updated)
        remember("event", record, updated)
      }
      function references(subjects) {
        return subjects.map((subject) =>
          subject.digest
            ? { ...subject, digest: mapped(subject.kind, subject.id, subject.digest) }
            : subject,
        )
      }
      for (const record of records.exports) {
        const updated = sealRecord({
          ...record,
          scope: newScope,
          records: references(record.records),
        })
        changed.exports.push(updated)
        remember("export", record, updated)
      }
      for (const record of records.audit) {
        const updated = sealRecord({
          ...record,
          scope: newScope,
          subjects: references(record.subjects),
        })
        changed.audit.push(updated)
        remember("audit", record, updated)
      }
      await verifySnapshot({
        records: changed,
        memories: versions,
        scope: newScope,
        manifest,
        clock,
      })
      return {
        records: changed,
        memories: versions,
        metadata: { oldScope, newScope, digestMappings, migrated: true },
      }
    },
  })
}

/** Verify the exact locked snapshot without letting the store write to the real provider. */
async function verifySnapshot({ records, memories, scope, manifest, clock }) {
  const snapshot = {
    manifest: () => manifest,
    health: async () => ({ ok: true, detail: "Locked migration snapshot" }),
    readRecords: async (stream, query) =>
      records[stream].filter((r) => matchesQuery(stream, r, query)),
    readMemoryVersions: async (query) => memories.filter((r) => matchesQuery("memories", r, query)),
    appendRecords() {
      throw new Error("Migration snapshot is read-only.")
    },
    appendBatch() {
      throw new Error("Migration snapshot is read-only.")
    },
    appendMemoryVersion() {
      throw new Error("Migration snapshot is read-only.")
    },
  }
  const store = await createLearningStore({ provider: snapshot, clock })
  const result = await store.verify({
    scope,
    principal: { kind: "system", id: "system:scope-migration" },
  })
  if (!result.ok)
    throw new LearningError(
      "storage_corrupt",
      `Scope migration refused: ${result.problems.join("; ")}`,
    )
}

/** Refuse missing links that verify does not currently inspect. */
function assertReferences(records, memories) {
  const grants = new Set(records.grants.map((record) => record.id))
  const episodes = new Set(records.episodes.map((record) => record.id))
  const events = new Map(records.events.map((record) => [record.id, record]))
  const memoryIds = new Set(memories.map((record) => record.id))
  function missing(label, id) {
    throw new LearningError("storage_corrupt", `${label} refers to missing ${id}.`)
  }
  function evidence(label, refs = []) {
    for (const ref of refs) {
      if (!episodes.has(ref.episodeId)) missing(label, ref.episodeId)
      for (const id of ref.eventIds)
        if (events.get(id)?.episodeId !== ref.episodeId) missing(label, id)
    }
  }
  for (const record of records.episodes)
    for (const id of record.grants) if (!grants.has(id)) missing(record.id, id)
  for (const record of records.withdrawals)
    if (!grants.has(record.grantId)) missing(record.id, record.grantId)
  for (const record of records.events) {
    if (!episodes.has(record.episodeId)) missing(record.id, record.episodeId)
    for (const id of [record.parentEventId, record.supersedes].filter(Boolean))
      if (!events.has(id)) missing(record.id, id)
    evidence(record.id, record.evidenceRefs)
  }
  for (const record of memories) {
    evidence(record.id, [...record.evidence, ...(record.contradictions ?? [])])
    for (const id of [...(record.supersedes ?? []), ...(record.proposal.lifecycle.targets ?? [])])
      if (!memoryIds.has(id)) missing(record.id, id)
  }
  for (const record of records.exports)
    for (const id of record.completeEpisodeIds ?? []) if (!episodes.has(id)) missing(record.id, id)
}
