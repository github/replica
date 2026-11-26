import { canonicalJson, digestOf } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import { derivedId } from "./ids.mjs"
import { matchesQuery, STREAMS } from "./provider-contract.mjs"
import {
  SCHEMA_VERSIONS,
  memoryContentDigest,
  sealEpisode,
  sealEvent,
  sealMemory,
  sealRecord,
  without,
} from "./records.mjs"
import { commentIdOf, stableReviewer } from "./sources/hub-review-comments.mjs"
import { createLearningStore, sameCollectionSnapshot, scopeProblem } from "./store.mjs"

const KINDS = {
  episodes: "episode",
  events: "event",
  grants: "grant",
  withdrawals: "withdrawal",
  collections: "collection",
  exports: "export",
  audit: "audit",
  guidance: "guidance",
  deliveries: "delivery",
  usageReports: "usage_report",
  usedLearnings: "used_learning",
  screenshots: "screenshot",
  scores: "score",
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
  sourceSnapshot,
  beforeCommit,
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
    sourceSnapshot,
    transform: async ({ records, memories, targetRecords, targetMemories }) => {
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
            draft.accepted.decision ? "memory" : "memory-review",
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
      // Guidance and usage records keep their IDs, so the links between them still hold. A
      // delivery names the learning text it gave, which the move gives a new digest.
      for (const stream of [
        "guidance",
        "deliveries",
        "usageReports",
        "usedLearnings",
        "screenshots",
        "scores",
      ])
        for (const record of records[stream]) {
          const draft = { ...record, scope: newScope }
          if (stream === "deliveries") {
            draft.contentDigest = mapped("memory", record.memoryId, record.contentDigest)
            if (canonicalJson(record.sourceScope) === canonicalJson(oldScope))
              draft.sourceScope = newScope
          }
          const updated = sealRecord(draft)
          changed[stream].push(updated)
          remember(KINDS[stream], record, updated)
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
      if (targetRecords && targetMemories) {
        const snapshots = new Map(
          targetRecords.collections.map((record) => [record.snapshotId, record]),
        )
        for (const record of changed.collections) {
          const existing = snapshots.get(record.snapshotId)
          if (existing && !sameCollectionSnapshot(record, existing))
            throw new LearningError(
              "conflict",
              "Both repository histories contain different contents for the same snapshot. No records were moved.",
            )
        }
        const targetThreads = new Set(targetRecords.episodes.map(threadKey).filter(Boolean))
        const groups = new Map()
        for (const episode of [...targetRecords.episodes, ...changed.episodes]) {
          const key = threadKey(episode)
          if (key) groups.set(key, [...(groups.get(key) ?? []), episode.id])
        }
        const overlappingEpisodes = [...groups.values()].filter((ids) => ids.length > 1)
        if (
          changed.episodes.some((episode) => targetThreads.has(threadKey(episode))) &&
          !provider.atomicMigrationRedactions
        )
          throw new LearningError(
            "unsupported",
            "This provider cannot atomically reconcile overlapping repository histories.",
          )
        const { targetRedactions, audit, redactedIds } = reconcileRedactions(
          targetRecords,
          changed,
          newScope,
          manifest,
        )
        if ((targetRedactions.length || audit.length) && !provider.atomicMigrationRedactions)
          throw new LearningError(
            "unsupported",
            "This provider cannot reconcile redactions atomically during migration.",
          )
        const merged = Object.fromEntries(
          Object.keys(STREAMS).map((stream) => [
            stream,
            [
              ...targetRecords[stream].map((record) =>
                stream === "events"
                  ? (targetRedactions.find((redacted) => redacted.id === record.id) ?? record)
                  : record,
              ),
              ...changed[stream],
              ...(stream === "audit" ? audit : []),
            ],
          ]),
        )
        await verifySnapshot({
          records: merged,
          memories: [...targetMemories, ...versions],
          scope: newScope,
          manifest,
          clock,
        })
        const allMemories = [...targetMemories, ...versions]
        const latest = new Map(allMemories.map((record) => [record.id, record]))
        const affected = new Set(redactedIds)
        function cites(record) {
          return [...record.evidence, ...(record.contradictions ?? [])].some((reference) =>
            reference.eventIds.some((id) => affected.has(id)),
          )
        }
        const citing = new Set(
          allMemories.filter(cites).map((record) => `${record.id} ${record.digest}`),
        )
        const redactionFollowUps = {
          memoriesNeedingRebuild: [...latest.values()]
            .filter((record) => record.state === "accepted" && cites(record))
            .map((record) => record.id)
            .sort(),
          exportsToFollowUp: merged.exports
            .filter((record) =>
              record.records.some(
                (subject) =>
                  (subject.kind === "event" && affected.has(subject.id)) ||
                  (subject.kind === "memory" && citing.has(`${subject.id} ${subject.digest}`)),
              ),
            )
            .map((record) => ({
              id: record.id,
              purpose: record.purpose,
              destination: record.destination,
            })),
        }
        await beforeCommit?.()
        return {
          records: changed,
          memories: versions,
          targetRedactions,
          audit,
          metadata: {
            oldScope,
            newScope,
            digestMappings,
            overlappingEpisodes,
            redactionFollowUps,
            sourceDigest: digestOf({ records, memories }),
            migrated: true,
          },
        }
      }
      await beforeCommit?.()
      return {
        records: changed,
        memories: versions,
        metadata: {
          oldScope,
          newScope,
          digestMappings,
          sourceDigest: digestOf({ records, memories }),
          migrated: true,
        },
      }
    },
  })
}

function threadKey(episode) {
  const source = episode.source
  if (
    source.kind !== "hub_review_comments" ||
    [source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId].some(
      (value) => value === undefined,
    )
  )
    return null
  return canonicalJson([source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId])
}

/** Apply an existing removal to copies of the same comment, preserving every event ID. */
function reconcileRedactions(target, source, scope, manifest) {
  const episodes = [...target.episodes, ...source.episodes]
  const threads = new Map(episodes.map((episode) => [episode.id, threadKey(episode)]))
  const episodesById = new Map(episodes.map((episode) => [episode.id, episode]))
  const targetIds = new Set(target.episodes.map(threadKey).filter(Boolean))
  const sourceIds = new Set(source.episodes.map(threadKey).filter(Boolean))
  const overlapping = new Set([...targetIds].filter((key) => sourceIds.has(key)))
  const events = [...target.events, ...source.events]
  const eventsById = new Map(events.map((event) => [event.id, event]))
  const versions = new Map()
  const authors = new Map()
  for (const event of events) {
    const thread = threads.get(event.episodeId)
    if (!overlapping.has(thread) || event.type !== "human_comment") continue
    const commentId = commentIdOf(event)
    if (commentId === undefined) continue
    const episode = episodesById.get(event.episodeId)
    if (stableReviewer(event.actor, episode.scope, episode.source)) {
      const authorKey = canonicalJson([thread, commentId])
      const prior = authors.get(authorKey)
      if (prior && prior !== event.actor.id)
        throw new LearningError(
          "conflict",
          "Overlapping histories name different stable authors for the same comment.",
        )
      authors.set(authorKey, event.actor.id)
    }
    const key = canonicalJson([thread, commentId, event.at])
    const previous = versions.get(key) ?? []
    for (const other of previous)
      if (
        event.payloadDigest !== other.payloadDigest &&
        event.payload?.body !== null &&
        other.payload?.body !== null
      )
        throw new LearningError(
          "conflict",
          "Overlapping histories contain different contents for the same comment version.",
        )
    previous.push(event)
    versions.set(key, previous)
  }
  const removals = new Map()
  for (const event of events) {
    const thread = threads.get(event.episodeId)
    if (!overlapping.has(thread) || event.type !== "human_comment" || !event.redaction) continue
    const commentId = commentIdOf(event)
    if (commentId === undefined)
      throw new LearningError(
        "conflict",
        "A redacted comment in an overlapping thread has no Hub comment ID.",
      )
    const key = canonicalJson([thread, commentId])
    const entries = removals.get(key) ?? []
    entries.push(event)
    removals.set(key, entries)
  }
  const selected = new Map()
  for (const event of events) {
    if (event.type !== "human_comment" || event.payload === undefined) continue
    const thread = threads.get(event.episodeId)
    const commentId = commentIdOf(event)
    if (!overlapping.has(thread) || commentId === undefined) continue
    const key = canonicalJson([thread, commentId])
    const removal = (removals.get(key) ?? [])
      .filter(
        (removed) =>
          event.at <= removed.redaction.at || event.payloadDigest === removed.payloadDigest,
      )
      .sort((a, b) => a.redaction.at.localeCompare(b.redaction.at))[0]
    if (removal) selected.set(event.id, removal.redaction)
  }
  for (const event of events)
    if (event.type === "annotation" && event.payload !== undefined) {
      const parent = eventsById.get(event.parentEventId)
      const note =
        selected.get(event.parentEventId) ??
        (overlapping.has(threads.get(parent?.episodeId)) ? parent?.redaction : undefined)
      if (note) selected.set(event.id, note)
    }
  const targetRedactions = []
  const audit = []
  for (const [stream, items] of [
    [targetRedactions, target.events],
    [null, source.events],
  ]) {
    for (let index = 0; index < items.length; index++) {
      const event = items[index]
      const note = selected.get(event.id)
      if (!note) continue
      const redacted = {
        ...without(event, "payload"),
        redaction: {
          at: note.at,
          by: note.by,
          reason: note.reason,
          ...(event.type === "human_comment" ? { commentId: event.payload.commentId } : {}),
        },
      }
      if (stream) stream.push(redacted)
      else items[index] = redacted
      audit.push(
        sealRecord({
          schemaVersion: SCHEMA_VERSIONS.auditEntry,
          id: derivedId("audit", {
            operation: "evidence.redact",
            event: event.id,
            digest: event.digest,
          }),
          at: note.at,
          actor: note.by,
          operation: "evidence.redact",
          scope,
          subjects: [{ kind: "event", id: event.id, digest: event.digest }],
          outcome: "ok",
          reason: note.reason,
          provider: { id: manifest.id, version: manifest.version },
        }),
      )
    }
  }
  const redactedIds = events
    .filter(
      (event) =>
        overlapping.has(threads.get(event.episodeId)) &&
        (selected.has(event.id) ||
          (event.redaction && ["human_comment", "annotation"].includes(event.type))),
    )
    .map((event) => event.id)
  return { targetRedactions, audit, redactedIds }
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
