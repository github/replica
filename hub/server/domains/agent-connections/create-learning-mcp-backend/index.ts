import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../../learning/learning-store-arguments/index.ts"

interface LearningSettings {
  applicationRoot?: string
  cliPath: string
  learningDatabaseUrl?: string
  nodePath: string
  root: string
  staticDirectories: string[]
}

interface StoredLearning {
  record: { id: string; state: string }
  status: { recallEligible: boolean }
  withheld: boolean
}

/**
 * Answers one agent's learning tools for one repository by running the replica-learning
 * command, the same way the Learnings page does. Each call names the connection as the
 * agent, so records show which connection received or used guidance.
 */
export function createLearningMcpBackend(input: {
  connectionId: string
  learning: LearningSettings
  learningsUrl: string
  repository: { id: string; githubRepositoryId: bigint }
  toAgentError: (code: string, message: string) => Error
}) {
  const { learning, repository, toAgentError } = input
  const actor = `agent:hub-connection-${input.connectionId}`

  async function storeDirectory() {
    const applicationRoot = learning.applicationRoot ?? process.cwd()
    const directory = await validatePrivateStorageRoot(
      resolve(learning.root, "repositories", repository.id),
      {
        applicationRoot,
        excludedDirectories: learning.staticDirectories,
        name: "REPLICA_LEARNING_ROOT",
        publicRoot: resolve(applicationRoot, "public"),
      },
    )
    if (learning.learningDatabaseUrl) return directory
    try {
      await access(resolve(directory, "config.json"))
      return directory
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    }
  }

  async function run(directory: string, arguments_: string[]) {
    try {
      return await runLearningCommand(
        [
          ...arguments_,
          "--actor",
          actor,
          ...learningStoreArguments({
            directory,
            repositoryId: repository.id,
            repositoryScope: `github.com/repositories/${repository.githubRepositoryId}`,
          }),
        ],
        {
          cliPath: learning.cliPath,
          nodePath: learning.nodePath,
          ...(learning.learningDatabaseUrl
            ? { learningDatabaseUrl: learning.learningDatabaseUrl }
            : {}),
        },
      )
    } catch (error) {
      // The command writes its messages for people, so agents may see them.
      if (error instanceof LearningCommandError) throw toAgentError(error.code, error.message)
      throw error
    }
  }

  function sessionArguments(session?: { id: string; label?: string }) {
    if (!session) return []
    return [
      "--session-id",
      session.id,
      ...(session.label === undefined ? [] : ["--session-label", session.label]),
    ]
  }

  return {
    async getGuidance({
      task,
      limit,
      session,
    }: {
      task?: string
      limit?: number
      session?: { id: string; label?: string }
    }) {
      const directory = await storeDirectory()
      if (!directory) return { guidanceId: null, text: "", learnings: [] }
      const result = (await run(directory, [
        "recall",
        ...(task === undefined ? [] : ["--task", task]),
        "--limit",
        String(limit ?? 20),
        ...sessionArguments(session),
      ])) as {
        guidanceId: string
        text: string
        memories: { id: string; deliveryId: string }[]
      }
      // Only the framed text was recorded as delivered, so the raw learnings stay out.
      return {
        guidanceId: result.guidanceId,
        text: result.text,
        learnings: result.memories.map(({ id, deliveryId }) => ({ id, deliveryId })),
      }
    },

    async reportUsage(report: { used: { before?: unknown; after?: unknown }[] }) {
      if (report.used.some((item) => item.before !== undefined || item.after !== undefined))
        throw toAgentError(
          "unsupported",
          "Hub does not accept screenshots yet. Report usage without them.",
        )
      const directory = await storeDirectory()
      if (!directory)
        throw toAgentError("not_found", "This repository has no learnings to report on.")
      const folder = await mkdtemp(join(tmpdir(), "replica-agent-report-"))
      try {
        const file = join(folder, "report.json")
        await writeFile(file, JSON.stringify(report), { mode: 0o600 })
        return await run(directory, ["report-usage", file])
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },

    submitSession() {
      return Promise.reject(
        toAgentError(
          "grant_inactive",
          "Hub does not collect agent sessions yet, so this session was not stored.",
        ),
      )
    },

    async listLearnings({ state }: { state?: string[] }) {
      const directory = await storeDirectory()
      if (!directory) return []
      return run(directory, [
        "memories",
        "--purpose",
        "instruction",
        ...(state ?? []).flatMap((value) => ["--state", value]),
      ])
    },

    async getLearning({ id }: { id: string }) {
      const directory = await storeDirectory()
      if (!directory) throw toAgentError("not_found", `Learning ${id} was not found.`)
      const item = (await run(directory, [
        "show",
        id,
        "--purpose",
        "instruction",
      ])) as StoredLearning
      const { record } = item
      if (record.state === "accepted" && !item.withheld && item.status.recallEligible) return item
      // A learning no one accepted is not guidance, so its text stays with people.
      const summary = { id: record.id, state: record.state, withheld: true }
      if (record.state !== "proposed") return summary
      return {
        ...summary,
        decide: {
          note: "Only a person can decide. Ask a repository administrator to accept or reject it on the Hub Learnings page.",
          url: input.learningsUrl,
        },
      }
    },
  }
}
