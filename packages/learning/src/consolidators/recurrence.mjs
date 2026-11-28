import { canonicalJson } from "../canonical-json.mjs"
import { LearningError } from "../errors.mjs"
import { FEEDBACK_TYPES, PRODUCER, SCHEMA_VERSIONS, feedbackText, without } from "../records.mjs"

export const DEFAULT_RECURRENCE_OPTIONS = Object.freeze({
  minEpisodes: 2,
  minPrototypes: 1,
  minReviewers: 1,
  signals: Object.freeze([
    "visual_quality",
    "accessibility",
    "usability",
    "content",
    "interaction",
    "design_system",
    "scenario",
    "performance",
  ]),
  observations: Object.freeze(["observed", "preference", "question", "praise"]),
})

const SIGNALS = [
  "visual_quality",
  "accessibility",
  "usability",
  "content",
  "interaction",
  "design_system",
  "scenario",
  "performance",
  "agreement",
  "replica_workflow",
  "other",
]
const OBSERVATIONS = ["observed", "preference", "question", "praise", "other"]

/**
 * Proposes a learning for each labeled theme that recurs across distinct threads, prototypes,
 * and reviewers within the window. It is deterministic: the same evidence and labels always
 * give the same proposals. Review comments and a person's messages to an agent count the same
 * way; each agent session counts as one thread but no prototype or Build. A theme seen only in
 * sessions needs no prototypes.
 *
 * By default two threads are enough, even from one reviewer on one prototype, so a person
 * working alone still gets learnings. Raise the thresholds for a larger team.
 *
 * It reads annotation events, not raw text. A labeler, a person or a model, writes those with
 * a theme key, a prototype-independent statement, a signal, an observation kind, and a stance.
 * Problems, preferences, questions, and praise all count by default: taste and brand choices
 * are worth teaching agents, a repeated question shows what confuses people, and repeated
 * praise shows what to keep doing. A theme is contested, and not
 * proposed, when as many reviewers contradict it as support it. Themes with an accepted
 * learning still in effect are skipped; an accepted learning that no longer applies, because
 * its evidence was withdrawn or it expired, is offered for replacement. Rejected themes
 * return only with more support than before.
 *
 * @param {Partial<typeof DEFAULT_RECURRENCE_OPTIONS>} [options]
 */
export function createRecurrenceConsolidator(options = {}) {
  const settings = { ...DEFAULT_RECURRENCE_OPTIONS, ...options }
  for (const key of ["minEpisodes", "minPrototypes", "minReviewers"])
    if (!Number.isSafeInteger(settings[key]) || settings[key] < 1)
      throw new LearningError("invalid_input", `${key} must be a positive whole number.`)
  if (!settings.signals.length || settings.signals.some((signal) => !SIGNALS.includes(signal)))
    throw new LearningError("invalid_input", `signals must come from ${SIGNALS.join(", ")}.`)
  if (
    !settings.observations.length ||
    settings.observations.some((kind) => !OBSERVATIONS.includes(kind))
  )
    throw new LearningError(
      "invalid_input",
      `observations must come from ${OBSERVATIONS.join(", ")}.`,
    )

  return {
    manifest: {
      id: "recurrence",
      version: PRODUCER.version,
      description:
        "Proposes labeled themes that recur across distinct threads, prototypes, and reviewers.",
      settings: structuredClone(settings),
    },

    async consolidate({ window }, view) {
      const episodes = new Map(view.episodes.map((episode) => [episode.id, episode]))
      const events = new Map(view.events.map((event) => [event.id, event]))
      const latestComments = new Map()
      for (const event of view.events) {
        if (feedbackText(event) === null) continue
        const key = commentIdentity(event, episodes)
        const latest = latestComments.get(key)
        if (!latest || event.at > latest) latestComments.set(key, event.at)
      }
      const superseded = new Set(
        view.events.filter((event) => event.supersedes).map((event) => event.supersedes),
      )
      const supersededComments = new Set(
        [...superseded]
          .map((id) => events.get(id))
          .filter((event) => FEEDBACK_TYPES.includes(event?.type))
          .map((event) => `${commentKey(event, episodes)}\u0000${event.actor.id}`),
      )
      const latestLabels = new Map()
      for (const event of view.events) {
        if (event.type !== "annotation" || superseded.has(event.id)) continue
        const target = events.get(event.payload.target.eventId)
        if (!target) continue
        const key = `${commentKey(target, episodes)}\u0000${event.actor.id}`
        const previous = latestLabels.get(key)
        if (previous?.payload.target.eventId === event.payload.target.eventId) {
          latestLabels.set(key, event)
          continue
        }
        if (previous && previous.at === event.at) {
          const payload = without(event.payload, "target")
          const previousPayload = without(previous.payload, "target")
          if (canonicalJson(payload) !== canonicalJson(previousPayload))
            throw new LearningError(
              "conflict",
              "The same labeler recorded conflicting labels at the same time.",
            )
        }
        if (!previous || compare(`${previous.at} ${previous.id}`, `${event.at} ${event.id}`) < 0)
          latestLabels.set(key, event)
      }

      const diagnostics = []
      const themes = new Map()
      let edited = 0
      for (const label of latestLabels.values()) {
        const target = events.get(label.payload.target.eventId)
        if (feedbackText(target) === null) continue
        if (
          superseded.has(target.id) ||
          target.at < latestComments.get(commentIdentity(target, episodes)) ||
          supersededComments.has(`${commentKey(target, episodes)}\u0000${target.actor.id}`)
        ) {
          edited++
          continue
        }
        if (target.at < window.from || target.at >= window.to) continue
        const key = label.payload.theme.key
        if (!themes.has(key)) themes.set(key, { key, supports: new Map(), contradicts: new Map() })
        const bucket =
          themes.get(key)[label.payload.stance === "contradicts" ? "contradicts" : "supports"]
        const comment = commentKey(target, episodes)
        if (!bucket.has(comment)) bucket.set(comment, { target, labels: [] })
        bucket.get(comment).labels.push(label)
      }
      if (edited)
        diagnostics.push({
          code: "target_edited",
          message: `${edited} label(s) point at comments edited since labeling. Label the new versions to count them.`,
        })

      const proposals = []
      for (const theme of [...themes.values()].sort((left, right) =>
        compare(left.key, right.key),
      )) {
        const supporting = [...theme.supports.values()].filter(({ labels }) =>
          labels.some((label) => settings.observations.includes(label.payload.observation)),
        )
        if (!supporting.length) {
          diagnostics.push({
            code: "not_observed",
            themeKey: theme.key,
            message: "No label has an enabled observation kind.",
          })
          continue
        }
        const labels = supporting.flatMap((item) => item.labels)
        const signal = mostCommon(labels.map((label) => label.payload.signal))
        if (!settings.signals.includes(signal)) {
          diagnostics.push({
            code: "signal_not_enabled",
            themeKey: theme.key,
            message: `Signal ${signal} is not enabled.`,
          })
          continue
        }
        const support = supportOf(
          supporting.map((item) => item.target),
          episodes,
        )
        // Agent sessions name no prototype, so a theme seen only in sessions skips that check.
        const short = [
          ["threads", support.distinctEpisodes, settings.minEpisodes],
          ...(support.distinctPrototypes
            ? [["prototypes", support.distinctPrototypes, settings.minPrototypes]]
            : []),
          ["reviewers", support.distinctReviewers, settings.minReviewers],
        ].filter(([, have, need]) => have < need)
        if (short.length) {
          diagnostics.push({
            code: "below_threshold",
            themeKey: theme.key,
            message: `Needs ${short.map(([name, have, need]) => `${need} ${name} (has ${have})`).join(", ")}.`,
            support,
          })
          continue
        }
        const dissent = new Set(
          [...theme.contradicts.values()].map(({ target }) => target.actor.id),
        )
        if (dissent.size >= support.distinctReviewers) {
          diagnostics.push({
            code: "contested",
            themeKey: theme.key,
            message: `${dissent.size} reviewer(s) disagree and ${support.distinctReviewers} agree.`,
          })
          continue
        }
        const prior = view.memories.filter((memory) => memory.themeKey === theme.key)
        const current = prior.find((memory) => memory.state === "accepted" && memory.effective)
        if (current) {
          diagnostics.push({
            code: "already_accepted",
            themeKey: theme.key,
            message: `Already accepted as ${current.id}.`,
          })
          continue
        }
        const stale = prior
          .filter((memory) => memory.state === "accepted" && !memory.superseded)
          .map((memory) => memory.id)
          .sort()
        if (stale.length)
          diagnostics.push({
            code: "replaces_stale",
            themeKey: theme.key,
            message: `${stale.join(", ")} no longer applies; accepting this proposal replaces it.`,
          })
        const rejected = prior.filter((memory) => memory.state === "rejected")
        if (
          rejected.some(
            (memory) => (memory.support?.distinctEpisodes ?? 0) >= support.distinctEpisodes,
          )
        ) {
          diagnostics.push({
            code: "previously_rejected",
            themeKey: theme.key,
            message: "Rejected before, with no new support.",
          })
          continue
        }
        const statements = labels.map((label) => label.payload.theme.statement)
        const statement = mostCommon(statements)
        const alternatives = [...new Set(statements)].filter((item) => item !== statement)
        if (alternatives.length)
          diagnostics.push({
            code: "alternative_wording",
            themeKey: theme.key,
            message: `Other wordings: ${alternatives.map((item) => JSON.stringify(item)).join("; ")}`,
          })
        const traces = new Map()
        for (const label of labels)
          if (label.payload.trace)
            traces.set(
              `${label.payload.trace.kind}\u0000${label.payload.trace.ref}`,
              label.payload.trace,
            )
        const contradictions = [...theme.contradicts.values()].map(({ target }) =>
          evidence(target, episodes),
        )
        proposals.push({
          schemaVersion: SCHEMA_VERSIONS.memoryProposal,
          kind: mostCommon(labels.map((label) => label.payload.proposedKind ?? "rule")),
          title: sentenceCase(theme.key.replaceAll("-", " ")).slice(0, 120),
          content: statement,
          themeKey: theme.key,
          ...(traces.size
            ? {
                appliesTo: [...traces.values()]
                  .sort((a, b) => compare(`${a.kind} ${a.ref}`, `${b.kind} ${b.ref}`))
                  .slice(0, 20),
              }
            : {}),
          evidence: supporting
            .map(({ target }) => evidence(target, episodes))
            .sort(
              (a, b) => compare(a.episodeId, b.episodeId) || compare(a.eventIds[0], b.eventIds[0]),
            ),
          ...(contradictions.length ? { contradictions } : {}),
          support,
          rationale: {
            recurrence: `Reported in ${support.distinctEpisodes} threads on ${support.distinctPrototypes} prototypes by ${support.distinctReviewers} reviewers, across ${support.distinctBuilds} Builds.`,
            ...(dissent.size
              ? { contradictions: `${dissent.size} reviewer(s) disagreed; see contradictions.` }
              : {}),
            expectedBenefit: `Prototypes built with this learning should stop drawing comments about ${theme.key}.`,
            falsification: `Revisit it if new Builds that follow it still draw comments about ${theme.key}, or if reviewers push back on it.`,
          },
          lifecycle: stale.length ? { action: "supersede", targets: stale } : { action: "new" },
          consolidator: { id: "recurrence", version: PRODUCER.version },
        })
      }
      proposals.sort(
        (a, b) =>
          b.support.distinctPrototypes - a.support.distinctPrototypes ||
          b.support.distinctReviewers - a.support.distinctReviewers ||
          b.support.distinctEpisodes - a.support.distinctEpisodes ||
          compare(a.themeKey, b.themeKey),
      )
      return { proposals, diagnostics }
    },
  }
}

function supportOf(targets, episodes) {
  const episodeIds = new Set()
  const prototypes = new Set()
  const reviewers = new Set()
  const builds = new Set()
  for (const target of targets) {
    const source = episodes.get(target.episodeId)?.source ?? {}
    episodeIds.add(threadKey(episodes.get(target.episodeId)) ?? target.episodeId)
    reviewers.add(target.actor.id)
    // A session is not a prototype or a Build, so it adds a thread but neither of those.
    if (source.prototypeId === undefined) continue
    prototypes.add(`${source.hubOrigin}#${source.prototypeId}`)
    builds.add(`${source.hubOrigin}#${source.prototypeId}#${source.buildNumber}`)
  }
  return {
    distinctEpisodes: episodeIds.size,
    distinctPrototypes: prototypes.size,
    distinctReviewers: reviewers.size,
    distinctBuilds: builds.size,
  }
}

function threadKey(episode) {
  const source = episode?.source
  if (
    source?.kind !== "hub_review_comments" ||
    [source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId].some(
      (value) => value === undefined,
    )
  )
    return null
  return canonicalJson([source.hubOrigin, source.repositoryId, source.prototypeId, source.threadId])
}

function commentKey(target, episodes) {
  const identity = commentIdentity(target, episodes)
  return identity === target.id ? identity : canonicalJson([identity, target.at])
}

function commentIdentity(target, episodes) {
  const thread = threadKey(episodes.get(target.episodeId))
  const commentId = target.payload?.commentId
  return thread && commentId !== undefined ? canonicalJson([thread, commentId]) : target.id
}

function evidence(target, episodes) {
  const source = episodes.get(target.episodeId)?.source
  const pin = {}
  if (source)
    for (const key of [
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
    ])
      if (source[key] !== undefined) pin[key] = source[key]
  if (target.payload?.commentId) pin.commentId = target.payload.commentId
  return {
    episodeId: target.episodeId,
    eventIds: [target.id],
    ...(pin.kind ? { source: pin } : {}),
    observedAt: target.at,
    author: { kind: target.actor.kind, id: target.actor.id },
  }
}

function mostCommon(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0][0]
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Capitalizes the first letter so titles read like normal sentences. */
function sentenceCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
