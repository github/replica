import { canonicalJson, digestOf } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import { derivedId, randomId } from "./ids.mjs"
import { PURPOSES, createEligibility, sameScope } from "./policy.mjs"
import {
  PROVIDER_CONTRACT,
  REDACT_CAPABILITY,
  REQUIRED_CAPABILITIES,
  STREAMS,
} from "./provider-contract.mjs"
import { INVISIBLE, rankForRecall, renderRecall } from "./recall.mjs"
import {
  PRODUCER,
  SCHEMA_VERSIONS,
  memoryContentDigest,
  sealEpisode,
  sealEvent,
  sealMemory,
  sealRecord,
  without,
} from "./records.mjs"
import {
  commentIdOf,
  HUB_SOURCE,
  hubEpisodeId,
  hubThreadEpisode,
  hubThreadEvents,
  readHubReviewCollection,
  stableReviewer,
} from "./sources/hub-review-comments.mjs"
import { isTimestamp, timestampFromMilliseconds } from "./time.mjs"
import { assertValid, validateRecord } from "./validate.mjs"

const STREAM_KINDS = Object.freeze({
  episodes: "episode",
  events: "event",
  grants: "consentGrant",
  withdrawals: "grantWithdrawal",
  collections: "collection",
  audit: "auditEntry",
  exports: "exportManifest",
})
const PROVIDER_METHODS = [
  "health",
  "appendRecords",
  "appendBatch",
  "readRecords",
  "appendMemoryVersion",
  "readMemoryVersions",
]
const SCOPE_KEYS = ["host", "organization", "team", "repository", "product"]
const SCOPE_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const REPOSITORY = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/
const ACTOR_ID = /^[a-z][a-z0-9-]*:\S+$/
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::[0-9]{1,5})?$/
const EARLIEST = "0000-01-01T00:00:00.000000Z"
const RECORD_ID = /^[a-z][a-z0-9]{1,15}_[A-Za-z0-9_-]{8,128}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
// The most subjects one audit entry may name, as the audit-entry schema sets.
const SUBJECTS_PER_ENTRY = 10_000
const MEMORY_STATES = ["proposed", "accepted", "rejected", "retired"]
const MEMORY_KINDS = [
  "fact",
  "preference",
  "rule",
  "procedure",
  "example",
  "anti_pattern",
  "design_principle",
]

/** The fields a withheld or damaged learning may still show, each with its strict check. */
const METADATA = {
  id: (value) => typeof value === "string" && RECORD_ID.test(value),
  version: (value) => Number.isSafeInteger(value) && value > 0,
  state: (value) => MEMORY_STATES.includes(value),
  kind: (value) => MEMORY_KINDS.includes(value),
  themeKey: (value) => typeof value === "string" && value.length <= 128 && SCOPE_NAME.test(value),
  updatedAt: (value) => typeof value === "string" && isTimestamp(value),
  contentDigest: (value) => typeof value === "string" && DIGEST.test(value),
  reviewDigest: (value) => typeof value === "string" && DIGEST.test(value),
  digest: (value) => typeof value === "string" && DIGEST.test(value),
}
const PIN_KEYS = [
  "kind",
  "hubOrigin",
  "repository",
  "repositoryId",
  "prototypeId",
  "branch",
  "buildNumber",
  "buildId",
  "commitSha",
  "threadId",
  "sessionId",
]
const TRANSITIONS = {
  proposed: ["proposed", "accepted", "rejected"],
  accepted: ["accepted", "retired"],
  rejected: [],
  retired: [],
}

/**
 * Open a learning store over a memory provider after checking the provider's manifest.
 *
 * Every method takes a context, { scope, principal }. The host builds it from the caller's
 * own access: the scope from the checkout or an authenticated session, never from agent
 * input, and the principal from the person or agent acting.
 *
 * @param {{ provider: object, clock?: () => number, legacyScopes?: object[], digestMappings?: Record<string, string> }} options
 */
export async function createLearningStore({
  provider,
  clock = Date.now,
  legacyScopes = [],
  digestMappings = {},
} = {}) {
  if (!provider || typeof provider.manifest !== "function")
    throw new LearningError("provider_incompatible", "A learning store needs a memory provider.")
  const manifest = provider.manifest()
  const check = validateRecord("providerManifest", manifest, { sealed: false })
  if (!check.valid)
    throw new LearningError(
      "provider_incompatible",
      `The provider manifest is invalid: ${check.errors.join("; ")}`,
    )
  if (!manifest.contract.versions.includes(PROVIDER_CONTRACT.version))
    throw new LearningError(
      "provider_incompatible",
      `Provider ${manifest.id} supports contract versions ${manifest.contract.versions.join(", ")}, not ${PROVIDER_CONTRACT.version}.`,
    )
  const missing = REQUIRED_CAPABILITIES.filter(
    (capability) => !manifest.capabilities.includes(capability),
  )
  if (missing.length)
    throw new LearningError(
      "provider_incompatible",
      `Provider ${manifest.id} lacks ${missing.join(", ")}.`,
    )
  const absent = PROVIDER_METHODS.filter((method) => typeof provider[method] !== "function")
  if (absent.length)
    throw new LearningError(
      "provider_incompatible",
      `Provider ${manifest.id} does not implement ${absent.join(", ")}.`,
    )
  return new LearningStore(provider, manifest, clock, legacyScopes, digestMappings)
}

/** Why a scope is malformed, or null when it is well formed. */
export function scopeProblem(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope))
    return "The context needs a scope."
  const keys = Object.keys(scope)
  if (!keys.length || keys.some((key) => !SCOPE_KEYS.includes(key)))
    return `A scope uses only ${SCOPE_KEYS.join(", ")}.`
  for (const key of keys) {
    const value = scope[key]
    const pattern = key === "repository" ? REPOSITORY : key === "host" ? HOST : SCOPE_NAME
    if (typeof value !== "string" || !pattern.test(value))
      return `Scope ${key} must be lowercase${key === "repository" ? " owner/name" : key === "host" ? " host[:port]" : ""}.`
  }
  return null
}

/** Refuse a malformed context before it reaches a provider. */
export function assertContext(context) {
  const problem = scopeProblem(context?.scope)
  if (problem) throw new LearningError("invalid_input", problem)
  const principal = context.principal
  if (
    !principal ||
    !["human", "agent", "system", "service"].includes(principal.kind) ||
    !ACTOR_ID.test(principal.id ?? "")
  )
    throw new LearningError(
      "invalid_input",
      "The context needs a principal such as { kind: 'human', id: 'github:login' }.",
    )
  // An identity is shown in recall, in the command's output, and in Hub, so it must read there
  // exactly as it was given.
  if (INVISIBLE.test(principal.id))
    throw new LearningError(
      "invalid_input",
      "A principal ID cannot contain control characters or invisible formatting characters. Use a plain ID such as github:login.",
    )
}

function requireHuman(context, action) {
  if (context.principal.kind !== "human")
    throw new LearningError(
      "human_required",
      `Only a person can ${action}. The principal is ${context.principal.id}.`,
    )
}

function unique(values) {
  return [...new Set(values)]
}

/** Compare snapshot facts, not the separate import receipts for those facts. */
export function sameCollectionSnapshot(left, right) {
  function facts(record) {
    return {
      snapshotId: record.snapshotId,
      snapshotDigest: record.snapshotDigest,
      source: record.source,
      reviewerIdentity: record.reviewerIdentity ?? null,
      capturedAt: record.capturedAt,
      filters: record.filters,
      complete: record.complete,
      problems: record.problems,
      counts: {
        threads: record.counts.threads,
        messages: record.counts.messages,
        episodes: record.counts.episodes,
      },
    }
  }
  return canonicalJson(facts(left)) === canonicalJson(facts(right))
}

function conflictingCollections(collections) {
  const snapshots = new Map()
  for (const record of collections) {
    const previous = snapshots.get(record.snapshotId)
    if (previous && !sameCollectionSnapshot(previous, record)) return [previous, record]
    snapshots.set(record.snapshotId, record)
  }
  return null
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The event a label or retraction points at. Both name it in parentEventId, which the event
 * digest covers and validation matches to the payload, so a redaction never loses it.
 */
function targetOf(event) {
  return event.parentEventId
}

/**
 * Events that judge another event and inherit its eligibility and time: a label, and a
 * labeler's record that it found nothing to label.
 */
const JUDGMENTS = new Set(["annotation", "no_annotation"])

const DELETED_AT_SOURCE = "The comment was deleted at its source."

function assertRemovalReason(reason) {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 1000)
    throw new LearningError(
      "invalid_input",
      "Say why the comment is being removed, in at most 1000 characters.",
    )
}

/**
 * Everything a learning depends on: its evidence and the counterevidence a reviewer saw.
 * Empty when the evidence is missing or malformed, and no purpose accepts an empty list.
 */
function dependencies(record) {
  const { evidence, contradictions = [] } = record ?? {}
  return Array.isArray(evidence) && evidence.length > 0 && Array.isArray(contradictions)
    ? [...evidence, ...contradictions]
    : []
}

/** Whether a learning version relies on any of these events, as evidence or as counterevidence. */
function citesAny(record, ids) {
  return dependencies(record).some(
    (reference) =>
      Array.isArray(reference?.eventIds) && reference.eventIds.some((id) => ids.has(id)),
  )
}

/**
 * Every stored version of one review comment: the comment events in its thread that edit links
 * join to it, and any other version of the same Hub comment. Refuses a history whose links
 * leave the thread or join two Hub comments, rather than guess whose text to remove.
 */
function commentVersions(events, target) {
  const comments = new Map(
    events
      .filter((event) => event.type === "human_comment" && event.episodeId === target.episodeId)
      .map((event) => [event.id, event]),
  )
  const versions = new Set()
  let commentId
  function join(event) {
    if (versions.has(event.id)) return false
    const id = commentIdOf(event)
    if (id !== undefined) {
      if (commentId !== undefined && id !== commentId)
        throw new LearningError(
          "conflict",
          `The edit history of ${target.id} joins Hub comments ${commentId} and ${id}, so nothing was removed. Repair the history, then try again.`,
        )
      commentId = id
    }
    versions.add(event.id)
    return true
  }
  join(target)
  for (let grew = true; grew;) {
    grew = false
    for (const event of comments.values()) {
      const previous = event.supersedes
      if (previous !== undefined && (versions.has(event.id) || versions.has(previous))) {
        if (!comments.has(previous))
          throw new LearningError(
            "conflict",
            `${event.id} replaces ${previous}, which is not a comment in the same thread, so nothing was removed. Repair the history, then try again.`,
          )
        grew = join(event) || grew
        grew = join(comments.get(previous)) || grew
      } else if (commentId !== undefined && commentIdOf(event) === commentId) {
        grew = join(event) || grew
      }
    }
  }
  return versions
}

function hubThreadKey(episode) {
  const source = episode?.source
  if (
    source?.kind !== HUB_SOURCE ||
    [source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId].some(
      (value) => value === undefined,
    )
  )
    return null
  return canonicalJson([source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId])
}

/** Retractions follow the same Hub comment version across independently imported histories. */
function retractedEvents(episodes, events) {
  const episodeKeys = new Map(episodes.map((episode) => [episode.id, hubThreadKey(episode)]))
  const byId = new Map(events.map((event) => [event.id, event]))
  const comments = new Map()
  for (const event of events) {
    if (event.type !== "human_comment") continue
    const thread = episodeKeys.get(event.episodeId)
    const commentId = commentIdOf(event)
    if (!thread || commentId === undefined) continue
    const key = canonicalJson([thread, commentId])
    if (!comments.has(key)) comments.set(key, [])
    comments.get(key).push(event)
  }
  const retracted = new Set()
  for (const versions of comments.values()) {
    const deletedAt = versions
      .filter((event) => event.payload?.body === null && event.payload.deletedAt)
      .reduce(
        (latest, event) => (event.payload.deletedAt > latest ? event.payload.deletedAt : latest),
        "",
      )
    if (deletedAt)
      for (const event of versions)
        if (event.payload?.body !== null && event.at <= deletedAt) retracted.add(event.id)
  }
  for (const event of events) {
    if (event.type !== "retraction") continue
    retracted.add(targetOf(event))
    const target = byId.get(targetOf(event))
    const thread = episodeKeys.get(target?.episodeId)
    const commentId = target && commentIdOf(target)
    if (!thread || target?.type !== "human_comment" || commentId === undefined) continue
    const deleted =
      event.payload?.reason === "deleted_at_source" ||
      event.id === derivedId("ev", { episodeId: event.episodeId, retracts: target.id })
    for (const candidate of comments.get(canonicalJson([thread, commentId])) ?? []) {
      if (
        (deleted && candidate.at <= event.at) ||
        (candidate.at === target.at && candidate.actor.id === target.actor.id)
      )
        retracted.add(candidate.id)
    }
  }
  return retracted
}

/** What may be shown of a version that is damaged or whose evidence a purpose may not use. */
function metadataOf(version) {
  const metadata = {}
  for (const [key, valid] of Object.entries(METADATA))
    if (valid(version?.[key])) metadata[key] = version[key]
  return metadata
}

/**
 * The one replacement a learning records, read from its intact versions so that later damage
 * never releases it: its targets, when it was made, and whether it extended a learning that
 * was already accepted.
 */
function claimOf(entry) {
  const index = entry.intact.findIndex((version) => version.supersedes)
  if (index < 0) return null
  const version = entry.intact[index]
  return {
    targets: version.supersedes,
    at: version.updatedAt,
    extension: entry.intact[index - 1]?.state === "accepted",
  }
}

/** Fields each lifecycle step may change. Everything else must stay exactly as it was. */
const CHANGEABLE = {
  "proposed>accepted": [
    "version",
    "previousDigest",
    "state",
    "accepted",
    "updatedAt",
    "digest",
    "contentDigest",
    "reviewDigest",
    "content",
    "supersedes",
  ],
  "proposed>rejected": ["version", "previousDigest", "state", "rejected", "updatedAt", "digest"],
  "accepted>accepted": ["version", "previousDigest", "updatedAt", "digest", "supersedes"],
  "accepted>retired": ["version", "previousDigest", "state", "retired", "updatedAt", "digest"],
}

/**
 * Why one version cannot follow another. Accepting may change only the text, and only when it
 * records an edit, and it replaces exactly the learnings the reviewed lifecycle names. A
 * learning records what it replaces once: when it is accepted, or in one later step if it was
 * accepted without replacing anything. Other steps change only their own bookkeeping.
 */
function transitionProblems(previous, version) {
  const label = `version ${version.version}`
  const problems = []
  if (version.previousDigest !== previous.digest)
    problems.push(`${label} does not follow version ${previous.version}`)
  if (!TRANSITIONS[previous.state]?.includes(version.state))
    return [...problems, `${label} moves from ${previous.state} to ${version.state}`]
  const step = `${previous.state}>${version.state}`
  if (step === "proposed>proposed") {
    if (version.createdAt !== previous.createdAt)
      problems.push(`${label} changes when the learning was created`)
    return problems
  }
  const fixed = CHANGEABLE[step]
  if (canonicalJson(without(version, ...fixed)) !== canonicalJson(without(previous, ...fixed)))
    problems.push(
      `${label} changes something a ${previous.state} to ${version.state} step cannot change`,
    )
  if (step === "proposed>accepted") {
    if (version.accepted.reviewedDigest !== previous.reviewDigest)
      problems.push(`${label} approves something other than version ${previous.version}`)
    if (version.accepted.edited !== (version.content !== previous.content))
      problems.push(`${label} records an edit that does not match the text`)
    const expected = unique(previous.proposal.lifecycle.targets ?? [])
    if (
      canonicalJson([...(version.supersedes ?? [])].sort()) !== canonicalJson([...expected].sort())
    )
      problems.push(`${label} replaces learnings the reviewed lifecycle does not name`)
    if (version.supersedes?.includes(version.id)) problems.push(`${label} replaces itself`)
  }
  if (step === "proposed>rejected" && version.rejected.reviewedDigest !== previous.reviewDigest)
    problems.push(`${label} rejects something other than version ${previous.version}`)
  if (step === "accepted>accepted") {
    if (previous.supersedes)
      problems.push(`${label} changes what the learning replaces, which is fixed once recorded`)
    else if (!version.supersedes || version.supersedes.includes(version.id))
      problems.push(`${label} records no valid replacement`)
  }
  return problems
}

class LearningStore {
  #provider
  #manifest
  #clock
  #legacyScopes
  #originalDigests

  constructor(provider, manifest, clock, legacyScopes, digestMappings) {
    this.#provider = provider
    this.#manifest = manifest
    this.#clock = clock
    this.#legacyScopes = legacyScopes
    this.#originalDigests = new Map(
      Object.entries(digestMappings).map(([original, current]) => [current, original]),
    )
  }

  /** The provider manifest the store checked when it opened. */
  get manifest() {
    return structuredClone(this.#manifest)
  }

  async health() {
    return this.#provider.health()
  }

  async close() {
    await this.#provider.close?.()
  }

  #now() {
    return timestampFromMilliseconds(this.#clock())
  }

  /** Resolve the active scope on each operation, including migrations committed after opening. */
  async #migrationContext(scope) {
    const migrations = (await this.#provider.scopeMigrations?.(scope)) ?? []
    const scopes = new Map(
      [...this.#legacyScopes, ...migrations.map((migration) => migration.oldScope)].map(
        (legacy) => [canonicalJson(legacy), legacy],
      ),
    )
    const originalDigests = new Map(this.#originalDigests)
    for (const migration of migrations)
      for (const mapping of migration.digestMappings ?? [])
        if (mapping.kind === "memory" && mapping.field === "digest")
          originalDigests.set(mapping.newDigest, mapping.oldDigest)
    return { legacyScopes: [...scopes.values()], originalDigests, digest: digestOf(migrations) }
  }

  /**
   * Records from a stream in the caller's scope. Any record that fails its scope, schema, or
   * digest check stops the operation: dropping a damaged withdrawal or retraction would
   * silently restore a permission, so the store fails closed until verify finds the damage.
   */
  async #read(stream, context, query = {}) {
    const records = await this.#provider.readRecords(stream, { ...query, scope: context.scope })
    const damaged = records.filter(
      (record) =>
        !sameScope(record?.scope, context.scope) ||
        !validateRecord(STREAM_KINDS[stream], record).valid,
    )
    if (damaged.length)
      throw new LearningError(
        "storage_corrupt",
        `${damaged.length} ${stream} record(s) from provider ${this.#manifest.id} failed their checks. Run verify; learning operations stay blocked until the store is repaired.`,
      )
    if (stream === "collections" && conflictingCollections(records))
      throw new LearningError(
        "storage_corrupt",
        "Collections disagree about a snapshot. Run verify; learning operations stay blocked until the store is repaired.",
      )
    return records
  }

  /**
   * Append records to a stream. The receipts, the audit entries that record the change, go in
   * the same provider write, so a crash or an error never leaves the change without them.
   */
  async #append(stream, records, receipts = []) {
    if (!records.length && !receipts.length) return { appended: 0, existing: 0 }
    return this.#provider.appendRecords(stream, records, { audit: receipts })
  }

  /** An audit entry for an operation in this context, for a write to carry or #audit to append. */
  #auditEntry(context, operation, subjects, { purpose, outcome = "ok", reason } = {}) {
    const entry = sealRecord({
      schemaVersion: SCHEMA_VERSIONS.auditEntry,
      id: randomId("audit"),
      at: this.#now(),
      actor: context.principal,
      operation,
      scope: context.scope,
      ...(purpose ? { purpose } : {}),
      subjects: subjects.slice(0, SUBJECTS_PER_ENTRY),
      outcome,
      ...(reason ? { reason: reason.slice(0, 2000) } : {}),
      provider: { id: this.#manifest.id, version: this.#manifest.version },
    })
    assertValid("auditEntry", entry)
    return entry
  }

  /** Audit entries for an operation, as many as its subjects need, so every subject is named. */
  #auditEntries(context, operation, subjects, options) {
    const entries = []
    for (let start = 0; start === 0 || start < subjects.length; start += SUBJECTS_PER_ENTRY)
      entries.push(
        this.#auditEntry(
          context,
          operation,
          subjects.slice(start, start + SUBJECTS_PER_ENTRY),
          options,
        ),
      )
    return entries
  }

  /** Audit an operation that stores nothing else, such as a recall or a refusal. */
  async #audit(context, operation, subjects, options) {
    await this.#append("audit", [this.#auditEntry(context, operation, subjects, options)])
  }

  async #eligibility(context, at = this.#now()) {
    const [grants, withdrawals, collections, migrations] = await Promise.all([
      this.#read("grants", context),
      this.#read("withdrawals", context),
      this.#read("collections", context),
      this.#provider.scopeMigrations?.(context.scope) ?? [],
    ])
    const eligibility = createEligibility({ grants, withdrawals, at })
    const origins = new Map()
    for (const migration of migrations)
      for (const mapping of migration.digestMappings ?? [])
        if (mapping.field === "digest" && ["grant", "event"].includes(mapping.kind))
          origins.set(`${mapping.kind} ${mapping.id}`, canonicalJson(migration.oldScope))
    const byOrigin = new Map()
    const allGrantsFor = eligibility.grantsFor
    eligibility.grantsForEvent = (episode, event, purpose) => {
      const origin = origins.get(`event ${event.id}`)
      if (!origin) return allGrantsFor(episode, event.at, purpose)
      if (!byOrigin.has(origin))
        byOrigin.set(
          origin,
          createEligibility({
            grants: grants.filter((grant) => {
              const grantOrigin = origins.get(`grant ${grant.id}`)
              return !grantOrigin || grantOrigin === origin
            }),
            withdrawals,
            at,
          }),
        )
      return byOrigin.get(origin).grantsFor(episode, event.at, purpose)
    }
    eligibility.stableSources = collections
      .filter((collection) => collection.reviewerIdentity === "stable-user-id")
      .map((collection) => collection.source)
    eligibility.migrationScope = context.scope
    eligibility.migrationDigest = digestOf(migrations)
    return { eligibility, grants, withdrawals }
  }

  async #observations(context, query = {}) {
    let ids = query.episodeIds
    let migrationDigest
    if (query.eventIds !== undefined) {
      const selected = await this.#read("events", context, { ids: query.eventIds })
      ids = unique(selected.map((event) => event.episodeId)).filter(
        (id) => !query.episodeIds || query.episodeIds.includes(id),
      )
    }
    if (ids) {
      const migrations = (await this.#provider.scopeMigrations?.(context.scope)) ?? []
      migrationDigest = digestOf(migrations)
      const selected = new Set(ids)
      for (const migration of migrations)
        for (const group of migration.overlappingEpisodes ?? [])
          if (group.some((id) => selected.has(id))) for (const id of group) selected.add(id)
      if (migrations.length) {
        const episodes = await this.#read("episodes", context)
        const keys = new Set(
          episodes
            .filter((episode) => selected.has(episode.id))
            .map(hubThreadKey)
            .filter(Boolean),
        )
        for (const episode of episodes)
          if (keys.has(hubThreadKey(episode))) selected.add(episode.id)
      }
      ids = [...selected]
    }
    const [episodes, events] = await Promise.all([
      this.#read("episodes", context, ids ? { ids } : {}),
      this.#read("events", context, ids ? { episodeIds: ids } : {}),
    ])
    if (
      migrationDigest &&
      migrationDigest !== digestOf((await this.#provider.scopeMigrations?.(context.scope)) ?? [])
    )
      throw new LearningError("conflict", "Repository migration changed while reading. Try again.")
    const known = new Set(episodes.map((episode) => episode.id))
    return { episodes, events: events.filter((event) => known.has(event.episodeId)) }
  }

  /**
   * The evidence a purpose may use now. Each event needs an active grant that permits the
   * purpose and covers its episode's scope and source and the event's own time. A label, or a
   * record that a labeler found nothing to label, inherits from the comment it judges: it is
   * usable only while that comment is, and its time is the comment's time. Retracted and
   * redacted events are never usable.
   */
  async #eligible({ episodes, events }, eligibility, purpose) {
    if (
      eligibility.migrationDigest !==
      digestOf((await this.#provider.scopeMigrations?.(eligibility.migrationScope)) ?? [])
    )
      throw new LearningError("conflict", "Repository migration changed while reading. Try again.")
    const episodesById = new Map(episodes.map((episode) => [episode.id, episode]))
    const byId = new Map(events.map((event) => [event.id, event]))
    const retracted = retractedEvents(episodes, events)
    const copies = new Map()
    const commentVersions = new Map()
    const evidenceGrants = new Map()
    for (const event of events) {
      if (event.type !== "human_comment") continue
      const thread = hubThreadKey(episodesById.get(event.episodeId))
      const commentId = commentIdOf(event)
      if (!thread || commentId === undefined) continue
      const key = canonicalJson([thread, commentId, event.at])
      copies.set(key, [...(copies.get(key) ?? []), event])
      const identity = canonicalJson([thread, commentId])
      if (!commentVersions.has(identity)) commentVersions.set(identity, [])
      commentVersions.get(identity).push(event)
    }
    const identityObsolete = new Set(
      events
        .filter(
          (event) => event.type === "retraction" && event.payload?.reason === "identity_corrected",
        )
        .map(targetOf),
    )
    for (const event of events) {
      const episode = episodesById.get(event.episodeId)
      if (
        event.type === "human_comment" &&
        episode?.source.kind === HUB_SOURCE &&
        eligibility.stableSources.some(
          (source) =>
            source.hubOrigin === episode.source.hubOrigin &&
            source.repositoryId === episode.source.repositoryId,
        ) &&
        !stableReviewer(event.actor, episode.scope, episode.source)
      )
        identityObsolete.add(event.id)
    }
    for (const event of events)
      if (JUDGMENTS.has(event.type) && identityObsolete.has(targetOf(event)))
        identityObsolete.add(event.id)
    function covered(event) {
      const episode = episodesById.get(event.episodeId)
      const stableSource = eligibility.stableSources.some(
        (source) =>
          source.kind === HUB_SOURCE &&
          episode?.source.kind === HUB_SOURCE &&
          source.hubOrigin === episode.source.hubOrigin &&
          source.repositoryId === episode.source.repositoryId,
      )
      const thread = hubThreadKey(episode)
      const commentId = event.type === "human_comment" ? commentIdOf(event) : undefined
      const related =
        thread && commentId !== undefined
          ? copies.get(canonicalJson([thread, commentId, event.at]))
          : [event]
      const grants = related.map((copy) =>
        eligibility.grantsForEvent(episodesById.get(copy.episodeId), copy, purpose),
      )
      const permitted =
        related.every(
          (copy) =>
            copy.payload !== undefined &&
            (!retracted.has(copy.id) || copy.actor.id !== event.actor.id),
        ) && grants.every((items) => items.length)
      if (permitted) evidenceGrants.set(event.id, unique(grants.flat()))
      return (
        !retracted.has(event.id) &&
        event.payload !== undefined &&
        (purpose === "review" ||
          !stableSource ||
          event.type !== "human_comment" ||
          stableReviewer(event.actor, episode.scope, episode.source)) &&
        permitted
      )
    }
    const kept = events.filter((event) => {
      if (!episodesById.has(event.episodeId)) return false
      if (!JUDGMENTS.has(event.type)) return covered(event)
      if (event.payload === undefined || retracted.has(event.id)) return false
      const target = byId.get(targetOf(event))
      return (
        Boolean(target) &&
        target.episodeId === event.episodeId &&
        !JUDGMENTS.has(target.type) &&
        covered(target)
      )
    })
    const eventsById = new Map(kept.map((event) => [event.id, event]))
    const hiddenEdits = new Set()
    for (const versions of commentVersions.values()) {
      const latest = versions.reduce((time, event) => (event.at > time ? event.at : time), "")
      if (versions.some((event) => event.at === latest && eventsById.has(event.id))) continue
      for (const event of versions)
        if (event.at < latest && eventsById.has(event.id)) hiddenEdits.add(event.id)
    }
    const episodeIds = new Set(kept.map((event) => event.episodeId))
    return {
      episodes: episodes.filter((episode) => episodeIds.has(episode.id)),
      events: kept,
      episodeIds,
      episodesById,
      eventsById,
      evidenceGrants,
      retracted,
      identityObsolete,
      migrationDigest: eligibility.migrationDigest,
      hiddenEdits,
    }
  }

  /** Whether a non-empty list of references resolves to usable events in the episodes named. */
  #evidenceEligible(references, eligible) {
    return (
      references.length > 0 &&
      references.every(
        (reference) =>
          eligible.episodeIds.has(reference?.episodeId) &&
          Array.isArray(reference.eventIds) &&
          reference.eventIds.length > 0 &&
          reference.eventIds.every(
            (eventId) => eligible.eventsById.get(eventId)?.episodeId === reference.episodeId,
          ),
      )
    )
  }

  /**
   * Rebuild a proposer's evidence reference from the stored records. The source pin, time,
   * and author always come from storage; a proposer that states different ones is refused.
   */
  #canonicalEvidence(reference, eligible, purpose) {
    const events = reference.eventIds.map((eventId) => eligible.eventsById.get(eventId))
    if (
      !eligible.episodeIds.has(reference.episodeId) ||
      events.some((event) => !event || event.episodeId !== reference.episodeId)
    )
      throw new LearningError(
        "purpose_not_granted",
        `Evidence in ${reference.episodeId} is missing, retracted, outside that episode, or not permitted for ${purpose}.`,
      )
    const source = eligible.episodesById.get(reference.episodeId).source
    const pin = {}
    for (const key of PIN_KEYS) if (source[key] !== undefined) pin[key] = source[key]
    const comments = unique(
      events
        .map((event) =>
          JUDGMENTS.has(event.type) ? eligible.eventsById.get(targetOf(event)) : event,
        )
        .map((event) => event?.payload?.commentId)
        .filter((commentId) => commentId !== undefined),
    )
    if (comments.length === 1) pin.commentId = comments[0]
    const authors = unique(events.map((event) => event.actor.id))
    const canonical = {
      episodeId: reference.episodeId,
      eventIds: reference.eventIds,
      source: pin,
      observedAt: events[0].at,
      ...(authors.length === 1
        ? { author: { kind: events[0].actor.kind, id: events[0].actor.id } }
        : {}),
      ...(reference.artifacts ? { artifacts: reference.artifacts } : {}),
    }
    for (const key of ["source", "observedAt", "author"])
      if (
        reference[key] !== undefined &&
        canonicalJson(reference[key]) !== canonicalJson(canonical[key] ?? null)
      )
        throw new LearningError(
          "invalid_input",
          `Evidence ${key} for ${reference.episodeId} does not match the stored records.`,
        )
    return canonical
  }

  /**
   * Every memory in scope with its version history, its intact versions, and any integrity
   * problems. A history must start as a proposal and follow the lifecycle: a decision must name
   * the version it reviewed, and each step may change only its own fields. The intact versions
   * are those before the first problem.
   */
  async #memories(context, ids) {
    const versions = await this.#provider.readMemoryVersions({
      scope: context.scope,
      ...(ids ? { ids } : {}),
    })
    const grouped = new Map()
    for (const version of versions) {
      if (!sameScope(version?.scope, context.scope)) continue
      if (!grouped.has(version.id)) grouped.set(version.id, [])
      grouped.get(version.id).push(version)
    }
    const entries = new Map()
    for (const [id, list] of grouped) {
      const problems = []
      let intact = list.length
      let previousValid = false
      list.forEach((version, index) => {
        const found = []
        const result = validateRecord("memoryRecord", version)
        if (!result.valid) found.push(`version ${version.version}: ${result.errors.join("; ")}`)
        if (version.version !== index + 1)
          found.push(`version ${index + 1} is numbered ${version.version}`)
        if (index === 0) {
          if (version.state !== "proposed") found.push("version 1 must be a proposal")
        } else if (result.valid && previousValid)
          found.push(...transitionProblems(list[index - 1], version))
        if (found.length && intact === list.length) intact = index
        problems.push(...found)
        previousValid = result.valid
      })
      entries.set(id, {
        id,
        record: list.at(-1),
        versions: list,
        intact: list.slice(0, intact),
        problems,
      })
    }
    return entries
  }

  #statusOf(entry, eligible, now) {
    const { record, problems } = entry
    const approvalValid =
      problems.length === 0 &&
      Boolean(record.accepted) &&
      record.accepted.contentDigest === record.contentDigest
    const { expired, notYetValid } = validity(record, now)
    const evidenceEligible =
      problems.length === 0 && this.#evidenceEligible(dependencies(record), eligible)
    const identityNeedsReview = dependencies(record).some(
      (reference) =>
        Array.isArray(reference?.eventIds) &&
        reference.eventIds.some((id) => eligible.identityObsolete.has(id)),
    )
    const inEffect = record.state === "accepted" && approvalValid && !expired && !notYetValid
    return {
      recallEligible: inEffect && evidenceEligible,
      inEffect,
      needsRebuild: record.state === "accepted" && approvalValid && !evidenceEligible,
      identityNeedsReview,
      approvalValid,
      expired,
      notYetValid,
      superseded: false,
      evidenceEligible,
      supersededBy: [],
      conflicts: [],
      problems: [...problems],
    }
  }

  /**
   * Every memory with its status for a purpose. A learning records what it replaces once, and
   * readers settle racing replacements the same way every time: in the order they were made, a
   * replacement takes effect only if none of its targets was already replaced, and then it
   * replaces all of them. A replacement that loses replaces nothing. If it came with the
   * acceptance, the learning is not used; if it extended a learning already in use, that
   * learning stays as it was. Claims come only from intact versions, and a replacement that is
   * later retired or damaged keeps them, so nothing quietly brings an old learning back.
   */
  async #statuses(context, purpose = "instruction") {
    const now = this.#now()
    const [{ eligibility }, observations, entries] = await Promise.all([
      this.#eligibility(context, now),
      this.#observations(context),
      this.#memories(context),
    ])
    const eligible = await this.#eligible(observations, eligibility, purpose)
    const items = [...entries.values()].map((entry) => ({
      ...entry,
      status: this.#statusOf(entry, eligible, now),
    }))
    const replacements = items
      .map((item) => ({ item, claim: claimOf(item) }))
      .filter(({ claim }) => claim)
      .sort(
        (left, right) =>
          compare(left.claim.at, right.claim.at) || compare(left.item.id, right.item.id),
      )
    const claimed = new Map()
    for (const { item, claim } of replacements) {
      const taken = claim.targets.filter((target) => claimed.has(target))
      if (claimed.has(item.id)) taken.push(item.id)
      if (taken.length) {
        item.status.conflicts.push(
          ...taken.map((target) => `${claimed.get(target)} replaced ${target} first`),
        )
        if (!claim.extension) {
          item.status.inEffect = false
          item.status.recallEligible = false
        }
        continue
      }
      for (const target of claim.targets) claimed.set(target, item.id)
    }
    for (const item of items)
      if (claimed.has(item.id)) {
        item.status.superseded = true
        item.status.supersededBy = [claimed.get(item.id)]
        item.status.inEffect = false
        item.status.recallEligible = false
      }
    return { items, eligible, now }
  }

  /**
   * A learning as a purpose may read it: in full, without its content and evidence when its
   * evidence is not permitted, or only strictly checked metadata when its history is damaged.
   */
  #project(item) {
    if (item.problems.length)
      return { record: metadataOf(item.record), status: item.status, withheld: true }
    if (item.status.evidenceEligible)
      return { record: item.record, status: item.status, withheld: false }
    const record = without(item.record, "content", "evidence", "contradictions", "appliesTo")
    record.proposal = without(item.record.proposal, "rationale")
    return { record, status: item.status, withheld: true }
  }

  /** Which parts of a window complete, unfiltered collections cover. */
  async #coverage(context, window) {
    const collections = (await this.#read("collections", context)).filter(
      (item) => item.source.kind === HUB_SOURCE,
    )
    const complete = collections.filter(
      (item) => item.complete && item.filters.resolution === "all" && item.filters.read === "all",
    )
    const intervals = complete
      .map((item) => {
        const end =
          item.filters.to && item.filters.to < item.capturedAt ? item.filters.to : item.capturedAt
        return [item.filters.from ?? EARLIEST, end]
      })
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    const gaps = []
    let cursor = window.from
    for (const [start, end] of intervals) {
      if (cursor >= window.to) break
      if (end <= cursor) continue
      if (start > cursor) {
        gaps.push({ from: cursor, to: start < window.to ? start : window.to })
        if (start >= window.to) {
          cursor = window.to
          break
        }
      }
      cursor = end
    }
    if (cursor < window.to) gaps.push({ from: cursor, to: window.to })
    const partial = collections
      .filter((item) => !complete.includes(item))
      .map(
        (item) =>
          `Collection ${item.id} is ${item.complete ? "filtered" : "incomplete"} and was not counted.`,
      )
    return { complete: gaps.length === 0, gaps, notes: partial }
  }

  // Consent grants

  /**
   * Record a person's permission to use evidence from sources for purposes in this scope.
   *
   * @param {object} context
   * @param {{ purposes: string[], sources: string[], basis: string, expiresAt?: string, evidenceFrom?: string, evidenceUntil?: string }} input
   */
  async addGrant(
    context,
    { purposes, sources, basis, expiresAt, evidenceFrom, evidenceUntil } = {},
  ) {
    assertContext(context)
    requireHuman(context, "grant consent")
    const grant = sealRecord({
      schemaVersion: SCHEMA_VERSIONS.consentGrant,
      id: randomId("grant"),
      scope: context.scope,
      purposes: PURPOSES.filter((purpose) => purposes?.includes(purpose)),
      sources: unique(sources ?? []),
      grantedBy: context.principal,
      grantedAt: this.#now(),
      ...(expiresAt ? { expiresAt } : {}),
      ...(evidenceFrom ? { evidenceFrom } : {}),
      ...(evidenceUntil ? { evidenceUntil } : {}),
      basis,
    })
    if (purposes?.some((purpose) => !PURPOSES.includes(purpose)))
      throw new LearningError("invalid_input", `Purposes are ${PURPOSES.join(", ")}.`)
    assertValid("consentGrant", grant)
    await this.#append(
      "grants",
      [grant],
      [
        this.#auditEntry(context, "grant.add", [
          { kind: "grant", id: grant.id, digest: grant.digest },
        ]),
      ],
    )
    return grant
  }

  /** Every grant in scope with the purposes it permits now. */
  async listGrants(context) {
    assertContext(context)
    const now = this.#now()
    const { eligibility, grants } = await this.#eligibility(context, now)
    return grants.map((grant) => ({
      grant,
      activePurposes: eligibility.activePurposes(grant),
      withdrawnPurposes: eligibility.withdrawnPurposes(grant),
      expired: Boolean(grant.expiresAt && grant.expiresAt <= now),
    }))
  }

  /** Every durable withdrawal in scope, for a host that reconciles external copies. */
  async listWithdrawals(context) {
    assertContext(context)
    return this.#read("withdrawals", context)
  }

  /**
   * End purposes of a grant. Evidence covered only by those purposes stops serving them at
   * once, and learnings built on it stop being recalled. The result lists those learnings and
   * the exports that already copied covered evidence, so their owners can be asked to delete it.
   * Every export records the grants that permitted what it copied, each judged at the time its
   * evidence was written, so an export is listed exactly when it names this grant.
   */
  async withdrawGrant(context, grantId, { purposes, reason } = {}) {
    assertContext(context)
    requireHuman(context, "withdraw consent")
    const { grants } = await this.#eligibility(context)
    const grant = grants.find((item) => item.id === grantId)
    if (!grant) throw new LearningError("not_found", `No grant ${grantId} in this scope.`)
    const ending = PURPOSES.filter((purpose) => (purposes ?? grant.purposes).includes(purpose))
    if (!ending.length || ending.some((purpose) => !grant.purposes.includes(purpose)))
      throw new LearningError(
        "invalid_input",
        `Grant ${grantId} covers only ${grant.purposes.join(", ")}.`,
      )
    const before = new Map(
      (await this.#statuses(context)).items.map((item) => [item.id, item.status.recallEligible]),
    )
    const withdrawal = sealRecord({
      schemaVersion: SCHEMA_VERSIONS.grantWithdrawal,
      id: randomId("withdrawal"),
      grantId,
      scope: context.scope,
      purposes: ending,
      withdrawnBy: context.principal,
      withdrawnAt: this.#now(),
      ...(reason ? { reason } : {}),
    })
    assertValid("grantWithdrawal", withdrawal)
    await this.#append(
      "withdrawals",
      [withdrawal],
      [
        this.#auditEntry(
          context,
          "grant.withdraw",
          [
            { kind: "grant", id: grant.id, digest: grant.digest },
            { kind: "withdrawal", id: withdrawal.id, digest: withdrawal.digest },
          ],
          { reason: `Ended ${ending.join(", ")}` },
        ),
      ],
    )
    const after = (await this.#statuses(context)).items
    const memories = after
      .filter((item) => before.get(item.id) && !item.status.recallEligible)
      .map((item) => item.id)
    const exports = (await this.#read("exports", context))
      .filter(
        (manifest) =>
          ending.includes(manifest.purpose) &&
          manifest.records.some((record) => record.kind === "grant" && record.id === grant.id),
      )
      .map((manifest) => ({
        id: manifest.id,
        purpose: manifest.purpose,
        destination: manifest.destination,
      }))
    return { withdrawal, memoriesNeedingRebuild: memories, exportsToFollowUp: exports }
  }

  /**
   * Remove the text of a review comment from storage, for example when its author asks.
   * Every stored version of the comment, and every label on those versions, keeps its ID and
   * digest but loses its payload, with a note of who removed it, when, and why. Other comments,
   * replies included, are untouched, and a history that links this comment to another one is
   * refused. A redacted event is never evidence again, so accepted learnings that cite it need
   * rebuilding. The result lists them, and the exports that copied the comment or a learning
   * version citing it, so their owners can be asked to delete those copies. A learning's own
   * text is not rewritten. Each removed event gets one audit entry, built from its redaction
   * note. Running it again after a failure finishes the removal, audits what is missing, and
   * reports the same follow-ups. Importing the same Hub snapshot again does not bring the
   * text back; a later edit on Hub arrives as new content. Needs a provider with the
   * observation.redact capability. The host must not call it while an import or labeling of the
   * same store is in progress, for the reason redactHubComment gives.
   */
  async redactComment(context, eventId, { reason } = {}) {
    assertContext(context)
    requireHuman(context, "redact a comment")
    assertRemovalReason(reason)
    this.#assertRedactable()
    const { episodes, events } = await this.#observations(context)
    const target = events.find((event) => event.id === eventId)
    if (target?.type !== "human_comment")
      throw new LearningError("not_found", `No review comment event ${eventId} in this scope.`)
    return this.#removeCommentText(context, episodes, events, [target], reason)
  }

  /**
   * Remove the text of one Hub comment, named by its Hub comment ID, as redactComment does:
   * every stored version of it and every label on those versions. A host that erases a deleted
   * comment, such as Hub, calls it so the store keeps none of the comment's text. It imports and
   * labels nothing and needs no active grant, so it works while the host collects nothing. A
   * comment the store does not hold, or whose text is already gone, removes nothing. The reason
   * says by default that the comment was deleted at its source.
   *
   * The host must not call it while an import or labeling of the same store is in progress. It
   * reads the comment's events before it removes their text, so text that an import or a label
   * stores in between stays, and verify does not report it. Later imports must show the comment
   * as deleted and use redactDeleted, which removes what stayed. Hub meets both: its runs and its
   * deletion job take turns through one job queue key, and its imports use redactDeleted.
   *
   * @param {object} context a person, such as the comment's author
   * @param {number} commentId the comment's ID on Hub
   * @param {{ reason?: string }} [options]
   */
  async redactHubComment(context, commentId, { reason = DELETED_AT_SOURCE } = {}) {
    assertContext(context)
    requireHuman(context, "redact a comment")
    if (!Number.isSafeInteger(commentId) || commentId < 1)
      throw new LearningError("invalid_input", "A Hub comment ID is a positive whole number.")
    assertRemovalReason(reason)
    this.#assertRedactable()
    const { episodes, events } = await this.#observations(context)
    const versions = events.filter(
      (event) => event.type === "human_comment" && commentIdOf(event) === commentId,
    )
    if (!versions.length) return { redacted: [], memoriesNeedingRebuild: [], exportsToFollowUp: [] }
    return this.#removeCommentText(context, episodes, events, versions, reason)
  }

  #assertRedactable() {
    if (
      !this.#manifest.capabilities.includes(REDACT_CAPABILITY) ||
      typeof this.#provider.redactRecord !== "function"
    )
      throw new LearningError(
        "unsupported",
        `Provider ${this.#manifest.id} cannot redact records. Use a provider with the ${REDACT_CAPABILITY} capability.`,
      )
  }

  /**
   * Removes the text of every version of the target comments and of every label on them, audits
   * each removal once, and reports the accepted learnings and exports that cite them. Running it
   * again finishes an interrupted removal and reports the same follow-ups.
   */
  async #removeCommentText(context, episodes, events, targets, reason) {
    const episodeKeys = new Map(episodes.map((episode) => [episode.id, hubThreadKey(episode)]))
    for (const target of [...targets]) {
      const thread = episodeKeys.get(target.episodeId)
      const commentId = commentIdOf(target)
      if (!thread || commentId === undefined) continue
      for (const event of events)
        if (
          event.type === "human_comment" &&
          episodeKeys.get(event.episodeId) === thread &&
          commentIdOf(event) === commentId &&
          !targets.some((item) => item.id === event.id)
        )
          targets.push(event)
    }
    const versions = new Set(targets.flatMap((target) => [...commentVersions(events, target)]))
    const chosen = events.filter(
      (event) =>
        versions.has(event.id) || (event.type === "annotation" && versions.has(targetOf(event))),
    )
    const ids = new Set(chosen.map((event) => event.id))
    // The follow-ups depend only on what cites these events, not on what this call changes, so
    // a retry after a failure reports them again.
    const memories = (await this.#statuses(context)).items
      .filter(
        (item) =>
          item.record.state === "accepted" &&
          item.status.approvalValid &&
          !item.status.superseded &&
          citesAny(item.record, ids),
      )
      .map((item) => item.id)
    const citing = new Set(
      (await this.#provider.readMemoryVersions({ scope: context.scope }))
        .filter((version) => sameScope(version?.scope, context.scope) && citesAny(version, ids))
        .map((version) => `${version.id} ${version.digest}`),
    )
    const exports = (await this.#read("exports", context))
      .filter((manifest) =>
        manifest.records.some(
          (record) =>
            (record.kind === "event" && ids.has(record.id)) ||
            (record.kind === "memory" && citing.has(`${record.id} ${record.digest}`)),
        ),
      )
      .map((manifest) => ({
        id: manifest.id,
        purpose: manifest.purpose,
        destination: manifest.destination,
      }))
    const now = this.#now()
    const redacted = []
    for (const event of chosen.filter((item) => item.payload !== undefined)) {
      const copy = {
        ...without(event, "payload"),
        redaction: {
          at: now,
          by: context.principal,
          reason,
          ...(event.type === "human_comment" ? { commentId: event.payload.commentId } : {}),
        },
      }
      assertValid("event", copy)
      if ((await this.#provider.redactRecord("events", copy))?.redacted) redacted.push(copy)
    }
    // One audit entry per removed event, built only from the note the event stores. A retry
    // after a failure, or a call racing this one, builds the same entry, so each is written once.
    const receipts = (await this.#read("events", context, { ids: [...ids] }))
      .filter((event) => event.payload === undefined && event.redaction)
      .map((event) =>
        sealRecord({
          schemaVersion: SCHEMA_VERSIONS.auditEntry,
          id: derivedId("audit", {
            operation: "evidence.redact",
            event: event.id,
            digest: event.digest,
          }),
          at: event.redaction.at,
          actor: event.redaction.by,
          operation: "evidence.redact",
          scope: context.scope,
          subjects: [{ kind: "event", id: event.id, digest: event.digest }],
          outcome: "ok",
          reason: event.redaction.reason,
          provider: { id: this.#manifest.id, version: this.#manifest.version },
        }),
      )
    for (const entry of receipts) assertValid("auditEntry", entry)
    // Any earlier successful entry that names the event and its digest already audits it,
    // whatever its ID or however many events it names.
    const audited = new Set(
      (await this.#read("audit", context, { operations: ["evidence.redact"] }))
        .filter((entry) => entry.operation === "evidence.redact" && entry.outcome === "ok")
        .flatMap((entry) => entry.subjects)
        .filter((subject) => subject.kind === "event")
        .map((subject) => `${subject.id} ${subject.digest}`),
    )
    const fresh = receipts.filter(
      (entry) => !audited.has(`${entry.subjects[0].id} ${entry.subjects[0].digest}`),
    )
    if (fresh.length) await this.#append("audit", fresh)
    return {
      redacted: redacted.map((event) => event.id),
      memoriesNeedingRebuild: memories,
      exportsToFollowUp: exports,
    }
  }

  // Observations

  /**
   * Import a log of canvas comment calls. Episodes and events are derived, so importing the
   * same comments again adds nothing, and edits, deletions, and resolution changes are
   * appended as new events.
   *
   * A collection records the digest of the snapshot's normalized contents. Importing a
   * snapshot again keeps the stored collection; scope migration can retain multiple matching
   * collections. Different contents under the same snapshot ID are refused. Normal imports
   * enforce uniqueness in the same write as the comments, so of two imports that race, only
   * one is stored.
   *
   * A deletion retracts the comment from every purpose and keeps its text. With redactDeleted,
   * the import then removes the text of every comment the snapshot shows as deleted, and of
   * the labels on it, as redactComment does, recorded as the importer's action. It also
   * finishes a removal that an earlier import left incomplete. A host that erases deleted
   * comments, as Hub does, uses it so the store does not keep text the host has erased.
   *
   * @param {object} context
   * @param {unknown} log a replica.hub-review-collection/v1 log
   * @param {{ grantIds: string[], redactDeleted?: boolean }} options grants that name
   *   hub_review_comments and permit review
   */
  async importHubReviewComments(context, log, { grantIds = [], redactDeleted = false } = {}) {
    assertContext(context)
    if (!context.scope.repository)
      throw new LearningError("invalid_input", "Importing Hub comments needs a repository scope.")
    if (redactDeleted) this.#assertRedactable()
    const now = this.#now()
    const { eligibility, grants } = await this.#eligibility(context, now)
    if (!grantIds.length)
      throw new LearningError(
        "purpose_not_granted",
        "Name the consent grant that covers these comments with --grant.",
      )
    for (const grantId of grantIds) {
      const grant = grants.find((item) => item.id === grantId)
      if (!grant) throw new LearningError("not_found", `No grant ${grantId} in this scope.`)
      if (!grant.sources.includes(HUB_SOURCE))
        throw new LearningError(
          "purpose_not_granted",
          `Grant ${grantId} does not name ${HUB_SOURCE}.`,
        )
      if (!eligibility.activePurposes(grant).includes("review"))
        throw new LearningError(
          "grant_inactive",
          `Grant ${grantId} does not currently permit review.`,
        )
    }
    const migration = await this.#migrationContext(context.scope)
    if (migration.digest !== eligibility.migrationDigest)
      throw new LearningError("conflict", "Repository migration changed while reading. Try again.")
    const { legacyScopes } = migration
    const collections = await this.#read("collections", context)
    const repository = context.sourceRepository ?? context.scope.repository
    let collection
    let historicalSource = false
    try {
      collection = readHubReviewCollection(log, { repository })
    } catch (error) {
      if (error.code !== "scope_violation") throw error
      const historicalRepositories = unique([
        ...legacyScopes.map((scope) => scope.repository),
        ...collections.map((item) => item.source.repository),
      ]).filter((name) => name && name !== repository)
      for (const name of historicalRepositories) {
        try {
          collection = readHubReviewCollection(log, { repository: name })
          historicalSource = true
          break
        } catch (legacyError) {
          if (legacyError.code !== "scope_violation") throw legacyError
        }
      }
      if (!collection) throw error
    }
    const { snapshotId } = collection.meta
    const snapshotDigest = digestOf({
      meta: collection.meta,
      filters: collection.filters,
      complete: collection.complete,
      problems: collection.problems,
      threads: collection.threads,
    })
    const snapshot = {
      snapshotId,
      snapshotDigest,
      source: {
        kind: HUB_SOURCE,
        hubOrigin: collection.meta.hubOrigin,
        repository: collection.meta.repository,
        repositoryId: collection.meta.repositoryId,
      },
      ...(collection.meta.reviewerIdentity
        ? { reviewerIdentity: collection.meta.reviewerIdentity }
        : {}),
      capturedAt: collection.meta.capturedAt,
      filters: collection.filters,
      complete: collection.complete,
      problems: collection.problems.slice(0, 1000).map((problem) => problem.slice(0, 2000)),
      counts: { ...collection.counts, episodes: collection.threads.length },
    }
    const id = derivedId("col", { scope: context.scope, snapshotId })
    const reused = new LearningError(
      "conflict",
      `Snapshot ${snapshotId} was already imported with different contents, so nothing was imported. Collect a new snapshot and import that.`,
    )
    const adopted = collections.some(
      (item) =>
        item.reviewerIdentity === "stable-user-id" &&
        item.source.hubOrigin === collection.meta.hubOrigin &&
        item.source.repositoryId === collection.meta.repositoryId,
    )
    const matches = collections.filter((item) => item.snapshotId === snapshotId)
    const previous = matches[0]
    if (historicalSource && !previous)
      throw new LearningError(
        "scope_violation",
        "An earlier repository name may only be used to replay a snapshot already in this store.",
      )
    if (matches.some((item) => !sameCollectionSnapshot(item, snapshot))) throw reused
    const newer = collections.some(
      (item) =>
        item.source.kind === HUB_SOURCE &&
        item.source.hubOrigin === collection.meta.hubOrigin &&
        item.source.repositoryId === collection.meta.repositoryId &&
        item.capturedAt > collection.meta.capturedAt,
    )
    if (newer && !previous)
      throw new LearningError(
        "conflict",
        `Snapshot ${snapshotId} is older than a snapshot already imported from this Hub repository, so nothing was imported. Collect a new snapshot and import that.`,
      )
    const candidateIds = collection.threads.map((thread) =>
      [context.scope, ...legacyScopes].map((scope) =>
        hubEpisodeId(scope, collection.meta, thread.root),
      ),
    )
    const stored = await this.#read("episodes", context, { ids: unique(candidateIds.flat()) })
    const known = new Set(stored.map((episode) => episode.id))
    const episodeIds = candidateIds.map((ids) => {
      const matches = unique(ids.filter((id) => known.has(id)))
      return matches.length ? matches : [ids[0]]
    })
    const existingEvents = await this.#read("events", context, {
      episodeIds: unique(episodeIds.flat()),
    })
    const episodes = []
    const events = []
    for (const [index, thread] of collection.threads.entries()) {
      if (previous) continue
      const ids = episodeIds[index]
      const threadEvents = existingEvents.filter((event) => ids.includes(event.episodeId))
      const byId = new Map(threadEvents.map((event) => [event.id, event]))
      const deleted = new Set(
        threadEvents
          .filter((event) => {
            if (event.type === "human_comment")
              return event.payload?.body === null && event.payload.deletedAt
            if (event.type !== "retraction") return false
            const target = byId.get(event.parentEventId)
            return (
              event.payload?.reason === "deleted_at_source" ||
              (target &&
                event.id === derivedId("ev", { episodeId: event.episodeId, retracts: target.id }))
            )
          })
          .map((event) => {
            if (event.type === "human_comment") return commentIdOf(event)
            const target = byId.get(event.parentEventId)
            return target ? commentIdOf(target) : undefined
          })
          .filter((id) => id !== undefined),
      )
      if ([thread.root, ...thread.replies].some((item) => deleted.has(item.id) && !item.deletedAt))
        throw new LearningError(
          "conflict",
          "A newer snapshot would restore a comment already deleted at its source.",
        )
      for (const episodeId of ids) {
        if (!known.has(episodeId))
          episodes.push(
            sealEpisode(
              hubThreadEpisode({
                meta: collection.meta,
                thread,
                scope: context.scope,
                grantIds,
                principal: context.principal,
                importedAt: now,
              }),
            ),
          )
        const existing = threadEvents.filter((event) => event.episodeId === episodeId)
        const additions = hubThreadEvents({
          meta: collection.meta,
          thread,
          scope: context.scope,
          episodeId,
          existing,
        })
        const removedRoots = new Map()
        for (const event of additions) {
          if (event.type !== "human_comment") continue
          const removed = threadEvents.some(
            (item) =>
              item.type === "human_comment" &&
              item.redaction &&
              commentIdOf(item) === event.payload.commentId &&
              (event.at <= item.redaction.at || item.at === event.at),
          )
          if (!removed) continue
          if (event.payload.role === "root") {
            const root = existing.find(
              (item) => item.type === "human_comment" && commentIdOf(item) === thread.root.id,
            )
            if (!root)
              throw new LearningError("storage_corrupt", "A stored review thread has no root.")
            removedRoots.set(event.id, root.id)
          } else removedRoots.set(event.id, null)
        }
        for (const event of additions) {
          if (removedRoots.has(event.id)) continue
          if (removedRoots.has(event.parentEventId)) {
            const parent = removedRoots.get(event.parentEventId)
            if (!parent) continue
            event.parentEventId = parent
          }
          events.push(sealEvent(event))
        }
      }
    }
    for (const episode of episodes) assertValid("episode", episode)
    for (const event of events) assertValid("event", event)
    const record =
      previous ??
      sealRecord({
        schemaVersion: SCHEMA_VERSIONS.collection,
        id,
        ...snapshot,
        scope: context.scope,
        counts: {
          ...snapshot.counts,
          events: events.length,
        },
        importedAt: now,
        importedBy: context.principal,
      })
    assertValid("collection", record)
    // One write, so a failure stores none of the episodes, events, collection, or audit entries.
    try {
      await this.#provider.appendBatch(
        { episodes, events, collections: [record] },
        {
          ...(this.#provider.atomicMigrationFence
            ? {
                expectedMigrations: {
                  scope: context.scope,
                  digest: migration.digest,
                },
              }
            : {}),
          ...(this.#provider.atomicCollectionImport
            ? {
                expectedCollection: {
                  scope: context.scope,
                  records: collections
                    .map(({ id: collectionId, digest }) => ({ id: collectionId, digest }))
                    .sort((a, b) => compare(a.id, b.id)),
                },
              }
            : {}),
          audit: this.#auditEntries(context, "collection.import", [
            { kind: "collection", id: record.id, digest: record.digest },
            ...episodes.map((episode) => ({
              kind: "episode",
              id: episode.id,
              digest: episode.digest,
            })),
            ...events.map((event) => ({ kind: "event", id: event.id, digest: event.digest })),
          ]),
        },
      )
    } catch (error) {
      if (error?.code !== "conflict") throw error
      const current = (await this.#read("collections", context)).filter(
        (item) => item.snapshotId === snapshotId,
      )
      if (current.some((item) => !sameCollectionSnapshot(item, snapshot))) throw reused
      throw new LearningError(
        "conflict",
        `Another import stored some of these comments while this one ran, so nothing was imported. Import ${snapshotId} again.`,
      )
    }
    const removal = redactDeleted
      ? await this.#removeDeletedText(
          context,
          collection,
          [...stored, ...episodes],
          [...existingEvents, ...events],
        )
      : null
    const identityUpdates =
      collection.meta.reviewerIdentity || adopted
        ? {
            reason:
              "Reviewer identity changed or remains unverified. Rebuild and review affected learnings.",
            eventIds: events
              .filter((event) => event.payload?.reason === "identity_corrected")
              .map((event) => event.parentEventId),
            memoryIds: (await this.#statuses(context)).items
              .filter(
                (item) =>
                  ["proposed", "accepted"].includes(item.record.state) &&
                  item.status.identityNeedsReview,
              )
              .map((item) => item.id),
          }
        : undefined
    return {
      collection: record,
      addedEpisodes: episodes.length,
      addedEvents: events.length,
      complete: collection.complete,
      problems: collection.problems,
      redacted: removal?.redacted ?? [],
      memoriesNeedingRebuild: removal?.memoriesNeedingRebuild ?? [],
      exportsToFollowUp: removal?.exportsToFollowUp ?? [],
      ...(identityUpdates ? { identityUpdates } : {}),
    }
  }

  /**
   * Removes the text the store still holds for comments the snapshot shows as deleted: any
   * version with text and any label on a version. A removal cut short is finished by the next
   * import that asks, and a finished one is not reported again.
   */
  async #removeDeletedText(context, collection, episodes, events) {
    const deleted = new Set(
      collection.threads
        .flatMap((thread) => [thread.root, ...thread.replies])
        .filter((message) => message.deletedAt)
        .map((message) => message.id),
    )
    const versions = new Map(
      events
        .filter((event) => event.type === "human_comment" && deleted.has(commentIdOf(event)))
        .map((event) => [event.id, event]),
    )
    if (!versions.size) return null
    const audited = new Set(
      (await this.#read("audit", context, { operations: ["evidence.redact"] }))
        .filter((entry) => entry.operation === "evidence.redact" && entry.outcome === "ok")
        .flatMap((entry) => entry.subjects)
        .filter((subject) => subject.kind === "event")
        .map((subject) => `${subject.id} ${subject.digest}`),
    )
    const targets = new Map()
    for (const event of events) {
      const label = event.type === "annotation"
      const version = versions.get(label ? targetOf(event) : event.id)
      if (version === undefined) continue
      if (event.payload === undefined) {
        if (event.redaction && !audited.has(`${event.id} ${event.digest}`))
          targets.set(commentIdOf(version), version)
      } else if (label || event.payload.body !== null) targets.set(commentIdOf(version), version)
    }
    return targets.size
      ? this.#removeCommentText(context, episodes, events, [...targets.values()], DELETED_AT_SOURCE)
      : null
  }

  /**
   * Append episodes and events from any source. Episode grants must exist in scope, and every
   * event must belong to an episode in scope. Use this for sources other than Hub comments.
   */
  async appendObservations(context, { episodes = [], events = [] } = {}) {
    assertContext(context)
    const grantIds = new Set((await this.#read("grants", context)).map((grant) => grant.id))
    const sealedEpisodes = episodes.map((episode) => {
      const sealed = sealEpisode({ ...episode, scope: context.scope })
      assertValid("episode", sealed)
      const missing = sealed.grants.filter((grantId) => !grantIds.has(grantId))
      if (missing.length)
        throw new LearningError("not_found", `No grant ${missing.join(", ")} in this scope.`)
      return sealed
    })
    const ids = new Set([
      ...sealedEpisodes.map((episode) => episode.id),
      ...(
        await this.#read("episodes", context, {
          ids: unique(events.map((event) => event.episodeId)),
        })
      ).map((episode) => episode.id),
    ])
    const sealedEvents = events.map((event) => {
      const sealed = sealEvent({ ...event, scope: context.scope })
      assertValid("event", sealed)
      if (!ids.has(sealed.episodeId))
        throw new LearningError("not_found", `No episode ${sealed.episodeId} in this scope.`)
      return sealed
    })
    const appended = await this.#provider.appendBatch(
      { episodes: sealedEpisodes, events: sealedEvents },
      {
        audit: this.#auditEntries(context, "observation.append", [
          ...sealedEpisodes.map((episode) => ({
            kind: "episode",
            id: episode.id,
            digest: episode.digest,
          })),
          ...sealedEvents.map((event) => ({ kind: "event", id: event.id, digest: event.digest })),
        ]),
      },
    )
    return { episodes: sealedEpisodes, events: sealedEvents, appended }
  }

  /**
   * Label comment events with a theme, signal, and stance. A label is an annotation event in
   * the target's episode. Labeling the same target the same way again adds nothing; a
   * different label from the same labeler supersedes the earlier one.
   *
   * @param {object} context the principal is the labeler, usually an agent
   * @param {Array<{ target: { eventId?: string, commentId?: number }, theme: { key: string, statement: string }, signal: string, observation: string, stance: string, proposedKind?: string, trace?: object, note?: string }>} labels
   */
  async annotate(context, labels) {
    assertContext(context)
    if (!Array.isArray(labels) || !labels.length)
      throw new LearningError("invalid_input", "Pass at least one label.")
    const { episodes, events } = await this.#observations(context)
    const retracted = retractedEvents(episodes, events)
    const superseded = new Set(
      events.filter((event) => event.supersedes).map((event) => event.supersedes),
    )
    const comments = events.filter(
      (event) =>
        event.type === "human_comment" && event.payload !== undefined && !retracted.has(event.id),
    )
    const created = []
    for (const [index, label] of labels.entries()) {
      const target = this.#labelTarget(label?.target, comments, superseded, index, episodes)
      const payload = {
        target: { eventId: target.id },
        theme: label.theme,
        signal: label.signal,
        observation: label.observation,
        stance: label.stance,
        ...(label.proposedKind ? { proposedKind: label.proposedKind } : {}),
        ...(label.trace ? { trace: label.trace } : {}),
        ...(label.note ? { note: label.note } : {}),
      }
      const previous = [...events, ...created]
        .filter(
          (event) =>
            event.type === "annotation" &&
            targetOf(event) === target.id &&
            event.actor.id === context.principal.id,
        )
        .at(-1)
      const event = sealEvent({
        schemaVersion: SCHEMA_VERSIONS.event,
        id: derivedId("ev", {
          annotationOf: target.id,
          by: context.principal.id,
          payload: digestOf(payload),
          after: previous?.id ?? null,
        }),
        episodeId: target.episodeId,
        scope: context.scope,
        type: "annotation",
        at: this.#now(),
        actor: context.principal,
        parentEventId: target.id,
        ...(previous && previous.id !== undefined ? { supersedes: previous.id } : {}),
        payload,
      })
      if (previous?.payloadDigest === event.payloadDigest) continue
      assertValid("event", event)
      created.push(event)
    }
    if (created.length)
      await this.#append(
        "events",
        created,
        this.#auditEntries(
          context,
          "annotation.add",
          created.map((event) => ({ kind: "event", id: event.id, digest: event.digest })),
        ),
      )
    return created
  }

  /**
   * Records that the caller read these comment events and found nothing to label, so a labeler
   * is not asked about them again. Each one must be a live comment version. A comment the
   * caller already marked is skipped. Returns the no_annotation events it created.
   *
   * @param {object} context
   * @param {string[]} eventIds
   */
  async recordNoAnnotation(context, eventIds) {
    assertContext(context)
    if (!Array.isArray(eventIds) || !eventIds.length)
      throw new LearningError("invalid_input", "Name at least one comment event.")
    const { episodes, events } = await this.#observations(context)
    const retracted = retractedEvents(episodes, events)
    const comments = new Map(
      events
        .filter(
          (event) =>
            event.type === "human_comment" &&
            event.payload !== undefined &&
            !retracted.has(event.id),
        )
        .map((event) => [event.id, event]),
    )
    const marked = new Set(
      events
        .filter(
          (event) => event.type === "no_annotation" && event.actor.id === context.principal.id,
        )
        .map(targetOf),
    )
    const created = []
    for (const [index, eventId] of eventIds.entries()) {
      const target = comments.get(eventId)
      if (!target)
        throw new LearningError("not_found", `Item ${index + 1}: no live comment event ${eventId}.`)
      if (marked.has(target.id)) continue
      marked.add(target.id)
      const event = sealEvent({
        schemaVersion: SCHEMA_VERSIONS.event,
        id: derivedId("ev", { noAnnotationOf: target.id, by: context.principal.id }),
        episodeId: target.episodeId,
        scope: context.scope,
        type: "no_annotation",
        at: this.#now(),
        actor: context.principal,
        parentEventId: target.id,
        payload: { target: { eventId: target.id } },
      })
      assertValid("event", event)
      created.push(event)
    }
    if (created.length)
      await this.#append(
        "events",
        created,
        this.#auditEntries(
          context,
          "annotation.add",
          created.map((event) => ({ kind: "event", id: event.id, digest: event.digest })),
        ),
      )
    return created
  }

  #labelTarget(target, comments, superseded, index, episodes) {
    if (target?.eventId) {
      const event = comments.find((item) => item.id === target.eventId)
      if (!event)
        throw new LearningError(
          "not_found",
          `Label ${index + 1}: no live comment event ${target.eventId}.`,
        )
      return event
    }
    if (Number.isSafeInteger(target?.commentId)) {
      const matches = comments.filter(
        (item) =>
          item.payload.commentId === target.commentId &&
          !superseded.has(item.id) &&
          item.payload.body !== null,
      )
      if (matches.length > 1) {
        const byEpisode = new Map(episodes.map((episode) => [episode.id, episode]))
        const threads = new Set(
          matches.map((event) => hubThreadKey(byEpisode.get(event.episodeId))),
        )
        if (threads.size === 1 && !threads.has(null))
          return matches.sort((a, b) => compare(b.at, a.at) || compare(a.id, b.id))[0]
      }
      if (matches.length !== 1)
        throw new LearningError(
          matches.length ? "invalid_input" : "not_found",
          `Label ${index + 1}: comment ${target.commentId} matches ${matches.length} live comment events; use eventId.`,
        )
      return matches[0]
    }
    throw new LearningError(
      "invalid_input",
      `Label ${index + 1} needs target.eventId or target.commentId.`,
    )
  }

  /**
   * The episodes and events a purpose may use now, excluding retracted and redacted events.
   *
   * @param {object} context
   * @param {{ purpose: string, episodeIds?: string[], eventIds?: string[], since?: string, until?: string, types?: string[] }} query
   */
  async queryObservations(context, { purpose, episodeIds, eventIds, since, until, types } = {}) {
    assertContext(context)
    if (!PURPOSES.includes(purpose))
      throw new LearningError("invalid_input", `Purposes are ${PURPOSES.join(", ")}.`)
    if (
      eventIds !== undefined &&
      (!Array.isArray(eventIds) ||
        eventIds.length > 100 ||
        Array.from(eventIds).some((id) => typeof id !== "string" || !RECORD_ID.test(id)))
    )
      throw new LearningError(
        "invalid_input",
        "eventIds must be an array of at most 100 record IDs.",
      )
    const requested = eventIds === undefined ? null : new Set(eventIds)
    const { eligibility } = await this.#eligibility(context)
    const eligible = await this.#eligible(
      await this.#observations(context, { episodeIds, eventIds }),
      eligibility,
      purpose,
    )
    const events = eligible.events.filter(
      (event) =>
        (!episodeIds || episodeIds.includes(event.episodeId)) &&
        (!requested || requested.has(event.id)) &&
        (!since || event.at >= since) &&
        (!until || event.at < until) &&
        (!types || types.includes(event.type)),
    )
    const included = new Set(events.map((event) => event.episodeId))
    return {
      episodes: requested
        ? eligible.episodes.filter((episode) => included.has(episode.id))
        : eligible.episodes.filter((episode) => !episodeIds || episodeIds.includes(episode.id)),
      events,
    }
  }

  // Memories

  /**
   * Store a proposal from any proposer as a proposed memory. Nothing is accepted here.
   *
   * @param {object} context
   * @param {object} proposal a replica.memory-proposal/v1 record
   */
  async proposeMemory(context, proposal) {
    assertContext(context)
    const now = this.#now()
    const { eligibility } = await this.#eligibility(context, now)
    const eligible = await this.#eligible(
      await this.#observations(context),
      eligibility,
      "instruction",
    )
    const entries = await this.#memories(context)
    const migration = await this.#migrationContext(context.scope)
    if (migration.digest !== eligible.migrationDigest)
      throw new LearningError("conflict", "Repository migration changed while reading. Try again.")
    const { record } = await this.#storeProposal(context, proposal, {
      eligible,
      entries,
      now,
      migration,
    })
    return record
  }

  /**
   * Store a proposal as the next version of its learning, with a memory.propose audit entry,
   * unless the latest version already shows a reviewer the same thing.
   */
  async #storeProposal(
    context,
    proposal,
    { eligible, entries, now, migration, purpose = "instruction", reason },
  ) {
    const { record, latest } = this.#draftProposal(context, proposal, {
      eligible,
      entries,
      now,
      migration,
    })
    if (latest && latest.reviewDigest === record.reviewDigest)
      return { record: latest, changed: false }
    assertValid("memoryRecord", record)
    await this.#provider.appendMemoryVersion(record, {
      expectedPreviousDigest: latest?.digest ?? null,
      ...(this.#provider.atomicMigrationFence
        ? { expectedMigrations: { scope: context.scope, digest: migration.digest } }
        : {}),
      audit: [
        this.#auditEntry(
          context,
          "memory.propose",
          [{ kind: "memory", id: record.id, digest: record.digest }],
          { purpose, reason },
        ),
      ],
    })
    return { record, changed: true }
  }

  /**
   * The undecided learning a proposal would update, if any, and the version it would store.
   * Throws when the proposal cannot be stored. Writes nothing.
   */
  #draftProposal(context, proposal, { eligible, entries, now, migration }) {
    assertValid("memoryProposal", proposal, { sealed: false })
    const evidence = proposal.evidence.map((reference) =>
      this.#canonicalEvidence(reference, eligible, "instruction"),
    )
    const contradictions = proposal.contradictions?.map((reference) =>
      this.#canonicalEvidence(reference, eligible, "instruction"),
    )
    const { action, targets = [] } = proposal.lifecycle
    if (action === "retire")
      throw new LearningError(
        "unsupported",
        "Retire proposals are not supported in v1. Retire the memory directly.",
      )
    for (const target of targets) {
      const entry = entries.get(target)
      if (!entry || entry.record.state !== "accepted" || entry.problems.length)
        throw new LearningError(
          "invalid_transition",
          `Lifecycle target ${target} is not an intact accepted memory.`,
        )
    }
    function proposalId(scope) {
      return proposal.themeKey
        ? derivedId("mem", {
            scope,
            consolidator: proposal.consolidator.id,
            themeKey: proposal.themeKey,
          })
        : derivedId("mem", { scope, proposal: digestOf(proposal) })
    }
    function findExisting(candidates) {
      const matches = unique(candidates.filter((candidate) => entries.has(candidate)))
      if (matches.length > 1) return candidates[0]
      return matches[0] ?? candidates[0]
    }
    let id = findExisting([context.scope, ...migration.legacyScopes].map(proposalId))
    let latest = entries.get(id)?.record
    while (latest && latest.state !== "proposed") {
      const original = migration.originalDigests.get(latest.digest)
      id = findExisting([
        derivedId("mem", { after: latest.digest }),
        ...(original ? [derivedId("mem", { after: original })] : []),
      ])
      latest = entries.get(id)?.record
    }
    if (latest && entries.get(id).problems.length)
      throw new LearningError(
        "invalid_record",
        `Memory ${id} failed its integrity checks; run verify.`,
      )
    const optional = {}
    for (const key of [
      "themeKey",
      "appliesTo",
      "support",
      "confidence",
      "validFrom",
      "validUntil",
      "expiresAt",
    ])
      if (proposal[key] !== undefined) optional[key] = proposal[key]
    if (contradictions) optional.contradictions = contradictions
    const record = sealMemory({
      schemaVersion: SCHEMA_VERSIONS.memoryRecord,
      id,
      version: (latest?.version ?? 0) + 1,
      ...(latest ? { previousDigest: latest.digest } : {}),
      scope: context.scope,
      kind: proposal.kind,
      state: "proposed",
      content: proposal.content,
      ...optional,
      evidence,
      proposal: {
        consolidator: proposal.consolidator,
        rationale: proposal.rationale,
        lifecycle: proposal.lifecycle,
        proposedAt: now,
        proposedBy: context.principal,
        proposalDigest: digestOf(proposal),
      },
      provenance: {
        producer: { ...PRODUCER },
        method: `propose:${proposal.consolidator.id}`,
        createdAt: now,
        createdBy: context.principal,
      },
      createdAt: latest?.createdAt ?? now,
      updatedAt: now,
    })
    return { record, latest }
  }

  /**
   * What storing a proposal would do: "unchanged" when an undecided learning already shows a
   * reviewer the same thing, "refused" when the store would refuse it, and "changed" otherwise.
   */
  #proposalChange(context, proposal, options) {
    try {
      const { record, latest } = this.#draftProposal(context, proposal, options)
      return latest?.reviewDigest === record.reviewDigest ? "unchanged" : "changed"
    } catch (error) {
      if (error instanceof LearningError) return "refused"
      throw error
    }
  }

  /**
   * One memory, its recall status, and optionally every version. Reading it is a use for
   * purpose, review by default: when its evidence no longer permits that purpose, the content,
   * evidence, and rationale are withheld and only lifecycle metadata is returned.
   */
  async getMemory(context, id, { history = false, purpose = "review" } = {}) {
    assertContext(context)
    const [recall, view] = await Promise.all([
      this.#statuses(context, "instruction"),
      this.#statuses(context, purpose),
    ])
    const item = view.items.find((entry) => entry.id === id)
    if (!item) throw new LearningError("not_found", `No memory ${id} in this scope.`)
    const status = recall.items.find((entry) => entry.id === id).status
    const projected = this.#project(item)
    const versions = item.versions.map((version) =>
      !item.problems.length && this.#evidenceEligible(dependencies(version), view.eligible)
        ? version
        : { ...metadataOf(version), withheld: true },
    )
    return {
      record: projected.record,
      status,
      withheld: projected.withheld,
      ...(history ? { versions } : {}),
    }
  }

  /** Find one host decision marker in intact history without returning learning content. */
  async findMemoryOperation(context, id, operationId) {
    assertContext(context)
    const entry = (await this.#memories(context, [id])).get(id)
    if (!entry) throw new LearningError("not_found", `No memory ${id} in this scope.`)
    const version = entry.intact.find(
      (record) =>
        record.accepted?.operationId === operationId ||
        record.rejected?.operationId === operationId ||
        record.retired?.operationId === operationId,
    )
    return { state: version?.state ?? null }
  }

  /** Memories in scope, newest version of each, with their recall status, read for a purpose. */
  async queryMemory(context, { states, kinds, purpose = "review" } = {}) {
    assertContext(context)
    const [recall, view] = await Promise.all([
      this.#statuses(context, "instruction"),
      this.#statuses(context, purpose),
    ])
    const statuses = new Map(recall.items.map((item) => [item.id, item.status]))
    return view.items
      .filter(
        (item) =>
          (!states || states.includes(item.record.state)) &&
          (!kinds || kinds.includes(item.record.kind)),
      )
      .map((item) => {
        const projected = this.#project(item)
        return {
          record: projected.record,
          status: statuses.get(item.id),
          withheld: projected.withheld,
        }
      })
  }

  /**
   * Accept a proposed memory, optionally with edited content. expectedDigest must be the
   * reviewDigest of what the person reviewed; if the proposal changed since, including new
   * support or dissent, this throws stale_review. The approval binds to the contentDigest of
   * the learning accepted. A proposal that replaces other memories records them in
   * supersedes, and recall follows that; the replaced memories keep their state. Such a
   * proposal must apply now, so an expired one, or one not valid yet, is refused.
   */
  async acceptMemory(context, id, { expectedDigest, content, note, operationId } = {}) {
    assertContext(context)
    requireHuman(context, "accept a learning")
    const { items, eligible, now } = await this.#statuses(context)
    const entries = new Map(items.map((item) => [item.id, item]))
    const latest = this.#reviewable(entries, id, expectedDigest)
    if (entries.get(id).status.identityNeedsReview)
      throw new LearningError(
        "identity_revalidation_required",
        `Reviewer identity for ${id} changed or remains unverified. Rebuild the proposal and review it again before accepting it.`,
      )
    if (!this.#evidenceEligible(dependencies(latest), eligible))
      throw new LearningError(
        "purpose_not_granted",
        `Some evidence or counterevidence for ${id} is retracted or no longer permitted for instruction. Rebuild the proposal.`,
      )
    const targets = latest.proposal.lifecycle.targets ?? []
    for (const target of targets) this.#assertReplaceable(entries.get(target), target)
    const unusable = targets.length ? replacementProblem(validity(latest, now)) : null
    if (unusable)
      throw new LearningError(
        "invalid_transition",
        `${id} cannot replace ${targets.join(", ")} now, because ${unusable}. Recall would use neither.`,
      )
    const edited = content !== undefined && content !== latest.content
    const draft = {
      ...without(latest, "digest", "contentDigest"),
      version: latest.version + 1,
      previousDigest: latest.digest,
      state: "accepted",
      content: edited ? content : latest.content,
      updatedAt: now,
      ...(targets.length ? { supersedes: unique(targets) } : {}),
    }
    draft.accepted = {
      by: context.principal,
      at: now,
      contentDigest: memoryContentDigest(draft),
      reviewedDigest: expectedDigest,
      edited,
      ...(operationId ? { operationId } : {}),
      ...(note ? { note } : {}),
    }
    const record = sealMemory(draft)
    assertValid("memoryRecord", record)
    await this.#appendVersion(
      record,
      latest.digest,
      "stale_review",
      this.#auditEntry(
        context,
        "memory.accept",
        [
          { kind: "memory", id: record.id, digest: record.digest },
          ...targets.map((target) => ({ kind: "memory", id: target })),
        ],
        { purpose: "instruction", ...(edited ? { reason: "Accepted with edits." } : {}) },
      ),
    )
    return record
  }

  /** Reject a proposed memory, keeping the reason so later proposals can see the disagreement. */
  async rejectMemory(context, id, { expectedDigest, reason, operationId } = {}) {
    assertContext(context)
    requireHuman(context, "reject a learning")
    const now = this.#now()
    const latest = this.#reviewable(await this.#memories(context), id, expectedDigest)
    const record = sealMemory({
      ...without(latest, "digest", "contentDigest"),
      version: latest.version + 1,
      previousDigest: latest.digest,
      state: "rejected",
      updatedAt: now,
      rejected: {
        by: context.principal,
        at: now,
        reviewedDigest: expectedDigest,
        reason,
        ...(operationId ? { operationId } : {}),
      },
    })
    assertValid("memoryRecord", record)
    await this.#appendVersion(
      record,
      latest.digest,
      "stale_review",
      this.#auditEntry(context, "memory.reject", [
        { kind: "memory", id: record.id, digest: record.digest },
      ]),
    )
    return record
  }

  /** Stop recalling an accepted memory. Its history stays inspectable. */
  async retireMemory(context, id, { reason, operationId } = {}) {
    assertContext(context)
    requireHuman(context, "retire a learning")
    const entry = (await this.#memories(context, [id])).get(id)
    if (!entry) throw new LearningError("not_found", `No memory ${id} in this scope.`)
    if (entry.problems.length)
      throw new LearningError("invalid_record", `Memory ${id} failed its integrity checks.`)
    if (entry.record.state !== "accepted")
      throw new LearningError(
        "invalid_transition",
        `Only accepted memories can be retired; ${id} is ${entry.record.state}.`,
      )
    return this.#retire(entry.record, context, reason, this.#now(), operationId)
  }

  /**
   * Record that an accepted memory replaces other accepted memories, for example after merging
   * duplicates. A learning records what it replaces once, so this works only on a learning
   * accepted without replacing anything; to replace more, propose a merge. The replacement
   * must be one that recall uses now. Recall follows the replacement, and the replaced
   * memories keep their state and show as superseded.
   */
  async supersedeMemory(context, oldIds, newId, { reason } = {}) {
    assertContext(context)
    requireHuman(context, "supersede a learning")
    const { items, now } = await this.#statuses(context)
    const entries = new Map(items.map((item) => [item.id, item]))
    const replacement = entries.get(newId)
    if (
      !replacement ||
      replacement.record.state !== "accepted" ||
      replacement.problems.length ||
      replacement.status.superseded ||
      replacement.status.conflicts.length
    )
      throw new LearningError(
        "invalid_transition",
        `Replacement ${newId} must be an intact accepted memory that is still in effect.`,
      )
    if (!replacement.status.recallEligible)
      throw new LearningError(
        "invalid_transition",
        `${newId} cannot replace another learning now, because ${replacementProblem(replacement.status) ?? "recall does not use it"}. Recall would use neither.`,
      )
    if (replacement.record.supersedes)
      throw new LearningError(
        "invalid_transition",
        `${newId} already records what it replaces. Propose a merge to replace more.`,
      )
    if (!oldIds?.length || oldIds.includes(newId))
      throw new LearningError(
        "invalid_input",
        "Name one or more memories to replace, other than the replacement.",
      )
    for (const oldId of oldIds) this.#assertReplaceable(entries.get(oldId), oldId)
    const latest = replacement.record
    const record = sealMemory({
      ...without(latest, "digest", "contentDigest"),
      version: latest.version + 1,
      previousDigest: latest.digest,
      supersedes: unique(oldIds),
      updatedAt: now,
    })
    assertValid("memoryRecord", record)
    await this.#appendVersion(
      record,
      latest.digest,
      "conflict",
      this.#auditEntry(
        context,
        "memory.supersede",
        [
          { kind: "memory", id: newId, digest: record.digest },
          ...oldIds.map((oldId) => ({ kind: "memory", id: oldId })),
        ],
        { reason },
      ),
    )
    return record
  }

  #reviewable(entries, id, expectedDigest) {
    const entry = entries.get(id)
    if (!entry) throw new LearningError("not_found", `No memory ${id} in this scope.`)
    if (entry.problems.length)
      throw new LearningError("invalid_record", `Memory ${id} failed its integrity checks.`)
    if (entry.record.state !== "proposed")
      throw new LearningError(
        "invalid_transition",
        `Memory ${id} is ${entry.record.state}, not proposed.`,
      )
    if (entry.record.reviewDigest !== expectedDigest)
      throw new LearningError(
        "stale_review",
        `Memory ${id} changed since it was reviewed. Review the current version, ${entry.record.reviewDigest}.`,
        { currentDigest: entry.record.reviewDigest },
      )
    return entry.record
  }

  async #retire(latest, context, reason, now, operationId) {
    const record = sealMemory({
      ...without(latest, "digest", "contentDigest"),
      version: latest.version + 1,
      previousDigest: latest.digest,
      state: "retired",
      updatedAt: now,
      retired: { by: context.principal, at: now, reason, ...(operationId ? { operationId } : {}) },
    })
    assertValid("memoryRecord", record)
    await this.#appendVersion(
      record,
      latest.digest,
      "conflict",
      this.#auditEntry(
        context,
        "memory.retire",
        [{ kind: "memory", id: record.id, digest: record.digest }],
        { reason },
      ),
    )
    return record
  }

  /** Refuse to replace a memory that is not an intact accepted memory still in effect. */
  #assertReplaceable(entry, id) {
    if (!entry || entry.record.state !== "accepted" || entry.problems.length)
      throw new LearningError("invalid_transition", `${id} is not an intact accepted memory.`)
    if (entry.status.superseded)
      throw new LearningError(
        "invalid_transition",
        `${id} was already replaced by ${entry.status.supersededBy.join(", ")}.`,
      )
  }

  /** Append a learning version with the audit entry that records it, in one provider write. */
  async #appendVersion(record, expectedPreviousDigest, code, receipt) {
    try {
      await this.#provider.appendMemoryVersion(record, { expectedPreviousDigest, audit: [receipt] })
    } catch (error) {
      if (error?.code === "conflict")
        throw new LearningError(
          code,
          `Memory ${record.id} changed while it was being updated. Read it again.`,
        )
      throw error
    }
  }

  // Consolidation, recall, export, and checks

  /**
   * Run a consolidator over the evidence a purpose may use and store what it proposes as
   * proposed memories. status is complete only when complete, unfiltered collections cover
   * the whole window; otherwise it is incomplete and the result says which spans are missing,
   * so a partial scan never reads as "nothing found".
   *
   * maxProposals caps the new or changed proposals one run stores. A proposal already stored
   * unchanged and still undecided does not count, so later runs reach themes past the cap, and
   * neither does one the store refuses. overBudget counts the proposals the cap held back.
   *
   * @param {object} context
   * @param {{ consolidator: object, window: { from: string, to: string }, purpose?: string, maxProposals?: number, dryRun?: boolean }} options
   */
  async consolidate(
    context,
    { consolidator, window, purpose = "instruction", maxProposals = 10, dryRun = false } = {},
  ) {
    assertContext(context)
    if (typeof consolidator?.consolidate !== "function" || !consolidator.manifest?.id)
      throw new LearningError(
        "invalid_input",
        "Pass a consolidator with a manifest and a consolidate method.",
      )
    if (!["instruction", "evaluation"].includes(purpose))
      throw new LearningError("invalid_input", "Consolidation runs for instruction or evaluation.")
    const now = this.#now()
    if (
      !isTimestamp(window?.from) ||
      !isTimestamp(window?.to) ||
      window.from >= window.to ||
      window.to > now
    )
      throw new LearningError(
        "invalid_input",
        "The window needs from before to, and to no later than now.",
      )
    if (!Number.isSafeInteger(maxProposals) || maxProposals < 1)
      throw new LearningError("invalid_input", "maxProposals must be a positive whole number.")
    const { items, eligible } = await this.#statuses(context, purpose)
    const entries = new Map(items.map((item) => [item.id, item]))
    const migration = await this.#migrationContext(context.scope)
    if (migration.digest !== eligible.migrationDigest)
      throw new LearningError("conflict", "Repository migration changed while reading. Try again.")
    const coverage = await this.#coverage(context, window)
    const view = deepFreeze(
      structuredClone({
        purpose,
        window,
        scope: context.scope,
        episodes: eligible.episodes,
        events: eligible.events.filter(
          (event) => event.type !== "annotation" || !eligible.hiddenEdits.has(event.parentEventId),
        ),
        memories: items.filter((item) => !item.status.problems.length).map(memoryView),
      }),
    )
    const output = await consolidator.consolidate(
      { window, scope: context.scope, purpose, budget: { maxProposals } },
      view,
    )
    if (!output || !Array.isArray(output.proposals) || !Array.isArray(output.diagnostics ?? []))
      throw new LearningError(
        "invalid_input",
        `Consolidator ${consolidator.manifest.id} returned an invalid result.`,
      )
    const diagnostics = [...(output.diagnostics ?? [])]
    const budgetNoteAt = diagnostics.length
    const results = []
    let room = maxProposals
    let overBudget = 0
    for (const proposal of output.proposals) {
      const change = this.#proposalChange(context, proposal, { eligible, entries, now, migration })
      if (change === "changed" && room === 0) {
        overBudget++
        continue
      }
      if (dryRun) {
        assertValid("memoryProposal", proposal, { sealed: false })
        results.push(proposal)
        if (change === "changed") room--
        continue
      }
      try {
        const { record, changed } = await this.#storeProposal(context, proposal, {
          eligible,
          entries,
          now,
          migration,
          purpose,
          reason: `Proposed by consolidator ${consolidator.manifest.id}.`,
        })
        entries.set(record.id, { id: record.id, record, versions: [], problems: [] })
        results.push({ record, changed })
        if (changed) room--
      } catch (error) {
        if (!(error instanceof LearningError)) throw error
        diagnostics.push({
          code: "proposal_refused",
          themeKey: proposal?.themeKey,
          message: error.message,
        })
      }
    }
    if (overBudget)
      diagnostics.splice(budgetNoteAt, 0, {
        code: "budget",
        message: `${overBudget} proposal(s) were over the budget of ${maxProposals}.`,
      })
    const status = coverage.complete ? "complete" : "incomplete"
    const summary =
      status === "incomplete"
        ? `Evidence for this window is incomplete. Missing: ${coverage.gaps.map((gap) => `${gap.from} to ${gap.to}`).join(", ")}.`
        : results.length
          ? `${results.length} proposal(s) from complete evidence.`
          : "Complete evidence; no theme met the consolidator's thresholds."
    if (!dryRun)
      await this.#audit(
        context,
        "consolidation.run",
        results.map(({ record }) => ({ kind: "memory", id: record.id, digest: record.digest })),
        { purpose, reason: `${consolidator.manifest.id}: ${summary}` },
      )
    return {
      status,
      summary,
      coverage,
      proposals: dryRun ? results : results.map(({ record }) => record),
      changed: dryRun
        ? []
        : results.filter(({ changed }) => changed).map(({ record }) => record.id),
      overBudget,
      diagnostics,
      sourceEpisodeIds: unique(
        (dryRun ? results : results.map(({ record }) => record)).flatMap((item) =>
          item.evidence.map((reference) => reference.episodeId),
        ),
      ),
    }
  }

  /**
   * The accepted learnings an agent should apply next, ranked and rendered as plain text.
   * Only accepted, intact, current memories whose evidence is still permitted for instruction
   * are returned. Raw review comments are never included. Each recall is audited as a use for
   * instruction; a preview, which shows a person what an agent would get, is not, because
   * nothing reaches an agent. Only a person may preview, so an agent cannot read the learnings
   * without leaving an audit entry.
   */
  async recall(context, { task, limit = 20, budgetChars = 6000, preview = false } = {}) {
    assertContext(context)
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new LearningError("invalid_input", "The recall limit must be a positive safe integer.")
    if (preview) requireHuman(context, "preview recall")
    const { items } = await this.#statuses(context)
    const usable = items.filter((item) => item.status.recallEligible).map((item) => item.record)
    const { selected, text } = renderRecall(rankForRecall(usable, { task }), {
      limit,
      budgetChars,
      total: usable.length,
    })
    if (!preview)
      await this.#audit(
        context,
        "memory.recall",
        selected.map((memory) => ({ kind: "memory", id: memory.id, digest: memory.contentDigest })),
        { purpose: "instruction" },
      )
    return { memories: selected, text, considered: usable.length }
  }

  /**
   * Copy what a purpose may use to a bundle. Refuses when no active grant in scope permits
   * the purpose. The manifest records every exported ID and digest and what was held back.
   * With contents "learnings", only accepted learnings and the grants that permit their
   * evidence leave; episodes and their review comments stay in the store.
   */
  async exportRecords(context, { purpose, destination, contents = "all", preview = false } = {}) {
    assertContext(context)
    requireHuman(context, "export learning records")
    if (!PURPOSES.includes(purpose))
      throw new LearningError("invalid_input", `Purposes are ${PURPOSES.join(", ")}.`)
    if (typeof destination !== "string" || !destination)
      throw new LearningError("invalid_input", "Name the export destination.")
    if (!["all", "learnings"].includes(contents))
      throw new LearningError("invalid_input", 'contents is "all" or "learnings".')
    const learningsOnly = contents === "learnings"
    const now = this.#now()
    const { eligibility, grants } = await this.#eligibility(context, now)
    if (!eligibility.purposeGranted(context.scope, purpose)) {
      if (!preview)
        await this.#audit(context, "export.create", [], {
          purpose,
          outcome: "refused",
          reason: `No grant permits ${purpose}.`,
        })
      throw new LearningError(
        "purpose_not_granted",
        `No active grant in this scope permits ${purpose}.`,
      )
    }
    const observations = await this.#observations(context)
    const { items, eligible } = await this.#statuses(context, purpose)
    const excluded = new Map()
    function exclude(reason, count = 1) {
      if (count) excluded.set(reason, (excluded.get(reason) ?? 0) + count)
    }
    if (!learningsOnly) {
      exclude("episode-not-permitted", observations.episodes.length - eligible.episodes.length)
      const included = new Set(eligible.episodes.map((episode) => episode.id))
      const candidates = observations.events.filter((event) => included.has(event.episodeId))
      // An event whose text was removed counts once, as redacted, even if it was also retracted.
      const redacted = candidates.filter((event) => event.payload === undefined).length
      const retracted = candidates.filter(
        (event) => event.payload !== undefined && eligible.retracted.has(event.id),
      ).length
      exclude("event-retracted", retracted)
      exclude("event-redacted", redacted)
      exclude(
        "event-not-permitted",
        candidates.length - eligible.events.length - retracted - redacted,
      )
    }
    const episodes = learningsOnly
      ? []
      : eligible.episodes.map((episode) => ({
          ...episode,
          timeline: eligible.events.filter((event) => event.episodeId === episode.id),
        }))
    const exportedEpisodes = learningsOnly ? [] : eligible.episodes
    const exportedEvents = learningsOnly ? [] : eligible.events
    const episodeSources = exportedEpisodes.map((episode) => episode.source)
    const collections = learningsOnly
      ? []
      : (await this.#read("collections", context)).filter((collection) =>
          episodeSources.some((source) => sameCollectionSource(collection.source, source)),
        )
    const exportedEventIds = new Set(exportedEvents.map((event) => event.id))
    const safelyOmittedEventIds = new Set(
      exportedEvents.map((event) => event.supersedes).filter(Boolean),
    )
    function currentSourceEvents(episodeIds) {
      return observations.events.filter(
        (event) =>
          episodeIds.has(event.episodeId) &&
          !JUDGMENTS.has(event.type) &&
          !eligible.retracted.has(event.id) &&
          !safelyOmittedEventIds.has(event.id),
      )
    }
    const completeEpisodeIds = exportedEpisodes
      .filter((episode) => {
        const sourceEvents = currentSourceEvents(new Set([episode.id]))
        if (
          sourceEvents.some(
            (event) => event.payload === undefined || !exportedEventIds.has(event.id),
          )
        )
          return false
        const latest = sourceEvents.reduce(
          (found, event) => (!found || event.at > found ? event.at : found),
          undefined,
        )
        return collections.some(
          (collection) =>
            sameCollectionSource(collection.source, episode.source) &&
            collection.complete === true &&
            collection.filters.resolution === "all" &&
            collection.filters.read === "all" &&
            collection.filters.from === null &&
            collection.filters.to === null &&
            (!latest || collection.capturedAt >= latest),
        )
      })
      .map((episode) => episode.id)
    const views = new Map()
    if (!learningsOnly)
      for (const episode of observations.episodes) {
        const key = hubViewKey(episode, observations.events)
        if (key) views.set(key, [...(views.get(key) ?? []), episode])
      }
    const uncertainPrototypes = new Set()
    if (!learningsOnly)
      for (const episode of observations.episodes) {
        if (episode.source.kind !== HUB_SOURCE) continue
        const sourceEvents = currentSourceEvents(new Set([episode.id]))
        if (
          hubViewKey(episode, observations.events) === null &&
          sourceEvents.some(
            (event) => event.payload === undefined || !exportedEventIds.has(event.id),
          )
        )
          uncertainPrototypes.add(hubPrototypeKey(episode.source))
      }
    const completeViews = [...views]
      .filter(([, viewEpisodes]) => {
        const source = viewEpisodes[0].source
        if (uncertainPrototypes.has(hubPrototypeKey(source))) return false
        const sourceEvents = currentSourceEvents(new Set(viewEpisodes.map((episode) => episode.id)))
        if (
          sourceEvents.some(
            (event) => event.payload === undefined || !exportedEventIds.has(event.id),
          )
        )
          return false
        const latest = sourceEvents.reduce(
          (found, event) => (!found || event.at > found ? event.at : found),
          undefined,
        )
        return collections.some(
          (collection) =>
            sameCollectionSource(collection.source, source) &&
            collection.complete === true &&
            collection.filters.resolution === "all" &&
            collection.filters.read === "all" &&
            collection.filters.from === null &&
            collection.filters.to === null &&
            (!latest || collection.capturedAt >= latest),
        )
      })
      .map(([key]) => key)
    const prototypes = new Map()
    if (!learningsOnly)
      for (const episode of observations.episodes) {
        if (episode.source.kind !== HUB_SOURCE) continue
        const key = hubPrototypeKey(episode.source)
        prototypes.set(key, [...(prototypes.get(key) ?? []), episode])
      }
    const completePrototypes = [...prototypes]
      .filter(([, prototypeEpisodes]) => {
        const source = prototypeEpisodes[0].source
        const sourceEvents = currentSourceEvents(
          new Set(prototypeEpisodes.map((episode) => episode.id)),
        )
        if (
          sourceEvents.some(
            (event) => event.payload === undefined || !exportedEventIds.has(event.id),
          )
        )
          return false
        const latest = sourceEvents.reduce(
          (found, event) => (!found || event.at > found ? event.at : found),
          undefined,
        )
        return collections.some(
          (collection) =>
            sameCollectionSource(collection.source, source) &&
            collection.complete === true &&
            collection.filters.resolution === "all" &&
            collection.filters.read === "all" &&
            collection.filters.from === null &&
            collection.filters.to === null &&
            (!latest || collection.capturedAt >= latest),
        )
      })
      .map(([key]) => key)
    const memories = []
    for (const { record, status } of items) {
      if (record.state !== "accepted") exclude(`memory-${record.state}`)
      else if (!status.approvalValid) exclude("memory-approval-invalid")
      else if (!status.inEffect) exclude("memory-not-current")
      else if (!status.evidenceEligible) exclude("memory-evidence-not-permitted")
      else memories.push(record)
    }
    const permittingEvents = learningsOnly
      ? memories.flatMap((memory) =>
          dependencies(memory).flatMap((reference) =>
            reference.eventIds.map((eventId) => eligible.eventsById.get(eventId)),
          ),
        )
      : eligible.events
    const usedGrants = new Set(
      permittingEvents.flatMap((event) => {
        const target = JUDGMENTS.has(event.type) ? eligible.eventsById.get(targetOf(event)) : event
        return (
          eligible.evidenceGrants.get(target.id) ??
          eligibility.grantsForEvent(eligible.episodesById.get(event.episodeId), target, purpose)
        )
      }),
    )
    const exportedGrants = grants.filter((grant) => usedGrants.has(grant.id))
    const manifest = sealRecord({
      schemaVersion: SCHEMA_VERSIONS.exportManifest,
      id: randomId("export"),
      purpose,
      scope: context.scope,
      createdAt: now,
      createdBy: context.principal,
      provider: { id: this.#manifest.id, version: this.#manifest.version },
      destination,
      contents,
      counts: {
        collections: collections.length,
        episodes: exportedEpisodes.length,
        events: exportedEvents.length,
        memories: memories.length,
        grants: exportedGrants.length,
      },
      completeEpisodeIds,
      completeViews,
      completePrototypes,
      excluded: [...excluded].map(([reason, count]) => ({ reason, count })),
      records: [
        ...exportedGrants.map((grant) => ({ kind: "grant", id: grant.id, digest: grant.digest })),
        ...collections.map((collection) => ({
          kind: "collection",
          id: collection.id,
          digest: collection.digest,
        })),
        ...exportedEpisodes.map((episode) => ({
          kind: "episode",
          id: episode.id,
          digest: episode.digest,
        })),
        ...exportedEvents.map((event) => ({ kind: "event", id: event.id, digest: event.digest })),
        ...memories.map((memory) => ({ kind: "memory", id: memory.id, digest: memory.digest })),
      ],
    })
    assertValid("exportManifest", manifest)
    if (preview)
      await this.#audit(context, "export.create", [], {
        purpose,
        reason: `Previewed ephemeral export ${manifest.id} with digest ${manifest.digest}.`,
      })
    else
      await this.#append(
        "exports",
        [manifest],
        [
          this.#auditEntry(
            context,
            "export.create",
            [{ kind: "export", id: manifest.id, digest: manifest.digest }],
            { purpose },
          ),
        ],
      )
    return {
      manifest,
      bundle: { manifest, grants: exportedGrants, collections, episodes, memories },
    }
  }

  /**
   * Counts and anything that needs a person's attention. When stored records fail their
   * checks, every other operation is blocked, so status reports only that.
   */
  async status(context) {
    assertContext(context)
    const integrity = await this.verify(context)
    const provider = {
      id: this.#manifest.id,
      version: this.#manifest.version,
      storage: this.#manifest.storage,
    }
    let read
    try {
      const now = this.#now()
      read = await Promise.all([
        this.#eligibility(context, now),
        this.#observations(context),
        this.#statuses(context),
        this.#read("collections", context),
      ])
    } catch (error) {
      if (error?.code !== "storage_corrupt") throw error
      return {
        provider,
        scope: context.scope,
        counts: null,
        attention: [
          `${integrity.problems.length} record(s) fail verification; run verify. Learning operations are blocked until the store is repaired.`,
        ],
      }
    }
    const [{ eligibility, grants }, observations, { items }, collections] = read
    const migrations = (await this.#provider.scopeMigrations?.(context.scope)) ?? []
    const followUps = {
      memoriesNeedingRebuild: unique(
        migrations.flatMap(
          (migration) => migration.redactionFollowUps?.memoriesNeedingRebuild ?? [],
        ),
      ),
      exportsToFollowUp: [
        ...new Map(
          migrations
            .flatMap((migration) => migration.redactionFollowUps?.exportsToFollowUp ?? [])
            .map((item) => [item.id, item]),
        ).values(),
      ],
    }
    const states = { proposed: 0, accepted: 0, rejected: 0, retired: 0 }
    for (const item of items) states[item.record.state]++
    const attention = [
      ...(integrity.ok
        ? []
        : [`${integrity.problems.length} record(s) fail verification; run verify.`]),
      ...items
        .filter(
          (item) =>
            item.status.identityNeedsReview && ["proposed", "accepted"].includes(item.record.state),
        )
        .map(
          (item) =>
            `${item.id} needs identity review: a reviewer's stable identity changed or is unverified. Rebuild the learning before accepting or using it.`,
        ),
      ...items
        .filter((item) => item.status.needsRebuild && !item.status.identityNeedsReview)
        .map(
          (item) =>
            `${item.id} needs rebuilding: its evidence was withdrawn, retracted, or redacted.`,
        ),
      ...items
        .filter((item) => item.status.conflicts.length)
        .map(
          (item) =>
            `${item.id} ${item.status.inEffect ? "is used, but a replacement it recorded did not take effect" : "is not used"}: ${item.status.conflicts.join("; ")}.`,
        ),
      ...items
        .filter((item) => item.status.problems.length)
        .map((item) => `${item.id} failed integrity checks; run verify.`),
      ...collections
        .filter((item) => !item.complete)
        .map(
          (item) =>
            `Collection ${item.id} is incomplete: ${item.problems[0] ?? "pages are missing"}`,
        ),
      ...followUps.exportsToFollowUp.map(
        (item) => `Export ${item.id} at ${item.destination} may contain removed comment text.`,
      ),
    ]
    return {
      provider,
      scope: context.scope,
      counts: {
        episodes: observations.episodes.length,
        events: observations.events.length,
        grants: grants.length,
        activeGrants: grants.filter((grant) => eligibility.activePurposes(grant).length).length,
        completeCollections: collections.filter((item) => item.complete).length,
        incompleteCollections: collections.filter((item) => !item.complete).length,
        memories: states,
        recallable: items.filter((item) => item.status.recallEligible).length,
      },
      attention,
      ...(followUps.memoriesNeedingRebuild.length || followUps.exportsToFollowUp.length
        ? { migrationRedactionFollowUps: followUps }
        : {}),
    }
  }

  /**
   * Re-read everything in scope and report each record that fails its schema, digest, or
   * history, each change that no audit entry records, and each audit entry that names a
   * record the store does not hold.
   */
  async verify(context) {
    assertContext(context)
    const problems = []
    const episodeIds = new Set()
    const damaged = new Set()
    const provider = this.#provider
    async function read(stream) {
      const records = []
      for (const record of await provider.readRecords(stream, { scope: context.scope })) {
        if (!sameScope(record?.scope, context.scope)) {
          problems.push(
            `${stream}: the provider returned ${record?.id ?? "a record"} from another scope`,
          )
          continue
        }
        const result = validateRecord(STREAM_KINDS[stream], record)
        if (!result.valid) {
          problems.push(`${stream} ${record.id}: ${result.errors.join("; ")}`)
          damaged.add(record)
        }
        if (stream === "episodes") episodeIds.add(record.id)
        if (stream === "events" && !episodeIds.has(record.episodeId))
          problems.push(`events ${record.id}: episode ${record.episodeId} is missing`)
        records.push(record)
      }
      return records
    }
    // The audit entries stored before anything else is read. Every record one names was
    // stored no later than the entry, so the reads below find it, even while another process
    // writes.
    const before = new Set(
      (await provider.readRecords("audit", { scope: context.scope })).map((entry) => entry?.id),
    )
    const stored = {}
    for (const stream of Object.keys(STREAMS))
      if (stream !== "audit") stored[stream] = await read(stream)
    const conflict = conflictingCollections(stored.collections.filter((item) => !damaged.has(item)))
    if (conflict)
      problems.push(`collections ${conflict[0].id}, ${conflict[1].id}: snapshot contents disagree`)
    const memories = await this.#memories(context)
    for (const entry of memories.values())
      for (const problem of entry.problems) problems.push(`memories ${entry.id}: ${problem}`)
    // The audit stream is read again last. A change and its audit entry are stored together,
    // so every change read above has its entry by now.
    const audit = (await read("audit")).filter((entry) => !damaged.has(entry))
    problems.push(
      ...unaudited(stored, memories, audit, damaged),
      ...unresolved(
        stored,
        memories,
        audit.filter((entry) => before.has(entry.id)),
      ),
    )
    const health = await this.#provider.health()
    if (!health.ok) problems.push(`provider: ${health.detail}`)
    return { ok: problems.length === 0, problems, health }
  }
}

/** Whether a learning's own dates put it outside the time it applies to. */
function validity(record, now) {
  return {
    expired: Boolean(
      (record.expiresAt && record.expiresAt <= now) ||
      (record.validUntil && record.validUntil <= now),
    ),
    notYetValid: Boolean(record.validFrom && record.validFrom > now),
  }
}

/**
 * Why a learning cannot replace another now, or null when it can. A replacement that recall does
 * not use would hide the learning it replaces and give agents nothing in its place.
 */
function replacementProblem({ expired, notYetValid, evidenceEligible = true }) {
  if (expired) return "it has expired"
  if (notYetValid) return "it does not apply yet"
  if (!evidenceEligible) return "its evidence no longer permits instruction"
  return null
}

function sameCollectionSource(collection, episode) {
  return (
    collection.kind === episode.kind &&
    collection.hubOrigin === episode.hubOrigin &&
    collection.repositoryId === episode.repositoryId
  )
}

function hubViewKey(episode, events) {
  if (episode.source.kind !== HUB_SOURCE) return null
  const comments = events.filter(
    (event) =>
      event.episodeId === episode.id &&
      event.type === "human_comment" &&
      event.payload?.role === "root",
  )
  const superseded = new Set(comments.map((event) => event.supersedes).filter(Boolean))
  const current = comments.filter((event) => !superseded.has(event.id))
  const route = current.length === 1 ? current[0].payload.context?.route : null
  if (typeof route?.pathname !== "string") return null
  return derivedId("view", {
    hubOrigin: episode.source.hubOrigin,
    repositoryId: episode.source.repositoryId,
    prototypeId: episode.source.prototypeId,
    buildNumber: episode.source.buildNumber,
    route: `${route.pathname}${route.search ?? ""}${route.hash ?? ""}`,
  })
}

function hubPrototypeKey(source) {
  return canonicalJson({
    hubOrigin: source.hubOrigin,
    repositoryId: source.repositoryId,
    prototypeId: source.prototypeId,
  })
}

/** The audit operations that may record a change to each stream, and the subject kind. */
const RECEIPTS = {
  episodes: [["collection.import", "observation.append"], "episode"],
  events: [["collection.import", "observation.append", "annotation.add"], "event"],
  grants: [["grant.add"], "grant"],
  withdrawals: [["grant.withdraw"], "withdrawal"],
  collections: [["collection.import"], "collection"],
  exports: [["export.create"], "export"],
}

/** The audit operation that records a learning version, named for the step that wrote it. */
function versionOperation(previous, version) {
  if (version.state === "accepted")
    return previous?.state === "accepted" ? "memory.supersede" : "memory.accept"
  return { proposed: "memory.propose", rejected: "memory.reject", retired: "memory.retire" }[
    version.state
  ]
}

/**
 * Each intact change that no successful audit entry names by its operation, ID, and digest:
 * an episode, event, grant, withdrawal, collection, export, or learning version.
 */
function unaudited(stored, memories, audit, damaged) {
  const recorded = new Set(
    audit
      .filter((entry) => entry.outcome === "ok")
      .flatMap((entry) =>
        entry.subjects.map(
          (subject) => `${entry.operation} ${subject.kind} ${subject.id} ${subject.digest}`,
        ),
      ),
  )
  const problems = []
  for (const [stream, [operations, kind]] of Object.entries(RECEIPTS))
    for (const record of stored[stream])
      if (
        !damaged.has(record) &&
        !operations.some((operation) =>
          recorded.has(`${operation} ${kind} ${record.id} ${record.digest}`),
        )
      )
        problems.push(
          `${stream} ${record.id}: no ${operations.length === 1 ? `${operations[0]} ` : ""}audit entry records it`,
        )
  for (const event of stored.events)
    if (
      !damaged.has(event) &&
      event.redaction &&
      !recorded.has(`evidence.redact event ${event.id} ${event.digest}`)
    )
      problems.push(`events ${event.id}: no evidence.redact audit entry records its redaction`)
  for (const entry of memories.values())
    entry.intact.forEach((version, index) => {
      const operation = versionOperation(entry.intact[index - 1], version)
      if (!recorded.has(`${operation} memory ${version.id} ${version.digest}`))
        problems.push(
          `memories ${entry.id}: no ${operation} audit entry records version ${version.version}`,
        )
    })
  return problems
}

/** The stream that holds each kind of record an audit entry names, other than a learning. */
const SUBJECTS = {
  episode: "episodes",
  event: "events",
  grant: "grants",
  withdrawal: "withdrawals",
  collection: "collections",
  export: "exports",
}

/**
 * Each record an audit entry names that the store does not hold. A subject with a digest needs
 * a record with that digest. For a learning, that is a version's digest or, as a recall
 * records it, its content digest.
 */
function unresolved(stored, memories, audit) {
  const held = new Set()
  function hold(kind, id, ...digests) {
    held.add(`${kind} ${id}`)
    for (const digest of digests) held.add(`${kind} ${id} ${digest}`)
  }
  for (const [kind, stream] of Object.entries(SUBJECTS))
    for (const record of stored[stream]) hold(kind, record.id, record.digest)
  for (const entry of memories.values())
    for (const version of entry.versions)
      hold("memory", version.id, version.digest, version.contentDigest)
  return audit.flatMap((entry) =>
    entry.subjects
      .filter(
        (subject) =>
          !held.has(
            subject.digest
              ? `${subject.kind} ${subject.id} ${subject.digest}`
              : `${subject.kind} ${subject.id}`,
          ),
      )
      .map(
        (subject) =>
          `audit ${entry.id}: ${subject.kind} ${subject.id}${subject.digest ? ` with digest ${subject.digest}` : ""} is not stored`,
      ),
  )
}

/**
 * What a consolidator may see of a memory: its lifecycle, support, and validity dates always,
 * and its content, evidence, and counterevidence only while that evidence permits the
 * consolidation's purpose.
 */
function memoryView({ record, status }) {
  return {
    id: record.id,
    version: record.version,
    state: record.state,
    kind: record.kind,
    ...(record.themeKey ? { themeKey: record.themeKey } : {}),
    ...(record.support ? { support: record.support } : {}),
    ...Object.fromEntries(
      ["validFrom", "validUntil", "expiresAt"]
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, record[key]]),
    ),
    effective: status.recallEligible,
    needsRebuild: status.needsRebuild,
    superseded: status.superseded,
    expired: status.expired,
    ...(status.evidenceEligible
      ? {
          content: record.content,
          appliesTo: record.appliesTo ?? [],
          evidence: record.evidence,
          contradictions: record.contradictions ?? [],
        }
      : {}),
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}
