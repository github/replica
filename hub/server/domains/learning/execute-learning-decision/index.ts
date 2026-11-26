import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { z } from "zod"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { learningStoreArguments } from "../learning-store-arguments/index.ts"
import type { LearningDecision } from "../types.ts"

const updatesSchema = z
  .object({ updates: z.array(z.object({ id: z.string(), state: z.string() }).loose()) })
  .loose()

export async function executeLearningDecision(input: {
  actor: string
  applicationRoot?: string
  cliPath: string
  decision: LearningDecision
  learningId: string
  learningDatabaseUrl?: string
  nodePath: string
  operationId: string
  repositoryId: string
  repositoryScope: string
  root: string
  signal?: AbortSignal
  staticDirectories: string[]
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
      throw new LearningCommandError("not_found", "That learning no longer exists.")
    }
  }
  const store = learningStoreArguments({
    directory,
    repositoryId: input.repositoryId,
    repositoryScope: input.repositoryScope,
  })
  const commandOptions = {
    cliPath: input.cliPath,
    ...(input.learningDatabaseUrl ? { learningDatabaseUrl: input.learningDatabaseUrl } : {}),
    nodePath: input.nodePath,
    signal: input.signal,
  }
  const decision = input.decision
  const arguments_: string[] = []
  if (decision.decision === "apply_update" || decision.decision === "dismiss_update") {
    // The package finds a suggestion by its own ID, so check it belongs to this learning.
    const { updates } = updatesSchema.parse(
      await runLearningCommand(["updates", input.learningId, ...store], commandOptions),
    )
    const update = updates.find(({ id }) => id === decision.proposalId)
    if (!update) {
      throw new LearningCommandError("not_found", "That suggested update no longer exists.")
    }
    // The package treats a repeated decision as done, which would hide that another
    // administrator already chose differently.
    if (update.state !== "open") {
      throw new LearningCommandError(
        "stale_review",
        "That suggested update was already decided. Refresh to see the latest.",
      )
    }
    arguments_.push(
      decision.decision.replace("_", "-"),
      decision.proposalId,
      "--operation-id",
      input.operationId,
    )
  } else {
    arguments_.push(decision.decision, input.learningId, "--operation-id", input.operationId)
    if (decision.decision !== "retire") arguments_.push("--digest", decision.digest)
  }
  arguments_.push("--by", input.actor)
  let temporaryDirectory: string | undefined
  try {
    if (decision.decision !== "accept" || decision.content !== undefined) {
      temporaryDirectory = await mkdtemp(resolve(tmpdir(), "replica-learning-decision-"))
    }
    if (decision.decision !== "accept") {
      const reasonPath = resolve(temporaryDirectory!, "reason.txt")
      await writeFile(reasonPath, decision.reason, { mode: 0o600 })
      arguments_.push("--reason-file", reasonPath)
    }
    if (
      (decision.decision === "accept" ||
        decision.decision === "edit" ||
        decision.decision === "apply_update") &&
      decision.content !== undefined
    ) {
      const contentPath = resolve(temporaryDirectory!, "content.txt")
      await writeFile(contentPath, decision.content, { mode: 0o600 })
      arguments_.push("--content-file", contentPath)
    }
    if (
      (decision.decision === "edit" || decision.decision === "apply_update") &&
      decision.title !== undefined
    ) {
      const titlePath = resolve(temporaryDirectory!, "title.txt")
      await writeFile(titlePath, decision.title, { mode: 0o600 })
      arguments_.push("--title-file", titlePath)
    }
    await runLearningCommand([...arguments_, ...store], commandOptions)
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true })
  }
  const notices = {
    accept: "Learning accepted.",
    reject: "Suggestion rejected.",
    retire: "Learning retired.",
    edit: "Learning updated.",
    reinstate: "Learning reinstated.",
    apply_update: "Suggested update applied.",
    dismiss_update: "Suggested update dismissed.",
  }
  return { notice: notices[decision.decision] }
}
