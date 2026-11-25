import { access } from "node:fs/promises"
import { resolve } from "node:path"

import { learningStoreArguments } from "../learning-store-arguments/index.ts"

export async function processReviewCommentRedaction(
  input: { repositoryId: string; commentId: number; actor: string },
  dependencies: {
    root: string
    prepare(repositoryId: string): Promise<{
      directory: string
      repositoryScope: string
      repositoryId: string
    }>
    runCommand(arguments_: string[], options: { signal: AbortSignal }): Promise<unknown>
    markComplete(input: {
      repositoryId: string
      commentId: number
      redactedAt: Date
    }): Promise<unknown>
    now(): Date
    withLock<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T>
  },
) {
  await dependencies.withLock(async (signal) => {
    const directory = resolve(dependencies.root, "repositories", input.repositoryId)
    try {
      await access(resolve(directory, "config.json"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return
    }
    const store = await dependencies.prepare(input.repositoryId)
    await dependencies.runCommand(
      [
        "redact",
        "--comment",
        input.commentId.toString(),
        "--by",
        input.actor,
        ...learningStoreArguments(store),
      ],
      { signal },
    )
    await dependencies.markComplete({
      repositoryId: input.repositoryId,
      commentId: input.commentId,
      redactedAt: dependencies.now(),
    })
  })
}
