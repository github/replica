import { canonicalJson } from "../canonical-json.mjs"
import { LearningError } from "../errors.mjs"
import { derivedId } from "../ids.mjs"
import { PRODUCER, SCHEMA_VERSIONS } from "../records.mjs"
import { normalizeTimestamp } from "../time.mjs"

/** The source kind of agent sessions, used by episodes, evidence, and consent grants. */
export const SESSION_SOURCE = "agent_session"

/** The longest message or outcome summary kept, matching the contract limits. */
const MESSAGE_CHARS = 10_000
const SUMMARY_CHARS = 2_000
const MESSAGES = 5_000
const NOTES = 200
const NOTE_MESSAGES = 200
const NOTE_CONTEXT_CHARS = 1_000
const ROLES = ["user", "agent", "tool"]
const NOTE_ROLES = ["author", "copilot"]
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const STATUSES = ["success", "failure", "partial", "unknown"]
const PERSON = /^(?:github|human):[^\s\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]{1,256}$/u
const SESSION_ID = /^[^\s\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]{1,200}$/u
const SECRET = "[redacted secret]"

// Well-known credential shapes. Sessions often echo tokens from terminals and config files,
// and a stored token stays usable until someone rotates it.
const SECRETS = [
  // A pasted key may be cut off, so the end of the text also ends the block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]

/** Replace well-known secret patterns, such as tokens and private keys, with a marker. */
export function scrubSecrets(text) {
  let scrubbed = text
  for (const pattern of SECRETS) scrubbed = scrubbed.replace(pattern, SECRET)
  return scrubbed.replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, `$1${SECRET}`).replace(
    // A scheme starts where a run of scheme characters starts, and user details are
    // bounded, so a long message is scanned in linear time.
    /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/:@]{1,256}:[^\s/@]{1,256}@/gi,
    `$1${SECRET}@`,
  )
}

/**
 * Check a session someone submits and keep only what learning may use: the user and agent
 * messages in order, and the outcome. Tool calls and tool output are dropped because they hold
 * file contents and command output, not feedback. The task is checked but not kept: it cannot
 * be redacted or dated like a message, so send it as the first user message when it matters.
 * Text is scrubbed of secrets and capped.
 *
 * The input is { sessionId, task?, user?, startedAt?, messages: [{ role, text, at? }],
 * outcome?: { status, summary? }, pickAndPolishNotes? }. role is user, agent, or tool. user names
 * the person, such as github:octocat. Each kept message keeps its position in the list as sent,
 * counting dropped ones, so filling in or emptying one message never changes which message
 * another one is.
 *
 * pickAndPolishNotes are the notes a person left on the prototype in the Replica canvas, as the
 * canvas's improvement_batch returned them. The agent reads them through a tool, so without this
 * the person's words never reach the conversation that is stored.
 *
 * @param {unknown} input
 */
export function readAgentSession(input) {
  if (!isObject(input)) invalid("A session must be an object.")
  const { sessionId, task, user, startedAt, messages, outcome, pickAndPolishNotes } = input
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
      sequence: index + 1,
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
  const summary = outcome?.summary === undefined ? "" : clean(outcome.summary, SUMMARY_CHARS)
  return {
    sessionId,
    user: {
      kind: "human",
      id: user ?? "human:session-user",
      role: "user",
      asserted: true,
    },
    ...(startedAt === undefined ? {} : { startedAt: timestamp(startedAt, "startedAt") }),
    messages: kept,
    ...(outcome ? { outcome: { status: outcome.status, ...(summary ? { summary } : {}) } } : {}),
    notes: readNotes(pickAndPolishNotes),
    skipped,
  }
}

/**
 * Check Pick & Polish notes and keep each one's request and replies. A note's request is
 * read-only and each reply has its own ID, so a note sent again adds only new replies.
 */
function readNotes(notes) {
  if (notes === undefined) return []
  if (!Array.isArray(notes) || notes.length > NOTES)
    invalid(`pickAndPolishNotes must be a list of at most ${NOTES} notes.`)
  const seen = new Set()
  return notes.flatMap((note, index) => {
    const label = `Pick & Polish note ${index + 1}`
    if (!isObject(note) || typeof note.localId !== "string" || !SESSION_ID.test(note.localId))
      invalid(`${label} needs its localId.`)
    if (seen.has(note.localId)) invalid(`${label} repeats localId ${note.localId}.`)
    seen.add(note.localId)
    const thread = note.thread ?? {}
    if (!isObject(thread)) invalid(`${label} needs its thread as an object.`)
    const replies = thread.messages ?? []
    if (!Array.isArray(replies) || replies.length > NOTE_MESSAGES)
      invalid(`${label} needs a thread of at most ${NOTE_MESSAGES} messages.`)
    const entries = []
    if (note.body !== null && note.body !== undefined) {
      if (typeof note.body !== "string") invalid(`${label} needs its body as a string.`)
      const text = clean(note.body, MESSAGE_CHARS)
      if (text)
        entries.push({
          position: "request",
          role: "author",
          text,
          sequence: 0,
          login: noteLogin(thread.originalAuthor, label),
        })
    }
    for (const [at, reply] of replies.entries()) {
      if (
        !isObject(reply) ||
        typeof reply.id !== "string" ||
        !SESSION_ID.test(reply.id) ||
        !NOTE_ROLES.includes(reply.role) ||
        typeof reply.body !== "string"
      )
        invalid(`${label} message ${at + 1} needs an id, a role of author or copilot, and a body.`)
      const text = clean(reply.body, MESSAGE_CHARS)
      if (text)
        entries.push({
          position: reply.id,
          role: reply.role,
          text,
          sequence: at + 1,
          login: reply.role === "author" ? noteLogin(reply.author, label) : undefined,
        })
    }
    if (!entries.length) return []
    return [{ localId: note.localId, entries, context: noteContext(note.anchor) }]
  })
}

function noteLogin(author, label) {
  if (author === undefined || author === null) return undefined
  if (!isObject(author) || typeof author.login !== "string" || !LOGIN.test(author.login))
    invalid(`${label} names an author without a GitHub login.`)
  return author.login
}

/** Where on the prototype the note points, so labeling can say which page and element. */
function noteContext(anchor) {
  if (!isObject(anchor)) return undefined
  const pathname = isObject(anchor.route) ? contextText(anchor.route.pathname) : undefined
  const tagName = contextText(anchor.tagName)
  const accessibleName = contextText(anchor.accessibleName)
  const context = {
    ...(pathname ? { route: { pathname } } : {}),
    ...(tagName ? { tagName } : {}),
    ...(accessibleName ? { accessibleName } : {}),
  }
  return Object.keys(context).length ? context : undefined
}

function contextText(value) {
  return typeof value === "string" && value.trim() ? clean(value, NOTE_CONTEXT_CHARS) : undefined
}

/**
 * The episode ID of a session in a scope, so sending the same session again updates one
 * episode. A store also checks the scopes the repository had before a migration.
 */
export function sessionEpisodeId(scope, sessionId) {
  return derivedId("ep", { scope, source: SESSION_SOURCE, sessionId })
}

/**
 * The episode that holds a session. Its header is fixed when the session is first sent and holds
 * no session text, so redacting a message removes all of that message's text.
 */
export function sessionEpisode({ session, scope, grantIds, principal, importedAt }) {
  const first = session.messages.find((message) => message.at)?.at
  return {
    schemaVersion: SCHEMA_VERSIONS.episode,
    id: sessionEpisodeId(scope, session.sessionId),
    scope,
    source: { kind: SESSION_SOURCE, sessionId: session.sessionId },
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
 * rewritten: a message whose text changed adds a version that supersedes the latest one at its
 * position, and a changed outcome does the same. Unchanged messages add nothing.
 *
 * An event's ID comes from its episode, its position, and the version it replaces, never its
 * text, so the history of a position is found even after a person redacts its text. A position
 * whose text a person removed takes no new versions, so sending the session again cannot bring
 * the text back. Two imports that change the same position at once make the same ID with
 * different content, and the provider refuses the second as a conflict.
 *
 * A resent message must keep its author and time; correcting them is refused rather than
 * silently ignored, because evidence is dated and attributed by its first version.
 */
export function sessionEvents({ session, scope, episodeId, principal, existing, now }) {
  const { add, added } = timeline({ episodeId, scope, existing })
  for (const message of session.messages) {
    const type = message.role === "user" ? "user_message" : "agent_message"
    const actor = message.role === "user" ? session.user : principal
    add(
      message.sequence,
      type,
      message.at ?? now,
      actor,
      { text: message.text, sequence: message.sequence },
      (latest) => {
        if (latest.type !== type || latest.payload.text !== message.text) return false
        if (latest.actor.id !== actor.id || (message.at && message.at !== latest.at))
          throw new LearningError(
            "conflict",
            `Message ${message.sequence} of session ${session.sessionId} was first sent by another author or at another time. Send it as it was first sent.`,
          )
        return true
      },
    )
  }
  if (session.outcome)
    add(
      "outcome",
      "session_outcome",
      now,
      principal,
      session.outcome,
      (latest) => canonicalJson(latest.payload) === canonicalJson(session.outcome),
    )
  return added
}

/**
 * The episode ID of a Pick & Polish note in a scope. A note lives on across sessions, so its
 * episode follows the note rather than the session that first sent it.
 */
export function noteEpisodeId(scope, localId) {
  return derivedId("ep", { scope, source: SESSION_SOURCE, pickAndPolishNote: localId })
}

/**
 * The episode that holds one Pick & Polish note, like a review thread in Hub. It comes under the
 * same consent as the session that sent it, because the person wrote it to the same agent.
 */
export function noteEpisode({ note, session, scope, grantIds, principal, importedAt }) {
  return {
    schemaVersion: SCHEMA_VERSIONS.episode,
    id: noteEpisodeId(scope, note.localId),
    scope,
    source: { kind: SESSION_SOURCE, sessionId: session.sessionId },
    actors: [session.user, principal],
    grants: [...grantIds],
    contentTrust: { untrusted: true, treatAs: "data", source: SESSION_SOURCE },
    provenance: {
      producer: { ...PRODUCER },
      method: "import:pick_and_polish",
      createdAt: importedAt,
      createdBy: principal,
    },
    startedAt: importedAt,
  }
}

/**
 * The events a Pick & Polish note adds to its episode: the person's request and follow-ups as
 * their messages, and Copilot's replies as agent messages. A message is kept as first sent, so
 * a later session that knows the person by another name does not fail on an old note.
 */
export function noteEvents({ note, session, scope, episodeId, principal, existing, now }) {
  const { add, added } = timeline({ episodeId, scope, existing })
  for (const [index, entry] of note.entries.entries()) {
    const person = entry.role === "author"
    const actor = !person
      ? principal
      : entry.login
        ? { kind: "human", id: `github:${entry.login}`, role: "user", asserted: true }
        : session.user
    add(
      entry.position,
      person ? "user_message" : "agent_message",
      now,
      actor,
      {
        text: entry.text,
        sequence: entry.sequence,
        ...(index === 0 && note.context ? { context: note.context } : {}),
      },
      (latest) => latest.payload.text === entry.text,
    )
  }
  return added
}

/**
 * Adds versions to an episode's timeline. Each position keeps a chain of versions, and a new
 * one is added only when compare says the latest differs. A removed version stops the chain.
 */
function timeline({ episodeId, scope, existing }) {
  const next = new Map(
    existing.filter((event) => event.supersedes).map((event) => [event.supersedes, event]),
  )
  const byId = new Map(existing.map((event) => [event.id, event]))
  function history(position) {
    const versions = []
    for (
      let event = byId.get(eventId(episodeId, position, null));
      event;
      event = next.get(event.id)
    )
      versions.push(event)
    return versions
  }
  const added = []
  function add(position, type, at, actor, payload, compare) {
    const versions = history(position)
    const latest = versions.at(-1)
    if (versions.some((version) => version.payload === undefined)) return
    if (latest && compare(latest)) return
    added.push({
      schemaVersion: SCHEMA_VERSIONS.event,
      id: eventId(episodeId, position, latest?.id ?? null),
      episodeId,
      scope,
      type,
      at,
      actor,
      payload,
      ...(latest ? { supersedes: latest.id } : {}),
    })
  }
  return { add, added }
}

function eventId(episodeId, position, after) {
  return derivedId("ev", { episodeId, position, after })
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
