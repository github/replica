import { canonicalJson } from "./canonical-json.mjs"
import { LearningError } from "./errors.mjs"
import { OBSERVATIONS, SIGNALS, STANCES } from "./labelers/copilot.mjs"
import { oneLine } from "./recall.mjs"
import { feedbackText } from "./records.mjs"
import { stableReviewer } from "./sources/hub-review-comments.mjs"
import { isTimestamp } from "./time.mjs"

const SLUG = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const BATCH_CHARS = 16_000
const COMMENT_CHARS = 2_000
const THEMES = 200

/**
 * Label the review comments a labeler has not been asked about. Messages a person sent a coding
 * agent count as comments too, grouped by session. The labeler sees only comments the
 * review purpose may use now, grouped in their threads, without who wrote them, and the themes
 * already in use so it can reuse their keys. Each label it returns is checked, then recorded as
 * the labeler's judgment under context.principal. Only a person turns a theme into a learning.
 *
 * Every comment the labeler was asked about ends up labeled or marked as having nothing to
 * label, including one whose label the contract refused, so it is not asked about that comment
 * again. It still sees the comment as context when asked about another comment in its thread.
 * An edited comment is a new version and is asked about again.
 *
 * @param {object} store an open learning store
 * @param {{ scope: object, principal: { kind: "agent", id: string } }} context
 * @param {{ labeler: { label: Function }, limit?: number, maxRequests?: number, since?: string }}
 *   options since skips comments written before that RFC 3339 UTC time. maxRequests bounds labeler
 *   invocations so the host can recheck access and retain usage between requests.
 */
export async function labelComments(store, context, { labeler, limit = 400, maxRequests, since }) {
  if (context?.principal?.kind !== "agent")
    throw new LearningError("invalid_input", "A labeler records its labels as an agent.")
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new LearningError("invalid_input", "The comment limit must be a positive whole number.")
  if (maxRequests !== undefined && (!Number.isSafeInteger(maxRequests) || maxRequests < 1))
    throw new LearningError("invalid_input", "maxRequests must be a positive safe integer.")
  if (since !== undefined && !isTimestamp(since))
    throw new LearningError("invalid_input", "since must be an RFC 3339 UTC time.")
  const { episodes, events } = await store.queryObservations(context, {
    purpose: "review",
  })
  const { comments, waiting } = labelingView(episodes, events, context.principal.id, since)
  const annotations = events.filter(
    (event) => event.type === "annotation" && event.payload !== undefined,
  )
  const chosen = new Set(waiting.slice(0, limit).map((event) => event.id))
  const themes = knownThemes(annotations)
  const result = {
    considered: 0,
    labeled: 0,
    remaining: waiting.length,
    rejected: [],
    events: [],
    models: [],
    usage: { requests: 0, inputTokens: 0, outputTokens: 0, nanoAiu: 0 },
  }
  const groups = batches(threadsOf(comments, chosen))
  const sent = new Set()
  let invocations = 0
  try {
    for (const batch of groups) {
      if (maxRequests !== undefined && invocations >= maxRequests) break
      const asked = new Set(
        batch.flatMap((thread) =>
          thread.comments.filter((comment) => comment.label).map((comment) => comment.id),
        ),
      )
      invocations++
      for (const id of asked) sent.add(id)
      result.considered += asked.size
      let answer
      try {
        answer = await labeler.label({ threads: batch, themes })
      } catch (error) {
        try {
          addUsage(error?.details?.usage ?? [])
        } catch (usageError) {
          if (!(usageError instanceof LearningError) || usageError.code !== "invalid_record")
            throw usageError
          result.usageError =
            "Some usage from the failed request is unknown. Totals include only verified usage."
        }
        throw error
      }
      addUsage(answer.usage ?? [])
      const models = [...new Set((answer.usage ?? []).map((item) => item.model).filter(Boolean))]
      const labels = []
      for (const label of answer.labels ?? []) {
        const problem = labelProblem(label, asked)
        if (problem) {
          result.rejected.push({
            comment: String(label?.comment ?? ""),
            reason: problem,
          })
          continue
        }
        asked.delete(label.comment)
        labels.push({
          target: { eventId: label.comment },
          theme: {
            key: themeKey(label.theme.key),
            statement: oneLine(label.theme.statement),
          },
          signal: label.signal,
          observation: label.observation,
          stance: label.stance,
        })
      }
      const principal = {
        ...context.principal,
        ...(models.length ? { model: models.join(", ").slice(0, 200) } : {}),
      }
      if (labels.length) {
        const created = await store.annotate({ ...context, principal }, labels)
        result.labeled += labels.length
        result.events.push(...created.map((event) => event.id))
        result.remaining -= labels.length
      }
      // What is left in asked got no label the contract accepts.
      if (asked.size) {
        await store.recordNoAnnotation({ ...context, principal }, [...asked])
        result.remaining -= asked.size
      }
    }
  } catch (error) {
    const failure = labelingError(error)
    try {
      const currentView = await store.queryObservations(context, { purpose: "review" })
      const current = currentView.events
      result.remaining = labelingView(
        currentView.episodes,
        current,
        context.principal.id,
        since,
      ).waiting.length
      const previous = new Set(events.map((event) => event.id))
      const stored = current.filter(
        (event) =>
          event.type === "annotation" &&
          event.actor.id === context.principal.id &&
          !previous.has(event.id) &&
          sent.has(event.parentEventId),
      )
      result.events = [...new Set([...result.events, ...stored.map((event) => event.id)])]
      result.labeled = Math.max(
        result.labeled,
        new Set(stored.map((event) => event.parentEventId)).size,
      )
    } catch (progressError) {
      result.progressError = `Could not reconcile durable labeling progress: ${labelingError(progressError).message}`
    }
    failure.details = {
      ...failure.details,
      labelingResult: {
        ...result,
        unlabeled: result.considered - result.labeled,
      },
    }
    throw failure
  }
  return { ...result, unlabeled: result.considered - result.labeled }

  function addUsage(usage) {
    if (
      !Array.isArray(usage) ||
      usage.includes(undefined) ||
      usage.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          (item.model !== null && item.model !== undefined && typeof item.model !== "string") ||
          ["inputTokens", "outputTokens", "nanoAiu"].some(
            (key) => item[key] !== undefined && (!Number.isSafeInteger(item[key]) || item[key] < 0),
          ),
      )
    )
      throw new LearningError(
        "invalid_record",
        "Labeler usage must contain nonnegative safe integer counts and string model IDs.",
      )
    for (const item of usage) {
      for (const key of ["inputTokens", "outputTokens", "nanoAiu"])
        if (!Number.isSafeInteger(result.usage[key] + (item[key] ?? 0)))
          throw new LearningError(
            "invalid_record",
            `Labeler ${key} usage exceeds the safe integer range.`,
          )
      result.usage.requests++
      result.usage.inputTokens += item.inputTokens ?? 0
      result.usage.outputTokens += item.outputTokens ?? 0
      result.usage.nanoAiu += item.nanoAiu ?? 0
    }
    result.models = [
      ...new Set([...result.models, ...usage.map((item) => item.model).filter(Boolean)]),
    ]
  }
}

/** Keep failure reports usable even when a configured labeler throws a non-Error value. */
export function labelingError(error) {
  const message =
    typeof error?.message === "string"
      ? error.message
      : error !== null && ["object", "function"].includes(typeof error)
        ? "The labeler failed with a non-Error value."
        : String(error)
  return error instanceof LearningError
    ? error
    : new LearningError(typeof error?.code === "string" ? error.code : "unavailable", message)
}

function labelingView(episodes, events, principalId, since) {
  const retracted = new Set(
    events.filter((event) => event.type === "retraction").map((event) => event.parentEventId),
  )
  const superseded = new Set(events.map((event) => event.supersedes).filter(Boolean))
  const episodeById = new Map(episodes.map((episode) => [episode.id, episode]))
  function identity(event) {
    const source = episodeById.get(event.episodeId)?.source
    const commentId = event.payload?.commentId
    if (
      source?.kind !== "hub_review_comments" ||
      [source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId, commentId].some(
        (value) => value === undefined,
      )
    )
      return event.id
    return canonicalJson([
      source.hubOrigin,
      source.repositoryId,
      source.prototypeId,
      source.threadId,
      commentId,
    ])
  }
  const candidates = events.filter(
    (event) =>
      feedbackText(event) !== null && !retracted.has(event.id) && !superseded.has(event.id),
  )
  function keyOf(event) {
    return canonicalJson([identity(event), event.at])
  }
  const byId = new Map(candidates.map((event) => [event.id, event]))
  const done = new Set(
    events
      .filter(
        (event) =>
          ["annotation", "no_annotation"].includes(event.type) &&
          event.payload !== undefined &&
          event.actor.id === principalId,
      )
      .map((event) => byId.get(event.parentEventId))
      .filter(Boolean)
      .map(keyOf),
  )
  const latest = new Map()
  for (const event of candidates) {
    const key = identity(event)
    if (!latest.has(key) || latest.get(key) < event.at) latest.set(key, event.at)
  }
  const copies = new Map()
  for (const event of candidates) {
    if (event.at < latest.get(identity(event))) continue
    const key = keyOf(event)
    const previous = copies.get(key)
    const episode = episodeById.get(event.episodeId)
    const stable = stableReviewer(event.actor, episode.scope, episode.source)
    const oldEpisode = previous && episodeById.get(previous.episodeId)
    const oldStable =
      previous && stableReviewer(previous.actor, oldEpisode.scope, oldEpisode.source)
    if (!previous || (stable && !oldStable) || (stable === oldStable && event.id < previous.id))
      copies.set(key, event)
  }
  const comments = [...copies.values()]
  return {
    comments,
    waiting: comments.filter(
      (event) => !done.has(keyOf(event)) && (since === undefined || event.at >= since),
    ),
  }
}

/** Why a label cannot be recorded, or null. Each asked comment takes at most one label. */
function labelProblem(label, asked) {
  if (!label || typeof label !== "object") return "It is not a label."
  if (!asked.has(label.comment))
    return "It names a comment that was not asked about or already has a label."
  const key = themeKey(label.theme?.key)
  if (!key || key.length > 128 || !SLUG.test(key)) return "Its theme key is not kebab-case."
  const statement = oneLine(label.theme?.statement ?? "")
  if (!statement || statement.length > 1000) return "Its statement is empty or too long."
  if (!SIGNALS.includes(label.signal)) return "Its signal is not one the contract allows."
  if (!OBSERVATIONS.includes(label.observation))
    return "Its observation is not one the contract allows."
  if (!STANCES.includes(label.stance)) return "Its stance is not supports or contradicts."
  return null
}

/** A theme key in lowercase kebab-case, the form the contract's slugs take. */
function themeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
}

/** The themes labels already use, most used first, so a labeler can reuse their keys. */
function knownThemes(annotations) {
  const themes = new Map()
  for (const event of annotations) {
    const { key, statement } = event.payload.theme
    const entry = themes.get(key) ?? { key, statement, uses: 0 }
    entry.statement = statement
    entry.uses++
    themes.set(key, entry)
  }
  return [...themes.values()]
    .sort((left, right) => right.uses - left.uses || (left.key < right.key ? -1 : 1))
    .slice(0, THEMES)
    .map(({ key, statement }) => ({ key, statement }))
}

/**
 * Threads that hold a chosen comment, each with its live comments in order. Earlier comments
 * come along as context, marked label: false, so a reply can be read against what it answers.
 */
function threadsOf(comments, chosen) {
  const threads = new Map()
  for (const event of comments) {
    const list = threads.get(event.episodeId) ?? []
    list.push(event)
    threads.set(event.episodeId, list)
  }
  return [...threads.values()]
    .filter((list) => list.some((event) => chosen.has(event.id)))
    .map((list) => ({
      comments: list.map((event) => ({
        id: event.id,
        label: chosen.has(event.id),
        text: oneLine(feedbackText(event)).slice(0, COMMENT_CHARS),
        ...where(event.payload.context),
      })),
    }))
}

/** Where on the prototype a root comment points, when it says. */
function where(context) {
  if (!context) return {}
  const element = [
    context.tagName,
    context.accessibleName && `"${oneLine(context.accessibleName)}"`,
  ]
    .filter(Boolean)
    .join(" ")
  return {
    ...(context.route?.pathname ? { page: context.route.pathname.slice(0, 200) } : {}),
    ...(element ? { element: element.slice(0, 200) } : {}),
  }
}

/** Threads in groups that fit one request. A thread larger than a group goes alone. */
function batches(threads) {
  const groups = []
  let current = []
  let size = 0
  for (const thread of threads) {
    const length = JSON.stringify(thread).length
    if (current.length && size + length > BATCH_CHARS) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(thread)
    size += length
  }
  if (current.length) groups.push(current)
  return groups
}
