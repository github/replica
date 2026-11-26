import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import type { ReviewCommentLearningSource } from "../review-comment-learning-source/types.ts"
import type { AcceptedLearning, LearningSuggestion, RejectedLearning } from "../types.ts"

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
const decisionSchema = z
  .object({
    at: z.string().optional(),
    reason: z.string().optional(),
    by: z.object({ id: z.string().optional() }).loose().optional(),
  })
  .loose()
  .optional()
const memorySchema = z
  .object({
    withheld: z.boolean(),
    record: z
      .object({
        id: z.string().min(1),
        state: z.enum(["proposed", "accepted", "rejected", "retired"]),
        title: z.string().optional(),
        content: z.string().optional(),
        digest: z.string().optional(),
        reviewDigest: z.string().optional(),
        evidence: z.array(referenceSchema).optional(),
        contradictions: z.array(referenceSchema).optional(),
        support: z
          .object({
            distinctReviewers: z.number().int().nonnegative(),
            distinctPrototypes: z.number().int().nonnegative(),
          })
          .loose()
          .optional(),
        proposal: z
          .object({
            lifecycle: z
              .object({ targets: z.array(z.string()).optional() })
              .loose()
              .optional(),
          })
          .loose()
          .optional(),
        accepted: z
          .object({
            at: z.string().optional(),
            edited: z.boolean().optional(),
            decision: z.string().optional(),
            by: z.object({ id: z.string().optional() }).loose().optional(),
          })
          .loose()
          .optional(),
        rejected: decisionSchema,
        retired: decisionSchema,
      })
      .loose(),
    status: z
      .object({
        recallEligible: z.boolean(),
        identityNeedsReview: z.boolean().optional(),
        superseded: z.boolean().optional(),
        problems: z.array(z.string()),
        conflicts: z.array(z.string()),
      })
      .loose(),
  })
  .loose()
const recallSchema = z
  .object({
    text: z.string(),
    memories: z.array(z.object({ id: z.string() }).loose()),
  })
  .loose()
const statusSchema = z
  .object({
    migrationRedactionFollowUps: z
      .object({
        memoriesNeedingRebuild: z.array(z.string().min(1)),
        exportsToFollowUp: z.array(
          z.object({ id: z.string().min(1), destination: z.string().min(1) }).loose(),
        ),
      })
      .optional(),
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
          payload: z
            .object({
              commentId: z.number().int().positive(),
              body: z.string().nullable(),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose()

function login(identity: string | undefined) {
  return identity?.replace(/^(?:github|human):/, "") || null
}

export async function getLearningOverview(input: {
  applicationRoot?: string
  cliPath: string
  evidenceSource?: Pick<ReviewCommentLearningSource, "resolveEvidence">
  learningDatabaseUrl?: string
  nodePath: string
  repositoryId: string
  repositoryScope: string
  root: string
  staticDirectories: string[]
  viewer: string
}) {
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
      return {
        loadError: null,
        identityReviewCount: 0,
        suggestions: [],
        learnings: [],
        rejected: [],
        recall: { text: "", count: 0 },
      }
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
  const rawMemories = await runLearningCommand(["memories", ...commonArguments], commandOptions)
  const rawStatus = await runLearningCommand(["status", ...commonArguments], commandOptions)
  const rawRecall = await runLearningCommand(
    ["recall", "--preview", "--by", input.viewer, ...commonArguments],
    commandOptions,
  )
  const memories = z.array(memorySchema).parse(rawMemories)
  const followUps = statusSchema.parse(rawStatus).migrationRedactionFollowUps
  const recall = recallSchema.parse(rawRecall)
  const recalledIds = new Set(recall.memories.map((memory) => memory.id))
  const records = new Map(memories.map((item) => [item.record.id, item]))
  const proposed = memories.filter(
    (item) =>
      item.record.state === "proposed" &&
      !item.withheld &&
      !item.status.identityNeedsReview &&
      item.status.problems.length === 0 &&
      item.status.conflicts.length === 0,
  )
  let loadError: string | null = null
  if (followUps) {
    loadError =
      [
        ...followUps.memoriesNeedingRebuild.map(
          (id) => `Rebuild learning ${id} because its evidence was removed.`,
        ),
        ...followUps.exportsToFollowUp.map(
          (item) =>
            `Follow up on export ${item.id} at ${item.destination}; it may contain removed text.`,
        ),
      ].join(" ") || null
  }
  const suggestions: LearningSuggestion[] = []
  if (proposed.length > 0 && !input.evidenceSource) {
    loadError = [
      loadError,
      "Review comment evidence is not available yet, so Hub withheld learning suggestions.",
    ]
      .filter(Boolean)
      .join(" ")
  } else if (input.evidenceSource) {
    const prepared = proposed.map((item) => {
      if (!item.record.content || !item.record.reviewDigest) {
        throw new LearningCommandError(
          "unreadable_output",
          "replica-learning returned output Hub could not read.",
        )
      }
      const evidenceReferences = item.record.evidence ?? []
      const contradictionReferences = item.record.contradictions ?? []
      return {
        item,
        content: item.record.content,
        reviewDigest: item.record.reviewDigest,
        evidenceReferences,
        contradictionReferences,
        references: [...evidenceReferences, ...contradictionReferences],
      }
    })
    const references = prepared.flatMap((entry) => entry.references)
    // Stored IDs come from model-influenced records, so skip any that could read as an
    // option or split into another argument.
    const eventIds = [...new Set(references.flatMap((reference) => reference.eventIds))].filter(
      (eventId) => /^[^\s-][^\s]*$/u.test(eventId),
    )
    const events = []
    for (let index = 0; index < eventIds.length; index += 100) {
      const batch = eventIds.slice(index, index + 100)
      const result = observationsSchema.parse(
        await runLearningCommand(
          [
            "observations",
            "--purpose",
            "review",
            ...batch.flatMap((eventId) => ["--event", eventId]),
            ...commonArguments,
          ],
          commandOptions,
        ),
      )
      events.push(...result.events)
    }
    const resolved =
      references.length === 0
        ? []
        : await input.evidenceSource.resolveEvidence({
            repositoryId: input.repositoryId,
            references,
            events,
          })
    const byIndex = new Map(resolved.map((entry) => [entry.referenceIndex, entry.evidence]))
    let referenceOffset = 0
    for (const {
      item,
      content,
      reviewDigest,
      evidenceReferences,
      contradictionReferences,
      references: itemReferences,
    } of prepared) {
      const evidence = evidenceReferences.flatMap(
        (_, index) => byIndex.get(referenceOffset + index) ?? [],
      )
      const contradictions = contradictionReferences.flatMap(
        (_, index) => byIndex.get(referenceOffset + evidenceReferences.length + index) ?? [],
      )
      suggestions.push({
        id: item.record.id,
        title: item.record.title ?? null,
        content,
        reviewDigest,
        support: item.record.support
          ? {
              reviewers: item.record.support.distinctReviewers,
              prototypes: item.record.support.distinctPrototypes,
            }
          : null,
        replaces: (item.record.proposal?.lifecycle?.targets ?? []).map((id) => ({
          id,
          content: records.get(id)?.withheld ? null : (records.get(id)?.record.content ?? null),
        })),
        evidence,
        otherEvidenceCount: evidenceReferences.filter(
          (_, index) => (byIndex.get(referenceOffset + index) ?? []).length === 0,
        ).length,
        contradictions,
        otherContradictionsCount: contradictionReferences.filter(
          (_, index) =>
            (byIndex.get(referenceOffset + evidenceReferences.length + index) ?? []).length === 0,
        ).length,
      })
      referenceOffset += itemReferences.length
    }
  }
  const learnings: AcceptedLearning[] = memories
    .filter((item) => item.record.state === "accepted")
    .map((item) => ({
      id: item.record.id,
      title: item.withheld ? null : (item.record.title ?? null),
      content: item.withheld ? null : (item.record.content ?? null),
      digest: item.record.digest ?? null,
      acceptedBy: login(item.record.accepted?.by?.id),
      acceptedAt: item.record.accepted?.at ?? null,
      edited: item.record.accepted?.edited === true,
      lastDecision:
        item.record.accepted?.decision === "edit"
          ? "edited"
          : item.record.accepted?.decision === "reinstate"
            ? "reinstated"
            : "accepted",
      status:
        item.status.problems.length > 0
          ? "damaged"
          : item.status.identityNeedsReview && !item.status.superseded
            ? "identity-review"
            : recalledIds.has(item.record.id)
              ? "recalled"
              : item.status.recallEligible
                ? "budget-excluded"
                : "not-recalled",
    }))
  const rejected: RejectedLearning[] = memories.flatMap((item) => {
    const { state } = item.record
    if (state !== "rejected" && state !== "retired") return []
    const decision = state === "rejected" ? item.record.rejected : item.record.retired
    return [
      {
        id: item.record.id,
        title: item.withheld ? null : (item.record.title ?? null),
        content: item.withheld ? null : (item.record.content ?? null),
        digest: item.record.digest ?? null,
        state,
        decidedBy: login(decision?.by?.id),
        decidedAt: decision?.at ?? null,
        reason: item.withheld ? null : (decision?.reason ?? null),
      },
    ]
  })
  return {
    loadError,
    identityReviewCount: memories.filter(
      (item) =>
        (item.record.state === "proposed" || item.record.state === "accepted") &&
        item.status.identityNeedsReview &&
        !item.status.superseded,
    ).length,
    suggestions,
    learnings,
    rejected,
    recall: { text: recall.text, count: recall.memories.length },
  }
}
