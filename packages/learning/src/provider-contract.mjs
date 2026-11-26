import { digestOf } from "./canonical-json.mjs"
import { LearningError, ProviderConflictError } from "./errors.mjs"
import { sameScope } from "./policy.mjs"

/**
 * The memory provider contract, version 1.
 *
 * A provider stores canonical v1 records and returns them. It never decides who may use a
 * record or for what: the learning store applies scope, consent, purpose, and approval rules
 * before anything reaches a provider and again on everything a provider returns. A provider
 * must:
 *
 * - keep records exactly, so their digests still verify;
 * - append and never rewrite: appendRecords accepts a record whose ID is new, skips one
 *   whose ID and digest are already stored, and throws an error with code "conflict",
 *   writing nothing from the batch, when an ID is stored with another digest;
 * - return records in the order they were appended, filtered by the query, as copies;
 * - append a memory version only when the latest stored version of that memory has the
 *   expected digest and the new version number is one higher, atomically, and otherwise
 *   throw an error with code "conflict";
 * - store a change and the audit entries that record it in one atomic write: appendRecords
 *   and appendMemoryVersion take those entries as options.audit and append them to the audit
 *   stream under the appendRecords rules. If any part is refused or fails, nothing from the
 *   call is stored, so a crash or an error never leaves a change without its audit entry;
 * - append to several streams in one atomic write: appendBatch(batch, { audit }) takes an
 *   object that maps stream names to records, follows the appendRecords rules in each stream,
 *   and stores every record and audit entry, or nothing. It returns { appended, existing } for
 *   each stream the batch names. appendRecords(stream, records, { audit }) is the same write for
 *   one stream;
 * - throw an error with code "invalid_input" for an unknown stream or a query without a scope.
 *
 * ProviderConflictError and LearningError are conveniences; any error with the right code works.
 *
 * Methods: manifest(), health(), appendRecords(stream, records, { audit }),
 * appendBatch(batch, { audit }), readRecords(stream, query),
 * appendMemoryVersion(record, { expectedPreviousDigest, audit }), readMemoryVersions(query), and
 * an optional close().
 *
 * A provider that declares the optional observation.redact capability also implements
 * redactRecord("events", record). It replaces a stored event, in place and in the same order,
 * with a redacted copy that keeps the event's ID and digest, has no payload, and says why in
 * redaction, naming the Hub comment when the event is a review comment. It returns
 * { redacted: false } when the stored event has no payload already, and throws not_found,
 * conflict, or invalid_input as redactionProblem describes. This is the only
 * rewrite the contract allows, because an event's digest leaves out its payload.
 *
 * A provider with atomicDecisionFence === true implements decisionFence(scope). The returned
 * opaque token changes when eligibility records, memory versions, or scope migrations change.
 * A caller obtains it before reading eligibility and passes it as expectedDecisionFence to
 * appendMemoryVersion. The provider compares it under the same lock as the version and audit
 * write, and throws conflict without writing if any covered state changed.
 *
 * A provider that supports indexed learning decisions also implements
 * readDecisionMemoryIds(scope, ids). It returns the supplied IDs and the connected replacement
 * histories using indexed links, and refuses a component larger than 1,000 IDs.
 * readRelatedEpisodeIds(scope, ids) returns those IDs and other episodes of the same Hub
 * review threads, using indexed source identities.
 * readDecisionInputs(scope, selection) returns only grants, withdrawals, stable-identity
 * collections, and migration origins relevant to the selected episodes and events.
 */
export const PROVIDER_CONTRACT = Object.freeze({ name: "replica.memory-provider", version: 1 })

/** The optional capability for removing an event's payload; see redactRecord above. */
export const REDACT_CAPABILITY = "observation.redact"

export const REQUIRED_CAPABILITIES = Object.freeze([
  "observation.append",
  "observation.query",
  "memory.store",
  "memory.query",
  "memory.lifecycle",
  "grant.store",
  "audit.store",
])

/** Append-only record streams, each with the field that orders it in time. */
export const STREAMS = Object.freeze({
  episodes: "startedAt",
  events: "at",
  grants: "grantedAt",
  withdrawals: "withdrawnAt",
  collections: "capturedAt",
  audit: "at",
  exports: "createdAt",
})

/** Streams whose contents can change whether evidence or a learning may be used. */
export const DECISION_FENCE_STREAMS = Object.freeze([
  "grants",
  "withdrawals",
  "collections",
  "episodes",
  "events",
])

/** Bind a scope's change generation to an opaque decision token. */
export function decisionGenerationFence(scope, generation) {
  assertQuery({ scope })
  return digestOf({ scope, generation: String(generation) })
}

/** Hash complete records, including redacted event bodies, without returning their contents. */
export function decisionFenceDigest(scope, { records = {}, memories = [], migrations = [] } = {}) {
  assertQuery({ scope })
  try {
    return digestOf({
      scope,
      records: Object.fromEntries(
        DECISION_FENCE_STREAMS.map((stream) => [
          stream,
          (records[stream] ?? []).map((record) => digestOf(record)),
        ]),
      ),
      memories: memories.map((record) => digestOf(record)),
      migrations: migrations.map((migration) => digestOf(migration)),
    })
  } catch {
    throw new LearningError("storage_corrupt", "Could not read the decision eligibility state.")
  }
}

/** Refuse an invalid or stale fence without exposing its contents. */
export function assertDecisionFence(expected, actual) {
  if (expected === undefined) return
  if (typeof expected !== "string" || !/^sha256:[0-9a-f]{64}$/.test(expected))
    throw new LearningError("invalid_input", "The decision fence is invalid.")
  if (expected !== actual)
    throw new ProviderConflictError("Decision eligibility changed during the write.")
}

/**
 * Refuse a stable-identity collection without a snapshot ID. Its snapshot proves which
 * reviewers were adopted, so skipping it would quietly let withheld evidence through.
 */
export function assertSnapshotIds(collections) {
  for (const collection of collections)
    if (typeof collection.snapshotId !== "string")
      throw new LearningError("storage_corrupt", "A stable-identity collection has no snapshot.")
}

export function assertStream(stream) {
  if (!Object.hasOwn(STREAMS, stream))
    throw new LearningError("invalid_input", `Unknown record stream: ${stream}`)
}

/** Refuse a query without a scope before reading anything, even from an empty store. */
export function assertQuery(query) {
  if (!query || typeof query !== "object" || !query.scope || typeof query.scope !== "object")
    throw new LearningError("invalid_input", "Every provider query needs a scope.")
}

/**
 * The reference filter semantics every provider must match. scope must equal the record's
 * scope exactly. ids matches id. episodeIds matches an event's episodeId or an episode's id.
 * operations matches an audit entry's operation. since is inclusive and until exclusive, on
 * the stream's time field. An empty filter array matches nothing.
 *
 * @param {string} stream
 * @param {Record<string, any>} record
 * @param {{ scope: object, ids?: string[], episodeIds?: string[], operations?: string[], since?: string, until?: string }} query
 */
export function matchesQuery(stream, record, query) {
  assertQuery(query)
  if (!sameScope(record.scope, query.scope)) return false
  if (query.ids && !query.ids.includes(record.id)) return false
  if (query.operations && !query.operations.includes(record.operation)) return false
  if (query.episodeIds) {
    const episodeId = stream === "episodes" ? record.id : record.episodeId
    if (!query.episodeIds.includes(episodeId)) return false
  }
  const time = stream === "memories" ? record.updatedAt : record[STREAMS[stream]]
  if (query.since && !(time >= query.since)) return false
  if (query.until && !(time < query.until)) return false
  return true
}

/**
 * Why a provider must refuse to replace a stored event with this copy, or null when it may:
 * the event must exist, the copy must have no payload and a redaction note, and its digest
 * must equal the stored event's, which is only true for the same event. A note that removes a
 * review comment's text must name that comment's Hub comment ID, and no other note may name
 * one, because the store later finds a comment's versions by it.
 */
export function redactionProblem(stored, record) {
  if (!record || typeof record !== "object" || record.payload !== undefined || !record.redaction)
    return new LearningError(
      "invalid_input",
      "A redacted event has no payload and a redaction note.",
    )
  if (!stored) return new LearningError("not_found", `No stored event ${record.id}.`)
  if (stored.digest !== record.digest)
    return new LearningError("conflict", `The redacted copy of ${record.id} is a different event.`)
  if (stored.payload !== undefined) {
    const expected = stored.type === "human_comment" ? stored.payload.commentId : undefined
    if (record.redaction.commentId !== expected)
      return new LearningError(
        "invalid_input",
        expected === undefined
          ? `Only a review comment's redaction note names a Hub comment, and ${record.id} is not one.`
          : `The redaction note of ${record.id} must name Hub comment ${expected}, the comment it removes.`,
      )
  }
  return null
}

/** Check that records are objects with an ID and a digest before a provider stores them. */
export function assertStorable(records) {
  if (!Array.isArray(records)) throw new LearningError("invalid_input", "Records must be an array.")
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      typeof record.digest !== "string"
    )
      throw new LearningError("invalid_input", "Every stored record needs a string id and digest.")
    if (!record.scope)
      throw new LearningError("invalid_input", "Every stored record needs a scope.")
  }
}

/**
 * The records an appendBatch call writes to each stream, with its audit entries added to the
 * audit stream. Refuses an unknown stream and a record a provider cannot store.
 *
 * @param {Record<string, Array<{ id: string, digest: string }>>} batch
 * @param {Array<{ id: string, digest: string }>} audit
 * @returns {Map<string, Array<{ id: string, digest: string }>>}
 */
export function batchWrites(batch, audit = []) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch))
    throw new LearningError("invalid_input", "A batch maps stream names to records.")
  const writes = new Map()
  for (const [stream, records] of Object.entries(batch)) {
    assertStream(stream)
    assertStorable(records)
    writes.set(stream, records)
  }
  assertStorable(audit)
  if (audit.length) writes.set("audit", [...(writes.get("audit") ?? []), ...audit])
  return writes
}

/**
 * The records an append adds to a stream that already holds stored, in order, and how many it
 * holds already. Throws a conflict when an ID is stored, or earlier in records, with another
 * digest.
 *
 * @param {string} stream
 * @param {Array<{ id: string, digest: string }>} stored
 * @param {Array<{ id: string, digest: string }>} records
 */
export function newRecords(stream, stored, records) {
  const digests = new Map(stored.map((record) => [record.id, record.digest]))
  const fresh = []
  let existing = 0
  for (const record of records) {
    const digest = digests.get(record.id)
    if (digest === undefined) {
      digests.set(record.id, record.digest)
      fresh.push(record)
    } else if (digest === record.digest) existing++
    else
      throw new ProviderConflictError(
        `${stream} already holds a different record with ID ${record.id}.`,
        { stream, id: record.id },
      )
  }
  return { fresh, existing }
}
