import { z } from "zod"

export const reconcileRuntimeDeletionsJob = {
  name: "decision.reconcile-runtime-deletions",
  schema: z.object({}).strict(),
}

export const reconcileRuntimeDeletionsSchedule = {
  id: "decision-runtime-deletion-recovery",
  definition: reconcileRuntimeDeletionsJob,
  payload: {},
  repeat: { every: 60_000 },
}
