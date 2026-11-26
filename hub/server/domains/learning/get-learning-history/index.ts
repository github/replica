import { access } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import type { ReviewCommentLearningSource } from "../review-comment-learning-source/types.ts"
import type { LearningDecisionRecord, LearningEvidence } from "../types.ts"

const decisionSchema = z
  .object({
    at: z.string().optional(),
    reason: z.string().optional(),
    note: z.string().optional(),
    decision: z.string().optional(),
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
    version: z.number().int().positive(),
    state: z.enum(["proposed", "accepted", "rejected", "retired"]),
    withheld: z.literal(true).optional(),
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
    record: z.object({ evidence: z.array(referenceSchema).optional() }).loose(),
    versions: z.array(versionSchema).optional(),
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
            .object({ commentId: z.number().int().positive(), body: z.string().nullable() })
            .loose(),
        })
        .loose(),
    ),
  })
  .loose()

function login(identity: string | undefined) {
  return identity?.replace(/^(?:github|human):/, "") || null
}

/**
 * Turns stored versions into the decisions people made. An accepted version that
 * follows another accepted version is still a decision when it records an edit.
 */
function decisions(versions: z.infer<typeof versionSchema>[]) {
  const result: LearningDecisionRecord[] = []
  let previous: string | null = null
  for (const version of versions) {
    const accepted = version.accepted
    if (version.state === "proposed" && previous === null) {
      result.push({
        version: version.version,
        state: "proposed",
        change: "proposed",
        by: login(version.proposal?.proposedBy?.id),
        at: version.proposal?.proposedAt ?? version.updatedAt ?? null,
        reason: null,
      })
    } else if (
      version.state === "accepted" &&
      (previous !== "accepted" || accepted?.decision === "edit")
    ) {
      result.push({
        version: version.version,
        state: "accepted",
        change:
          accepted?.decision === "edit"
            ? "edited"
            : accepted?.decision === "reinstate"
              ? "reinstated"
              : "accepted",
        by: login(accepted?.by?.id),
        at: accepted?.at ?? version.updatedAt ?? null,
        reason: version.withheld ? null : (accepted?.note ?? null),
      })
    } else if (
      (version.state === "rejected" || version.state === "retired") &&
      previous !== version.state
    ) {
      const decision = version.state === "rejected" ? version.rejected : version.retired
      result.push({
        version: version.version,
        state: version.state,
        change: version.state,
        by: login(decision?.by?.id),
        at: decision?.at ?? version.updatedAt ?? null,
        reason: version.withheld ? null : (decision?.reason ?? null),
      })
    }
    previous = version.state
  }
  return result
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
}> {
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
  const references = shown.withheld ? [] : (shown.record.evidence ?? [])
  if (references.length === 0 || !input.evidenceSource) {
    return { decisions: history, evidence: [], otherEvidenceCount: references.length }
  }
  // The package reads at most 100 events at once, so a detail page shows the first 100.
  const eventIds = [...new Set(references.flatMap((reference) => reference.eventIds))].slice(0, 100)
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
  const resolved = await input.evidenceSource.resolveEvidence({
    repositoryId: input.repositoryId,
    references,
    events,
  })
  return {
    decisions: history,
    evidence: resolved.flatMap((entry) => entry.evidence),
    otherEvidenceCount: resolved.filter((entry) => entry.evidence.length === 0).length,
  }
}
