import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import { prepareLearningStore } from "../prepare-learning-store/index.ts"

const addedGrantSchema = z.object({ id: z.string().min(1).max(255) }).loose()

const bases = {
  agent_screenshots:
    "A repository administrator allowed agents to take screenshots and Hub to analyze them.",
  hub_review_comments:
    "A repository administrator turned on automated evaluations of applied learnings.",
}

/**
 * Turns one evaluation consent on or off in a repository's learning store: screenshots, or
 * the review comments behind learnings an evaluator scores. The store keeps the grant with
 * who changed it, and refuses evaluation once it is withdrawn, so Hub's own setting can
 * never allow more than the store does. Returns the active grant.
 */
export async function changeEvaluationConsent(input: {
  actor: string
  allowed: boolean
  cliPath: string
  grantId: string | null
  learningDatabaseUrl?: string
  nodePath: string
  repositoryId: string
  repositoryScope: string
  root: string
  signal?: AbortSignal
  source: keyof typeof bases
  staticDirectories: string[]
}): Promise<string | null> {
  const store = await prepareLearningStore({
    learningDatabaseUrl: input.learningDatabaseUrl,
    repositoryKey: input.repositoryId,
    repositoryScope: input.repositoryScope,
    root: input.root,
    staticDirectories: input.staticDirectories,
  })
  const options = {
    cliPath: input.cliPath,
    nodePath: input.nodePath,
    ...(input.learningDatabaseUrl ? { learningDatabaseUrl: input.learningDatabaseUrl } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  }
  const common = learningStoreArguments(store)
  if (input.allowed) {
    const grant = addedGrantSchema.parse(
      await runLearningCommand(
        [
          "grants",
          "add",
          "--purpose",
          "evaluation",
          "--source",
          input.source,
          "--basis",
          bases[input.source],
          "--by",
          input.actor,
          ...common,
        ],
        options,
      ),
    )
    return grant.id
  }
  if (input.grantId) {
    await runLearningCommand(
      [
        "grants",
        "withdraw",
        input.grantId,
        "--purpose",
        "evaluation",
        "--by",
        input.actor,
        ...common,
      ],
      options,
    )
  }
  return null
}
