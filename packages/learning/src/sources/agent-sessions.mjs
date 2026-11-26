import { canonicalJson } from "../canonical-json.mjs"
import { LearningError } from "../errors.mjs"
import { derivedId } from "../ids.mjs"
import { PRODUCER, SCHEMA_VERSIONS } from "../records.mjs"
import { normalizeTimestamp } from "../time.mjs"

/** The source kind of agent sessions, used by episodes, evidence, and consent grants. */
export const SESSION_SOURCE = "agent_session"

/** The longest message, task, or outcome summary kept, matching the contract limits. */
const MESSAGE_CHARS = 10_000
const SUMMARY_CHARS = 2_000
const MESSAGES = 5_000
const ROLES = ["user", "agent", "tool"]
const STATUSES = ["success", "failure", "partial", "unknown"]
const PERSON = /^(?:github|human):[^\s\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]{1,256}$/u
const SESSION_ID = /^[^\s\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]{1,200}$/u
const SECRET = "[redacted secret]"

// Well-known credential shapes. Sessions often echo tokens from terminals and config files,
// and a stored token stays usable until someone rotates it.
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]

/** Replace well-known secret patterns, such as tokens and private keys, with a marker. */
export function scrubSecrets(text) {
  let scrubbed = text
  for (const pattern of SECRETS) scrubbed = scrubbed.replace(pattern, SECRET)
  return scrubbed
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/g, `$1${SECRET}`)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${SECRET}@`)
}

/**
 * Check a session someone submits and keep only what learning may use: the task, the user and
 * agent messages in order, and the outcome. Tool calls and tool output are dropped because they
 * hold file contents and command output, not feedback. Text is scrubbed of secrets and capped.
 *
 * The input is { sessionId, task?, user?, startedAt?, messages: [{ role, text, at? }],
 * outcome?: { status, summary? } }. role is user, agent, or tool. user names the person, such as
 * github:octocat.
 *
 * @param {unknown} input
 */
export function readAgentSession(input) {
  if (!isObject(input)) invalid("A session must be an object.")
  const { sessionId, task, user, startedAt, messages, outcome } = input
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId))
    invalid("sessionId must be 1 to 200 characters with no spaces or control characters.")
  if (user !== undefined && (typeof user !== "string" || !PERSON.test(user)))
    invalid("user must look like github:<login> or human:<name>.")
  if (!Array.isArray(messages) || messages.length > MESSAGES)
    invalid(`messages must be a list of at most ${MESSAGES} messages.`)
  const kept = []
  let skipped = 0
  for (const [index, message] of messages.entries()) {
    if (!isObject(message) || !ROLES.includes(message.role))
      invalid(`Message ${index + 1} needs a role of user, agent, or tool.`)
    if (typeof message.text !== "string")
      invalid(`Message ${index + 1} needs its text as a string.`)
    if (message.role === "tool") {
      skipped++
      continue
    }
    const text = clean(message.text, MESSAGE_CHARS)
    if (!text) {
      skipped++
      continue
    }
    kept.push({
      role: message.role,
      text,
      sequence: kept.length + 1,
      ...(message.at === undefined ? {} : { at: timestamp(message.at, `Message ${index + 1}`) }),
    })
  }
  if (outcome !== undefined) {
    if (!isObject(outcome) || !STATUSES.includes(outcome.status))
      invalid(`outcome.status must be one of ${STATUSES.join(", ")}.`)
    if (outcome.summary !== undefined && typeof outcome.summary !== "string")
      invalid("outcome.summary must be a string.")
  }
  if (task !== undefined && typeof task !== "string") invalid("task must be a string.")
  const prompt = task === undefined ? "" : clean(task, MESSAGE_CHARS)
  const summary = outcome?.summary === undefined ? "" : clean(outcome.summary, SUMMARY_CHARS)
  return {
    sessionId,
    ...(prompt ? { task: prompt } : {}),
    user: {
      kind: "human",
      id: user ?? "human:session-user",
      role: "user",
      asserted: true,
    },
    ...(startedAt === undefined ? {} : { startedAt: timestamp(startedAt, "startedAt") }),
    messages: kept,
    ...(outcome ? { outcome: { status: outcome.status, ...(summary ? { summary } : {}) } } : {}),
    skipped,
  }
}

/** The episode ID of a session, so sending the same session again updates one episode. */
export function sessionEpisodeId(scope, sessionId) {
  return derivedId("ep", { scope, source: SESSION_SOURCE, sessionId })
}

/** The episode that holds a session. Its header is fixed when the session is first sent. */
export function sessionEpisode({ session, scope, grantIds, principal, importedAt }) {
  const first = session.messages.find((message) => message.at)?.at
  return {
    schemaVersion: SCHEMA_VERSIONS.episode,
    id: sessionEpisodeId(scope, session.sessionId),
    scope,
    source: { kind: SESSION_SOURCE, sessionId: session.sessionId },
    ...(session.task ? { task: { prompt: session.task } } : {}),
    actors: [session.user, principal],
    grants: [...grantIds],
    contentTrust: { untrusted: true, treatAs: "data", source: SESSION_SOURCE },
    provenance: {
      producer: { ...PRODUCER },
      method: "import:agent_session",
      createdAt: importedAt,
      createdBy: principal,
    },
    startedAt: session.startedAt ?? first ?? importedAt,
  }
}

/**
 * The events a session adds to its episode, given the events already stored. Nothing is
 * rewritten: a message whose text changed adds a version that supersedes the last one, and a
 * changed outcome does the same. Messages already stored unchanged add nothing.
 */
export function sessionEvents({ session, scope, episodeId, principal, existing, now }) {
  const superseded = new Set(existing.map((event) => event.supersedes).filter(Boolean))
  const live = existing.filter((event) => !superseded.has(event.id))
  const added = []
  for (const message of session.messages) {
    const previous = live.find(
      (event) =>
        ["user_message", "agent_message"].includes(event.type) &&
        event.payload?.sequence === message.sequence,
    )
    const type = message.role === "user" ? "user_message" : "agent_message"
    const payload = { text: message.text, sequence: message.sequence }
    if (previous?.type === type && previous.payload.text === message.text) continue
    added.push(
      event({
        episodeId,
        scope,
        type,
        at: message.at ?? now,
        actor: message.role === "user" ? session.user : principal,
        payload,
        previous,
      }),
    )
  }
  if (session.outcome) {
    const previous = live.find((item) => item.type === "session_outcome")
    if (!previous || canonicalJson(previous.payload) !== canonicalJson(session.outcome))
      added.push(
        event({
          episodeId,
          scope,
          type: "session_outcome",
          at: now,
          actor: principal,
          payload: session.outcome,
          previous,
        }),
      )
  }
  return added
}

function event({ episodeId, scope, type, at, actor, payload, previous }) {
  return {
    schemaVersion: SCHEMA_VERSIONS.event,
    id: derivedId("ev", { episodeId, type, payload, after: previous?.id ?? null }),
    episodeId,
    scope,
    type,
    at,
    actor,
    payload,
    ...(previous ? { supersedes: previous.id } : {}),
  }
}

/** Scrub, trim, and cap text without splitting a character in two. */
function clean(text, limit) {
  const scrubbed = scrubSecrets(text).trim()
  if (scrubbed.length <= limit) return scrubbed
  const cut = /[\uD800-\uDBFF]/.test(scrubbed[limit - 1]) ? limit - 1 : limit
  return scrubbed.slice(0, cut)
}

function timestamp(value, label) {
  try {
    return normalizeTimestamp(value)
  } catch {
    return invalid(`${label} needs an RFC 3339 time.`)
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function invalid(message) {
  throw new LearningError("invalid_input", message)
}
