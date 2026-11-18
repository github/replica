import type { DecisionTrainingJobState, Prisma } from "../../../generated/prisma/client.ts"
import type { DecisionRuntimeUsage } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

function usageData(usage?: DecisionRuntimeUsage) {
  return usage
    ? {
        usageQuantity: usage.quantity,
        usageUnit: usage.unit,
        costAmount: usage.cost?.amount,
        costCurrency: usage.cost?.currency,
      }
    : {}
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
        usage?: DecisionRuntimeUsage
      },
) {
  if ("runtimeJobId" in input) {
    const updated = await database.decisionTrainingJob.updateMany({
      where: { id: input.id, state: { in: input.expectedStates } },
      data: {
        runtimeJobId: input.runtimeJobId,
        runtimeTasksetId: input.runtimeTasksetId,
        state: "SUBMITTED",
        submittedAt: new Date(),
      },
    })
    return {
      changed: updated.count === 1,
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
