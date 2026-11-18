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
    | { id: string; runtimeJobId: string; runtimeTasksetId: string }
    | {
        id: string
        state: DecisionTrainingJobState
        candidateRuntimeId?: string
        failureCode?: string
        usage?: DecisionRuntimeUsage
      },
) {
  if ("runtimeJobId" in input) {
    return database.decisionTrainingJob.update({
      where: { id: input.id },
      data: {
        runtimeJobId: input.runtimeJobId,
        runtimeTasksetId: input.runtimeTasksetId,
        state: "SUBMITTED",
        submittedAt: new Date(),
      },
    })
  }
  const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(input.state)
  return database.decisionTrainingJob.update({
    where: { id: input.id },
    data: {
      state: input.state,
      candidateRuntimeId: input.candidateRuntimeId,
      failureCode: input.failureCode,
      ...(input.state === "RUNNING" ? { startedAt: new Date() } : {}),
      ...(terminal ? { finishedAt: new Date() } : {}),
      ...usageData(input.usage),
    },
  })
}
