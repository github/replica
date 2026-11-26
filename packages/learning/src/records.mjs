import packageJson from "../package.json" with { type: "json" }
import { digestOf } from "./canonical-json.mjs"

export const PRODUCER = Object.freeze({ name: packageJson.name, version: packageJson.version })

export const SCHEMA_VERSIONS = Object.freeze({
  episode: "replica.episode/v1",
  event: "replica.event/v1",
  consentGrant: "replica.consent-grant/v1",
  grantWithdrawal: "replica.grant-withdrawal/v1",
  memoryRecord: "replica.memory/v1",
  memoryProposal: "replica.memory-proposal/v1",
  providerManifest: "replica.provider/v1",
  exportManifest: "replica.export/v1",
  auditEntry: "replica.audit/v1",
  collection: "replica.collection/v1",
})

/**
 * Event types that carry a person's feedback and can be labeled: review comments and the
 * messages a person sends a coding agent. Both count toward recurring themes the same way.
 */
export const FEEDBACK_TYPES = Object.freeze(["human_comment", "user_message"])

/** A feedback event's text, or null when it was deleted at its source or removed. */
export function feedbackText(event) {
  if (!FEEDBACK_TYPES.includes(event?.type)) return null
  return (event.type === "human_comment" ? event.payload?.body : event.payload?.text) ?? null
}

/** A shallow copy without the named fields. */
export function without(record, ...keys) {
  const copy = { ...record }
  for (const key of keys) delete copy[key]
  return copy
}

/** The digest an episode carries: its header, without digest and timeline. */
export function episodeDigest(episode) {
  return digestOf(without(episode, "digest", "timeline"))
}

/** The digest of an event payload. */
export function payloadDigest(payload) {
  return digestOf(payload)
}

/**
 * The digest an event carries: every field except digest, payload, and redaction. payloadDigest
 * covers the payload, so removing a payload and recording why leaves the digest intact.
 */
export function eventDigest(event) {
  return digestOf(without(event, "digest", "payload", "redaction"))
}

/** The digest of any other v1 record: every field except digest. */
export function recordDigest(record) {
  return digestOf(without(record, "digest"))
}

/**
 * What a reviewer approves when accepting a memory. Lifecycle state, version bookkeeping,
 * support counts, and supersession links are left out, so a lifecycle change never voids
 * an approval, while any change to the learning itself does.
 */
export function memoryContentDigest(memory) {
  return digestOf({
    scope: memory.scope,
    kind: memory.kind,
    ...(memory.title !== undefined ? { title: memory.title } : {}),
    content: memory.content,
    appliesTo: memory.appliesTo ?? [],
    lifecycle: memory.proposal?.lifecycle ?? null,
    evidence: memory.evidence,
    validFrom: memory.validFrom ?? null,
    validUntil: memory.validUntil ?? null,
    expiresAt: memory.expiresAt ?? null,
  })
}

/**
 * What a reviewer is shown before deciding: the learning itself plus its contradictions,
 * support, confidence, rationale, and proposer. New dissent or support therefore changes it,
 * and a decision made against an older picture is refused.
 */
export function memoryReviewDigest(memory) {
  return digestOf({
    content: memoryContentDigest(memory),
    themeKey: memory.themeKey ?? null,
    contradictions: memory.contradictions ?? [],
    support: memory.support ?? null,
    confidence: memory.confidence ?? null,
    rationale: memory.proposal?.rationale ?? null,
    consolidator: memory.proposal?.consolidator ?? null,
  })
}

export function sealEpisode(episode) {
  const header = without(episode, "digest", "timeline")
  return { ...header, digest: episodeDigest(header) }
}

export function sealEvent(event) {
  const sealed = without(event, "digest")
  if (sealed.payload !== undefined) sealed.payloadDigest = payloadDigest(sealed.payload)
  return { ...sealed, digest: eventDigest(sealed) }
}

export function sealRecord(record) {
  const sealed = without(record, "digest")
  return { ...sealed, digest: recordDigest(sealed) }
}

export function sealMemory(memory) {
  const sealed = without(memory, "digest")
  sealed.contentDigest = memoryContentDigest(sealed)
  sealed.reviewDigest = memoryReviewDigest(sealed)
  return { ...sealed, digest: recordDigest(sealed) }
}

/**
 * The digest problems of a stored record of the given kind, empty when it is intact.
 *
 * @param {string} kind
 * @param {Record<string, any>} record
 */
export function digestProblems(kind, record) {
  const problems = []
  if (kind === "episode") {
    if (record.digest !== episodeDigest(record))
      problems.push("digest does not match the episode header")
    for (const [index, event] of (record.timeline ?? []).entries())
      problems.push(
        ...digestProblems("event", event).map((problem) => `/timeline/${index}: ${problem}`),
      )
  } else if (kind === "event") {
    if (record.payload !== undefined && record.payloadDigest !== payloadDigest(record.payload))
      problems.push("payloadDigest does not match the payload")
    if (record.digest !== eventDigest(record)) problems.push("digest does not match the event")
  } else {
    if (record.digest !== recordDigest(record)) problems.push("digest does not match the record")
    if (kind === "memoryRecord") {
      const content = memoryContentDigest(record)
      if (record.contentDigest !== content)
        problems.push("contentDigest does not match the memory content")
      if (record.accepted && record.accepted.contentDigest !== content)
        problems.push("the approval does not cover the current memory content")
      if (record.reviewDigest !== memoryReviewDigest(record))
        problems.push("reviewDigest does not match what a reviewer is shown")
    }
  }
  return problems
}
