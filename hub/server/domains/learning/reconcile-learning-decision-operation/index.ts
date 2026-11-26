import { randomUUID } from "node:crypto"
import { z } from "zod"

import { learningStoreArguments } from "../learning-store-arguments/index.ts"

const resultSchema = z
  .object({
    state: z.enum(["proposed", "accepted", "rejected", "retired"]).nullable(),
  })
  .loose()
const updatesSchema = z
  .object({
    updates: z.array(
      z
        .object({
          id: z.string(),
          state: z.string(),
          decision: z.object({ operationId: z.string().optional() }).loose().optional(),
        })
        .loose(),
    ),
  })
  .loose()

export async function reconcileLearningDecisionOperation(
  operation: {
    id: string
    actorMembershipId: string
    decision: string
    learningId: string
    proposalId: string | null
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
    edit: "accepted",
    reinstate: "accepted",
    reject: "rejected",
    retire: "retired",
    // An apply's edit carries the operation, so the edit landing means it worked.
    apply_update: "accepted",
    dismiss_update: "dismissed",
  }[operation.decision]
  const update = operation.decision === "apply_update" || operation.decision === "dismiss_update"
  if (!expected || (update && !operation.proposalId))
    throw new Error("The pending learning decision is invalid.")
  await dependencies.withLock(async (signal) => {
    let outcome: "succeeded" | "failed" = "failed"
    let reason = "interrupted_or_failed"
    const store = await dependencies.prepare(operation.repositoryId)
    async function operationState() {
      return resultSchema.parse(
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
      ).state
    }
    // Another administrator may decide the same suggestion later, so each request
    // looks only for its own mark: the edit an apply made, or the dismissal it saved.
    const state =
      operation.decision === "dismiss_update"
        ? updatesSchema
            .parse(
              await dependencies.runCommand(
                ["updates", operation.learningId, ...learningStoreArguments(store)],
                { signal },
              ),
            )
            .updates.some(
              (item) =>
                item.id === operation.proposalId &&
                item.state === "dismissed" &&
                item.decision?.operationId === operation.id,
            )
          ? "dismissed"
          : null
        : await operationState()
    if (state === expected) {
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
