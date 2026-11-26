import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command/index.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root/index.ts"
import { learningStoreArguments } from "../../learning/learning-store-arguments/index.ts"

const agentErrorCodes = new Set([
  "conflict",
  "invalid_input",
  "invalid_transition",
  "not_found",
  "unsupported",
])

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

/** Writes private text to a file only this process can read, and removes it afterwards. */
async function withPrivateFile<T>(content: string, operation: (file: string) => Promise<T>) {
  const folder = await mkdtemp(join(tmpdir(), "replica-agent-"))
  try {
    const file = join(folder, "input")
    await writeFile(file, content, { mode: 0o600 })
    return await operation(file)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/**
 * Answers one agent's learning tools for one repository by running the replica-learning
 * command, the same way the Learnings page does. Each call names the connection as the
 * agent, so records show which connection received or used guidance.
 */
export function createLearningMcpBackend(input: {
  confirmAccess(): Promise<boolean>
  connectionId: string
  learning: LearningSettings
  learningsUrl: string
  repository: { id: string; githubRepositoryId: bigint }
  serialize<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
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

  /**
   * Runs one command while no other learning work can change the store, then checks the
   * connection still has access, so a revoked agent never receives what it asked for.
   */
  async function run(directory: string, arguments_: string[]) {
    try {
      return await input.serialize(async (signal) => {
        const result = await runLearningCommand(
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
            signal,
            ...(learning.learningDatabaseUrl
              ? { learningDatabaseUrl: learning.learningDatabaseUrl }
              : {}),
          },
        )
        if (!(await input.confirmAccess()))
          throw toAgentError("access_denied", "This agent connection no longer has access.")
        return result
      })
    } catch (error) {
      // These codes describe the agent's own request. Other failures can name server
      // paths or storage, so they reach the agent only as a plain message.
      if (error instanceof LearningCommandError && agentErrorCodes.has(error.code))
        throw toAgentError(error.code, error.message)
      throw error
    }
  }

  function sessionArguments(session?: { id: string; label?: string }) {
    if (!session) return []
    // Joined to the flag so a value starting with "-" is read as data.
    return [
      `--session-id=${session.id}`,
      ...(session.label === undefined ? [] : [`--session-label=${session.label}`]),
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
      const store = directory
      function recall(taskArguments: string[]) {
        return run(store, [
          "recall",
          ...taskArguments,
          "--limit",
          String(limit ?? 20),
          ...sessionArguments(session),
        ])
      }
      // The task goes through a private file so it never shows in the process list.
      const result = (await (task === undefined
        ? recall([])
        : withPrivateFile(task, (file) => recall(["--task-file", file])))) as {
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
      return withPrivateFile(JSON.stringify(report), (file) =>
        run(directory, ["report-usage", file]),
      )
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
