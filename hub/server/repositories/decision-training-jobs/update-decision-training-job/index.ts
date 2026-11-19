import type { DecisionTrainingJobState, Prisma } from "../../../generated/prisma/client.ts"
import type { DecisionRuntimeUsage } from "../../../utils/decision-runtime-usage/types.ts"

function usageData(usage?: DecisionRuntimeUsage[]) {
  if (!usage) return {}
  const creditQuantity = usage
    .filter((record) => record.unit === "credits")
    .reduce((total, record) => total + record.quantity, 0)
  const hasCreditUsage = usage.some((record) => record.unit === "credits")
  return {
    usageRecords: usage.map((record) => ({ ...record })) as Prisma.InputJsonArray,
    ...(hasCreditUsage || usage.length === 0
      ? { usageQuantity: creditQuantity, usageUnit: "credits" }
      : {}),
  }
}

export async function updateDecisionTrainingJob(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  input:
    | {
        id: string
        runtimeJobId: string
        runtimeTasksetId: string
        expectedStates: DecisionTrainingJobState[]
      }
    | {
        id: string
        state: DecisionTrainingJobState
        expectedStates: DecisionTrainingJobState[]
        candidateRuntimeId?: string
        failureCode?: string
        usage?: DecisionRuntimeUsage[]
      },
) {
  if ("runtimeJobId" in input) {
    const submitted = await database.decisionTrainingJob.updateMany({
      where: { id: input.id, state: "SUBMITTING" },
      data: {
        runtimeJobId: input.runtimeJobId,
        runtimeTasksetId: input.runtimeTasksetId,
        state: "SUBMITTED",
        submittedAt: new Date(),
      },
    })
    const cancelRequested =
      submitted.count === 0
        ? await database.decisionTrainingJob.updateMany({
            where: { id: input.id, state: "CANCEL_REQUESTED", runtimeJobId: null },
            data: {
              runtimeJobId: input.runtimeJobId,
              runtimeTasksetId: input.runtimeTasksetId,
              submittedAt: new Date(),
            },
          })
        : { count: 0 }
    return {
      changed: submitted.count === 1 || cancelRequested.count === 1,
      job: await database.decisionTrainingJob.findUniqueOrThrow({ where: { id: input.id } }),
    }
  }
  const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(input.state)
  const updated = await database.decisionTrainingJob.updateMany({
    where: { id: input.id, state: { in: input.expectedStates } },
    data: {
      state: input.state,
      candidateRuntimeId: input.candidateRuntimeId,
      failureCode: input.failureCode,
      ...(input.state === "RUNNING" ? { startedAt: new Date() } : {}),
      ...(terminal ? { finishedAt: new Date() } : {}),
      ...usageData(input.usage),
    },
  })
  return {
    changed: updated.count === 1,
    job: await database.decisionTrainingJob.findUniqueOrThrow({ where: { id: input.id } }),
  }
}
