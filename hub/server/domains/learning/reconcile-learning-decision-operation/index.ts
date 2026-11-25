import { randomUUID } from "node:crypto"
import { z } from "zod"

import { learningStoreArguments } from "../learning-store-arguments/index.ts"

const resultSchema = z
  .object({
    state: z.enum(["proposed", "accepted", "rejected", "retired"]).nullable(),
  })
  .loose()

export async function reconcileLearningDecisionOperation(
  operation: {
    id: string
    actorMembershipId: string
    decision: string
    learningId: string
    repositoryId: string
  },
  dependencies: {
    finish(input: {
      auditId: string
      operationId: string
      outcome: "succeeded" | "failed"
      reason?: string
    }): Promise<unknown>
    prepare(repositoryId: string): Promise<{
      directory: string
      repositoryScope: string
      repositoryId: string
    }>
    runCommand(arguments_: string[], options: { signal: AbortSignal }): Promise<unknown>
    withLock<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T>
  },
) {
  const expected = {
    accept: "accepted",
    reject: "rejected",
    retire: "retired",
  }[operation.decision]
  if (!expected) throw new Error("The pending learning decision is invalid.")
  await dependencies.withLock(async (signal) => {
    let outcome: "succeeded" | "failed" = "failed"
    let reason = "interrupted_or_failed"
    const store = await dependencies.prepare(operation.repositoryId)
    const result = resultSchema.parse(
      await dependencies.runCommand(
        [
          "operation-status",
          operation.learningId,
          "--operation-id",
          operation.id,
          ...learningStoreArguments(store),
        ],
        { signal },
      ),
    )
    if (result.state === expected) {
      outcome = "succeeded"
      reason = ""
    }
    await dependencies.finish({
      auditId: randomUUID(),
      operationId: operation.id,
      outcome,
      ...(reason ? { reason } : {}),
    })
  })
}
