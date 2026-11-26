import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import type {
  LearningEvidenceReference,
  ReviewCommentLearningSource,
} from "../review-comment-learning-source/types.ts"
import type {
  EarlierLearningGuidance,
  LearningDecisionRecord,
  LearningEvidence,
  LearningUpdateSuggestion,
  ReportedLearningOutcome,
} from "../types.ts"

const decisionSchema = z
  .object({
    at: z.string().optional(),
    reason: z.string().optional(),
    note: z.string().optional(),
    decision: z.string().optional(),
    reviewedDigest: z.string().optional(),
    by: z.object({ id: z.string().optional() }).loose().optional(),
  })
  .loose()
  .optional()
const referenceSchema = z
  .object({
    episodeId: z.string().min(1),
    eventIds: z.array(z.string().min(1)),
    source: z
      .object({
        kind: z.string().optional(),
        hubOrigin: z.string().optional(),
        repositoryId: z.string().optional(),
        prototypeId: z.string().optional(),
        threadId: z.number().int().positive().optional(),
        commentId: z.number().int().positive().optional(),
      })
      .loose(),
  })
  .loose()
const versionSchema = z
  .object({
    // A damaged version comes back as withheld metadata that may lack these fields.
    version: z.number().int().positive().optional().catch(undefined),
    state: z.enum(["proposed", "accepted", "rejected", "retired"]).optional().catch(undefined),
    digest: z.string().optional().catch(undefined),
    contentDigest: z.string().optional().catch(undefined),
    withheld: z.literal(true).optional(),
    title: z.string().optional().catch(undefined),
    content: z.string().optional().catch(undefined),
    updatedAt: z.string().optional(),
    proposal: z
      .object({
        proposedAt: z.string().optional(),
        proposedBy: z.object({ id: z.string().optional() }).loose().optional(),
      })
      .loose()
      .optional(),
    accepted: decisionSchema,
    rejected: decisionSchema,
    retired: decisionSchema,
  })
  .loose()
const showSchema = z
  .object({
    withheld: z.boolean(),
    record: z
      .object({
        evidence: z.array(referenceSchema).optional(),
        contradictions: z.array(referenceSchema).optional(),
      })
      .loose(),
    versions: z.array(versionSchema).optional(),
  })
  .loose()
const screenshotSchema = z
  .object({
    sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    route: z.string(),
    consentGrantId: z.string().optional(),
  })
  .loose()
const outcomesSchema = z
  .object({
    outcomes: z.array(
      z
        .object({
          id: z.string().min(1),
          usedLearningId: z.string().min(1),
          version: z.number().int().positive(),
          inputs: z.array(z.string()),
          commitSha: z.string().regex(/^[0-9a-f]{40}$/),
          prototypeId: z.string().optional(),
          efficiency: z.number().int().min(1).max(4),
          followed: z.enum(["followed", "not_followed", "unclear"]),
          reasoning: z.string(),
          issue: z.string().optional(),
          scoredAt: z.string().min(1),
          before: screenshotSchema.optional(),
          after: screenshotSchema.optional(),
        })
        .loose(),
    ),
  })
  .loose()
const observationsSchema = z
  .object({
    events: z.array(
      z
        .object({
          id: z.string().min(1),
          episodeId: z.string().min(1),
          at: z.string().min(1),
          // Evidence may cite other event kinds, such as annotations without a comment.
          payload: z
            .object({
              commentId: z.number().int().positive().optional().catch(undefined),
              body: z.string().nullable().optional().catch(undefined),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose()

const updatesSchema = z
  .object({
    updates: z.array(
      z
        .object({
          id: z.string().min(1),
          state: z.string(),
          // The package leaves out wording whose scores may no longer be read.
          issue: z.string().optional(),
          title: z.string().optional(),
          content: z.string().optional(),
          reasoning: z.string().optional(),
          support: z.array(z.string()),
        })
        .loose(),
    ),
  })
  .loose()

function login(identity: string | undefined) {
  return identity?.replace(/^(?:github|human):/, "") || null
}

/**
 * Turns stored versions into the decisions people made. The package copies the last
 * receipt forward on later versions, so an edit counts only on the version it reviewed.
 * Versions that are too damaged to place are skipped.
 */
function decisions(versions: z.infer<typeof versionSchema>[]) {
  const result: LearningDecisionRecord[] = []
  let previous: string | null = null
  let previousDigest: string | undefined
  for (const version of versions) {
    const accepted = version.accepted
    const state = version.state
    if (version.version !== undefined && state !== undefined) {
      if (state === "proposed" && previous === null) {
        result.push({
          version: version.version,
          state,
          change: "proposed",
          by: login(version.proposal?.proposedBy?.id),
          at: version.proposal?.proposedAt ?? version.updatedAt ?? null,
          reason: null,
        })
      } else if (state === "accepted") {
        // The package only moves rejected or retired learnings back by reinstating them.
        const change =
          previous === "rejected" || previous === "retired"
            ? "reinstated"
            : previous !== "accepted"
              ? "accepted"
              : accepted?.decision === "edit" &&
                  previousDigest !== undefined &&
                  accepted.reviewedDigest === previousDigest
                ? "edited"
                : null
        if (change) {
          result.push({
            version: version.version,
            state,
            change,
            by: login(accepted?.by?.id),
            at: accepted?.at ?? version.updatedAt ?? null,
            reason: version.withheld ? null : (accepted?.note ?? null),
          })
        }
      } else if ((state === "rejected" || state === "retired") && previous !== state) {
        const decision = state === "rejected" ? version.rejected : version.retired
        result.push({
          version: version.version,
          state,
          change: state,
          by: login(decision?.by?.id),
          at: decision?.at ?? version.updatedAt ?? null,
          reason: version.withheld ? null : (decision?.reason ?? null),
        })
      }
    }
    previous = state ?? "unknown"
    previousDigest = version.digest
  }
  return result
}

/**
 * Counts cited events the page cannot show, so a partly shown reference still tells
 * people that more comments exist.
 */
function missingEventCount(references: LearningEvidenceReference[], shown: LearningEvidence[]) {
  const shownIds = new Set(shown.map((entry) => entry.eventId))
  const cited = new Set(references.flatMap((reference) => reference.eventIds))
  return [...cited].filter((eventId) => !shownIds.has(eventId)).length
}

/**
 * Reads one learning's decisions and supporting comments for its detail page. Hub reads
 * full history only here, so listing the library stays cheap.
 */
export async function getLearningHistory(input: {
  applicationRoot?: string
  cliPath: string
  evidenceSource?: Pick<ReviewCommentLearningSource, "resolveEvidence">
  learningDatabaseUrl?: string
  learningId: string
  nodePath: string
  repositoryId: string
  repositoryScope: string
  root: string
  staticDirectories: string[]
}): Promise<{
  decisions: LearningDecisionRecord[]
  evidence: LearningEvidence[]
  otherEvidenceCount: number
  contradictions: LearningEvidence[]
  otherContradictionsCount: number
  outcomes: ReportedLearningOutcome[]
  earlierGuidance: EarlierLearningGuidance<ReportedLearningOutcome>[]
  updates: LearningUpdateSuggestion<ReportedLearningOutcome>[]
}> {
  // The ID is passed to the package as an argument, so it must never read as an option.
  if (input.learningId.startsWith("-")) {
    throw new LearningCommandError("not_found", "That learning no longer exists.")
  }
  const applicationRoot = input.applicationRoot ?? process.cwd()
  const directory = await validatePrivateStorageRoot(
    resolve(input.root, "repositories", input.repositoryId),
    {
      applicationRoot,
      excludedDirectories: input.staticDirectories,
      name: "REPLICA_LEARNING_ROOT",
      publicRoot: resolve(applicationRoot, "public"),
    },
  )
  if (!input.learningDatabaseUrl) {
    try {
      await access(resolve(directory, "config.json"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      throw new LearningCommandError("not_found", "That learning no longer exists.")
    }
  }
  const commandOptions = {
    cliPath: input.cliPath,
    nodePath: input.nodePath,
    ...(input.learningDatabaseUrl ? { learningDatabaseUrl: input.learningDatabaseUrl } : {}),
  }
  const commonArguments = learningStoreArguments({
    directory,
    repositoryId: input.repositoryId,
    repositoryScope: input.repositoryScope,
  })
  const shown = showSchema.parse(
    await runLearningCommand(
      ["show", input.learningId, "--history", ...commonArguments],
      commandOptions,
    ),
  )
  const history = decisions(shown.versions ?? [])
  const versions = shown.versions ?? []
  const scored = shown.withheld
    ? []
    : outcomesSchema.parse(
        await runLearningCommand(
          ["outcomes", input.learningId, ...commonArguments],
          commandOptions,
        ),
      ).outcomes
  const wording = versions.at(-1)?.contentDigest
  const outcomes = wording ? outcomesOf(scored, versions, wording) : []
  const earlierGuidance = shown.withheld || !wording ? [] : earlier(scored, versions, wording)
  // Only an accepted learning can take new wording, so other states never show one.
  const updates =
    shown.withheld || versions.at(-1)?.state !== "accepted"
      ? []
      : updatesSchema
          .parse(
            await runLearningCommand(
              ["updates", input.learningId, ...commonArguments],
              commandOptions,
            ),
          )
          .updates.flatMap((update) => {
            // Hub checks each supporting score before showing the wording, so a score
            // it cannot read leaves the suggestion unchecked and hidden.
            const support = update.support.map((id) => scored.find((score) => score.id === id))
            return update.state === "open" &&
              update.issue !== undefined &&
              update.content !== undefined &&
              update.reasoning !== undefined &&
              support.every((score) => score !== undefined)
              ? [
                  {
                    id: update.id,
                    issue: update.issue,
                    title: update.title ?? null,
                    content: update.content,
                    reasoning: update.reasoning,
                    support: support.map(reported),
                  },
                ]
              : []
          })
  const supporting = shown.withheld ? [] : (shown.record.evidence ?? [])
  const opposing = shown.withheld ? [] : (shown.record.contradictions ?? [])
  const references = [...supporting, ...opposing]
  if (references.length === 0 || !input.evidenceSource) {
    return {
      decisions: history,
      evidence: [],
      otherEvidenceCount: missingEventCount(supporting, []),
      contradictions: [],
      otherContradictionsCount: missingEventCount(opposing, []),
      outcomes,
      earlierGuidance,
      updates,
    }
  }
  // The package reads at most 100 events at once, so a detail page shows the first 100.
  // Stored IDs come from model-influenced records, so skip any that could read as an
  // option or split into another argument.
  const eventIds = [...new Set(references.flatMap((reference) => reference.eventIds))]
    .filter((eventId) => /^[^\s-][^\s]*$/u.test(eventId))
    .slice(0, 100)
  const { events } = observationsSchema.parse(
    await runLearningCommand(
      [
        "observations",
        "--purpose",
        "review",
        ...eventIds.flatMap((eventId) => ["--event", eventId]),
        ...commonArguments,
      ],
      commandOptions,
    ),
  )
  const commentEvents = events.flatMap((event) =>
    event.payload.commentId === undefined
      ? []
      : [
          {
            id: event.id,
            episodeId: event.episodeId,
            at: event.at,
            payload: { commentId: event.payload.commentId, body: event.payload.body ?? null },
          },
        ],
  )
  const resolved = await input.evidenceSource.resolveEvidence({
    repositoryId: input.repositoryId,
    references,
    events: commentEvents,
  })
  const evidence = resolved
    .filter((entry) => entry.referenceIndex < supporting.length)
    .flatMap((entry) => entry.evidence)
  const contradictions = resolved
    .filter((entry) => entry.referenceIndex >= supporting.length)
    .flatMap((entry) => entry.evidence)
  return {
    decisions: history,
    evidence,
    otherEvidenceCount: missingEventCount(supporting, evidence),
    contradictions,
    otherContradictionsCount: missingEventCount(opposing, contradictions),
    outcomes,
    earlierGuidance,
    updates,
  }
}

// Each wording agents were given before the current one, newest first, so people can
// compare how older guidance was scored with the guidance agents get now.
function earlier(
  outcomes: z.infer<typeof outcomesSchema>["outcomes"],
  versions: z.infer<typeof versionSchema>[],
  current: string,
): EarlierLearningGuidance<ReportedLearningOutcome>[] {
  const latest = new Map<string, z.infer<typeof versionSchema>>()
  for (const version of versions) {
    // Proposed wording that was changed before approval never reached agents.
    if (
      version.state === "accepted" &&
      version.contentDigest &&
      version.contentDigest !== current
    ) {
      // Moving a repeated wording to the end keeps the list ordered by its last use.
      latest.delete(version.contentDigest)
      latest.set(version.contentDigest, version)
    }
  }
  return [...latest.entries()].reverse().flatMap(([wording, version]) =>
    version.version === undefined || version.withheld || version.content === undefined
      ? []
      : [
          {
            version: version.version,
            title: version.title ?? null,
            content: version.content,
            outcomes: outcomesOf(outcomes, versions, wording),
          },
        ],
  )
}

// Scores of other wording say nothing about this guidance. Retiring and reinstating add
// versions with the same wording, so match the wording, not the number.
function outcomesOf(
  outcomes: z.infer<typeof outcomesSchema>["outcomes"],
  versions: z.infer<typeof versionSchema>[],
  wording: string,
): ReportedLearningOutcome[] {
  const current = new Set(
    versions.filter((entry) => entry.contentDigest === wording).map((entry) => entry.version),
  )
  const matching = outcomes.filter((outcome) => current.has(outcome.version))
  // A reviewer's confirmation scores the same use again. The newer score replaces the
  // earlier one so the use isn't counted twice.
  const last = new Map(matching.map((outcome, index) => [outcome.usedLearningId, index]))
  return matching
    .filter((outcome, index) => last.get(outcome.usedLearningId) === index)
    .map(reported)
}

function reported(
  outcome: z.infer<typeof outcomesSchema>["outcomes"][number],
): ReportedLearningOutcome {
  return {
    id: outcome.id,
    source: outcome.inputs.includes("reviewer_verification") ? "reviewer_confirmed" : "automated",
    commitSha: outcome.commitSha,
    prototypeId: outcome.prototypeId ?? null,
    efficiency: outcome.efficiency,
    followed: outcome.followed,
    reasoning: outcome.reasoning,
    issue: outcome.issue ?? null,
    scoredAt: outcome.scoredAt,
    ...(outcome.before ? { before: screenshot(outcome.before) } : {}),
    ...(outcome.after ? { after: screenshot(outcome.after) } : {}),
  }
}

function screenshot(value: z.infer<typeof screenshotSchema>) {
  return {
    sha256: value.sha256.slice("sha256:".length),
    route: value.route,
    ...(value.consentGrantId ? { consentGrantId: value.consentGrantId } : {}),
  }
}
