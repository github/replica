import { createHash } from "node:crypto"
import { canonicalJson } from "../canonical-json.mjs"
import { LearningError } from "../errors.mjs"
import { derivedId } from "../ids.mjs"
import { sameScope } from "../policy.mjs"
import { rankForRecall } from "../recall.mjs"
import { HUB_SOURCE } from "../sources/hub-review-comments.mjs"
import { normalizeTimestamp } from "../time.mjs"
import { validateRecord } from "../validate.mjs"
import { MAX_QUESTION_LEARNINGS } from "./questions.mjs"

export const BUILDS_SCHEMA = "replica.decision-builds/v1"
/** The screenshot widths and themes the build action captures, in its order. */
export const SIZES = Object.freeze(["desktop", "narrow"])
export const THEMES = Object.freeze(["light", "dark"])
/** The share of prototypes held out for each of the dev and test splits. */
export const HOLD_OUT = 0.15

/**
 * Plan labeled decision tasks from a training export and the Builds whose screenshots show what
 * reviewers saw. Labels come only from evidence a person already reviewed:
 *
 * - A comment behind an accepted learning marks the Build its thread began on as breaking that
 *   learning, on the page the thread points to.
 * - When the reviewer who wrote that comment resolved the thread after writing it, the latest
 *   Build published by then that came after the thread's Build follows the learning on the same
 *   page, unless a thread started on that Build was labeled with the learning's theme.
 *
 * Builds come in Hub's order: when each Build's workflow was created, then its number. A task
 * shows every screenshot of its page, at each width and theme the build action captured, because
 * a reviewer may have seen any of them. A page missing one of those screenshots keeps only its
 * "follows" labels, since the problem may show only in the missing one. Tasks are split by
 * prototype, so a Build and the later Build that fixed it always share a split. Nothing is
 * guessed: evidence that cannot become a label is counted in skipped with the reason.
 *
 * @param {any} bundle a training export: { manifest, grants, episodes, memories }
 * @param {any} builds { schemaVersion: "replica.decision-builds/v1", builds: [...] }
 */
export function planDecisionTasks(bundle, builds) {
  const { manifest, episodes, memories } = readTrainingExport(bundle)
  const buildsByPrototype = readBuilds(builds)
  const skipped = new Map()
  function skip(reason, count = 1) {
    skipped.set(reason, (skipped.get(reason) ?? 0) + count)
  }

  const ranked = rankForRecall(memories).map(({ record }) => record)
  const learnings = ranked.slice(0, MAX_QUESTION_LEARNINGS)
  if (ranked.length > learnings.length)
    skip("learning-over-limit", ranked.length - learnings.length)
  const episodesById = new Map(episodes.map((episode) => [episode.id, episode]))
  const flagged = flaggedThemes(episodes)
  const groups = new Map()
  function label(view, learningId, follows, evidence) {
    const key = `${view.prototypeId}/${view.buildNumber}/${view.route}`
    const group = groups.get(key) ?? { ...view, labels: new Map(), evidence: [] }
    groups.set(key, group)
    const earlier = group.labels.get(learningId)
    group.labels.set(learningId, earlier === undefined || earlier === follows ? follows : null)
    group.evidence.push({ learningId, outcome: follows ? "follows" : "breaks", ...evidence })
  }

  for (const learning of learnings) {
    for (const [episodeId, eventIds] of citedEvents(learning)) {
      const episode = episodesById.get(episodeId)
      const cited = eventIds.map((id) => episode?.timeline?.find((event) => event.id === id))
      if (!episode || cited.some((event) => !event)) {
        skip("evidence-not-exported")
        continue
      }
      if (episode.source.kind !== HUB_SOURCE) {
        skip("evidence-not-hub-review")
        continue
      }
      const comments = problemComments(episode, cited)
      if (!comments.length) {
        skip("evidence-not-comment")
        continue
      }
      const root = rootComment(episode)
      const route = routeOf(root)
      if (!root) {
        skip("thread-start-unavailable")
        continue
      }
      if (!route) {
        skip("route-unknown")
        continue
      }
      const prototypeId = episode.source.prototypeId
      const buildNumber = episode.source.buildNumber
      label({ prototypeId, buildNumber, route }, learning.id, false, { episodeId, eventIds })
      const resolution = latestStatus(episode)
      if (resolution === null) {
        skip("status-ambiguous")
        continue
      }
      if (
        resolution?.payload.status !== "resolved" ||
        !comments.some((comment) => comment.actor.id === resolution.payload.by?.id)
      )
        continue
      // Hub keeps a thread resolved when someone edits a comment in it, so a resolution confirms
      // only the problem as it was written before the resolution.
      if (comments.some((comment) => compare(comment.at, resolution.at) >= 0)) {
        skip("resolved-before-evidence")
        continue
      }
      const builds = buildsByPrototype.get(prototypeId) ?? []
      const start = builds.findIndex((build) => build.number === buildNumber)
      if (start === -1) {
        skip("build-unknown")
        continue
      }
      const fixed = builds
        .slice(start + 1)
        .filter((build) => compare(build.publishedAt, resolution.at) <= 0)
        .at(-1)
      if (!fixed) {
        skip("resolved-without-later-build")
        continue
      }
      // An agent's label can remove a label but never add one: a thread started on the later
      // Build that was labeled with this learning's theme means the fix is in doubt.
      if (flagged.get(`${prototypeId}/${fixed.number}/${route}`)?.has(learning.themeKey)) {
        skip("follows-contradicted")
        continue
      }
      label({ prototypeId, buildNumber: fixed.number, route }, learning.id, true, {
        episodeId,
        eventIds: [...eventIds, resolution.id],
      })
    }
  }

  const tasks = []
  for (const group of [...groups.values()].sort(byView)) {
    const screenshots = (
      buildsByPrototype
        .get(group.prototypeId)
        ?.find((build) => build.number === group.buildNumber)
        ?.screenshots.filter((item) => item.route === group.route) ?? []
    ).sort(byRendering)
    // readBuilds refuses a repeated width and theme, so four screenshots are all of them.
    const complete = screenshots.length === SIZES.length * THEMES.length
    const labels = {}
    for (const [learningId, follows] of group.labels)
      if (follows === null) skip("conflicting-labels")
      else if (!screenshots.length) skip("screenshot-missing")
      // The reviewer may have seen the problem only at the missing width or theme.
      else if (!follows && !complete) skip("renderings-incomplete")
      else labels[learningId] = follows
    if (!Object.keys(labels).length) continue
    tasks.push({
      id: derivedId("task", {
        scope: manifest.scope,
        prototypeId: group.prototypeId,
        buildNumber: group.buildNumber,
        route: group.route,
      }),
      split: splitFor(manifest.scope, group.prototypeId),
      prototypeId: group.prototypeId,
      buildNumber: group.buildNumber,
      route: group.route,
      screenshots: screenshots.map(({ size, theme, path }) => ({ size, theme, path })),
      labels,
      evidence: group.evidence.filter((item) => Object.hasOwn(labels, item.learningId)),
    })
  }
  return {
    scope: manifest.scope,
    exportId: manifest.id,
    learnings: learnings.map(({ id, content }) => ({ id, content })),
    tasks,
    skipped: Object.fromEntries([...skipped].sort(([left], [right]) => compare(left, right))),
  }
}

/** The split of every task from one prototype: about 15% test, 15% dev, and the rest train. */
export function splitFor(scope, prototypeId) {
  const hash = createHash("sha256").update(canonicalJson({ scope, prototypeId }), "utf8")
  const position = Number.parseInt(hash.digest("hex").slice(0, 8), 16) / 0x1_0000_0000
  return position < HOLD_OUT ? "test" : position < 2 * HOLD_OUT ? "dev" : "train"
}

function readTrainingExport(bundle) {
  if (!isObject(bundle) || !isObject(bundle.manifest))
    invalid("The taskset needs an export bundle written by export --purpose training.")
  const { manifest } = bundle
  check("exportManifest", manifest, "the export manifest")
  if (manifest.purpose !== "training")
    invalid(
      `This export is for ${manifest.purpose}. Tasks need an export for training: run export --purpose training.`,
    )
  if (manifest.contents === "learnings")
    invalid("This export holds learnings only. Export again without --learnings-only.")
  if (![bundle.grants, bundle.episodes, bundle.memories].every(Array.isArray))
    invalid("The export bundle needs its grants, episodes, and memories lists.")
  // The manifest names every record that left the store. A record it does not name was added
  // later, and a record it names but the bundle lacks was removed, either of which can change a
  // label, so the bundle must hold exactly the records the manifest lists.
  const listed = new Set(manifest.records.map(recordKey))
  const held = new Set()
  function hold(kind, schema, record) {
    check(schema, record, `${kind} ${record?.id}`)
    if (!sameScope(record.scope, manifest.scope))
      invalid(`The export's ${kind} ${record.id} belongs to another scope.`)
    const key = recordKey({ kind, id: record.id, digest: record.digest })
    if (!listed.has(key))
      invalid(`The export manifest does not list ${kind} ${record.id} with this digest.`)
    if (held.has(key)) invalid(`The export holds ${kind} ${record.id} twice.`)
    held.add(key)
  }
  for (const grant of bundle.grants) hold("grant", "consentGrant", grant)
  for (const episode of bundle.episodes) {
    hold("episode", "episode", episode)
    for (const event of episode.timeline ?? []) {
      hold("event", "event", event)
      if (event.episodeId !== episode.id)
        invalid(`The export lists event ${event.id} under episode ${episode.id}, not its own.`)
    }
  }
  for (const memory of bundle.memories) {
    hold("memory", "memoryRecord", memory)
    if (memory.state !== "accepted") invalid(`Learning ${memory.id} is not accepted.`)
  }
  if (held.size !== listed.size)
    invalid(
      `The export is missing ${listed.size - held.size} of the records its manifest lists. Use the file export wrote, unchanged.`,
    )
  return { manifest, episodes: bundle.episodes, memories: bundle.memories }
}

function recordKey({ kind, id, digest }) {
  return `${kind}/${id}/${digest}`
}

function check(kind, record, label) {
  const { valid, errors } = validateRecord(kind, record)
  if (!valid) invalid(`The export's ${label} fails its checks: ${errors.slice(0, 3).join("; ")}`)
}

/**
 * Builds by prototype ID from a decision Builds file, each list in Hub's order: when the Build's
 * workflow was created, then its number. Hub numbers Builds as it finds them, which is not always
 * the order they were made in.
 */
function readBuilds(value) {
  if (!isObject(value) || value.schemaVersion !== BUILDS_SCHEMA || !Array.isArray(value.builds))
    invalid(`The Builds file must be { "schemaVersion": "${BUILDS_SCHEMA}", "builds": [...] }.`)
  const byPrototype = new Map()
  for (const [index, build] of value.builds.entries()) {
    const where = `Build ${index + 1}`
    if (!isObject(build) || !positive(build.prototypeId) || !positive(build.number))
      invalid(`${where} needs a positive prototypeId and number.`)
    const createdAt = time(build.createdAt, `${where} needs createdAt as an RFC 3339 time.`)
    const publishedAt = time(build.publishedAt, `${where} needs publishedAt as an RFC 3339 time.`)
    if (!Array.isArray(build.screenshots))
      invalid(`${where} needs a screenshots list, which may be empty.`)
    const views = new Set()
    const screenshots = build.screenshots.map((screenshot, position) => {
      if (
        !isObject(screenshot) ||
        typeof screenshot.route !== "string" ||
        !screenshot.route.startsWith("/") ||
        !SIZES.includes(screenshot.size) ||
        !THEMES.includes(screenshot.theme) ||
        typeof screenshot.path !== "string" ||
        !screenshot.path
      )
        invalid(
          `${where}, screenshot ${position + 1}, needs a route starting with /, a size of desktop or narrow, a theme of light or dark, and a path.`,
        )
      const view = `${screenshot.route}\n${screenshot.size}\n${screenshot.theme}`
      if (views.has(view))
        invalid(
          `${where} lists two ${screenshot.size} ${screenshot.theme} screenshots of ${screenshot.route}.`,
        )
      views.add(view)
      const { route, size, theme, path } = screenshot
      return { route, size, theme, path }
    })
    const list = byPrototype.get(build.prototypeId) ?? []
    if (list.some((item) => item.number === build.number))
      invalid(`Prototype ${build.prototypeId} lists Build ${build.number} twice.`)
    list.push({ number: build.number, createdAt, publishedAt, screenshots })
    byPrototype.set(build.prototypeId, list)
  }
  for (const list of byPrototype.values())
    list.sort(
      (left, right) => compare(left.createdAt, right.createdAt) || left.number - right.number,
    )
  return byPrototype
}

function time(value, problem) {
  try {
    return normalizeTimestamp(value)
  } catch {
    return invalid(problem)
  }
}

/** Each episode a learning cites, as evidence, with every event it cites there. */
function citedEvents(learning) {
  const cited = new Map()
  for (const reference of learning.evidence)
    cited.set(reference.episodeId, [
      ...new Set([...(cited.get(reference.episodeId) ?? []), ...reference.eventIds]),
    ])
  return cited
}

/**
 * The comment versions in which the evidence states the problem: each cited comment, and the
 * comment each cited supporting label is about. Only their authors raised the problem, so only
 * they can confirm its fix.
 */
function problemComments(episode, cited) {
  const comments = new Map()
  for (const event of cited) {
    const comment =
      event.type === "annotation" && event.payload?.stance === "supports"
        ? episode.timeline.find((item) => item.id === event.payload.target?.eventId)
        : event
    if (comment?.type === "human_comment") comments.set(comment.id, comment)
  }
  return [...comments.values()]
}

/**
 * The latest version of the comment that started the thread, while its text is available. A
 * thread whose versions do not form one line has no clear latest version, since nothing in the
 * export orders them.
 */
function rootComment(episode) {
  const comments = (episode.timeline ?? []).filter(
    (event) => event.type === "human_comment" && event.payload?.role === "root",
  )
  const replaced = new Set(comments.map((event) => event.supersedes).filter(Boolean))
  const latest = comments.filter((event) => !replaced.has(event.id))
  return latest.length === 1 ? latest[0] : undefined
}

/**
 * The page a comment points to, as the path a browser shows: pathname, query, and fragment. A
 * screenshot matches only the same full path, so a comment on /checkout?step=2 never labels a
 * screenshot of /checkout.
 */
function routeOf(comment) {
  const route = comment?.payload.context?.route
  if (typeof route?.pathname !== "string" || !route.pathname.startsWith("/")) return undefined
  return `${route.pathname}${route.search ?? ""}${route.hash ?? ""}`
}

/**
 * The themes labeled as observed problems in threads started on each Build route, keyed by
 * prototype ID, Build number, and route.
 */
function flaggedThemes(episodes) {
  const flagged = new Map()
  for (const episode of episodes) {
    const route = routeOf(rootComment(episode))
    if (episode.source.kind !== HUB_SOURCE || !route) continue
    const key = `${episode.source.prototypeId}/${episode.source.buildNumber}/${route}`
    for (const event of episode.timeline ?? [])
      if (
        event.type === "annotation" &&
        event.payload?.observation === "observed" &&
        event.payload.stance === "supports"
      )
        flagged.set(key, (flagged.get(key) ?? new Set()).add(event.payload.theme.key))
  }
  return flagged
}

/**
 * The thread's latest status change, or null when two changes share the latest time. The export
 * does not protect the order of a timeline, so a tie has no latest change.
 */
function latestStatus(episode) {
  const statuses = (episode.timeline ?? []).filter((event) => event.type === "status_change")
  const latest = statuses.reduce(
    (found, event) => (!found || compare(event.at, found.at) > 0 ? event : found),
    undefined,
  )
  return statuses.filter((event) => event.at === latest?.at).length > 1 ? null : latest
}

function byView(left, right) {
  return (
    left.prototypeId - right.prototypeId ||
    left.buildNumber - right.buildNumber ||
    compare(left.route, right.route)
  )
}

/** Desktop before narrow, and light before dark, the order the build action captures them in. */
function byRendering(left, right) {
  return (
    SIZES.indexOf(left.size) - SIZES.indexOf(right.size) ||
    THEMES.indexOf(left.theme) - THEMES.indexOf(right.theme)
  )
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function invalid(message) {
  throw new LearningError("invalid_input", message)
}
