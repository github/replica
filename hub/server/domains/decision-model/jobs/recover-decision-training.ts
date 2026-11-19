import { z } from "zod"

export const recoverDecisionTrainingJobs = {
  name: "decision.recover-training",
  schema: z.object({}).strict(),
}

export const decisionTrainingRecoverySchedule = {
  id: "decision-training-recovery",
  definition: recoverDecisionTrainingJobs,
  payload: {},
  repeat: { every: 60_000 },
}
