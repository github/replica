import { z } from "zod"

import { parseJobPayload } from "../parse-job-payload/index.ts"
import type { JobDefinition, JobQueue, JobScheduleRepeat } from "../types.ts"

const repeatSchema = z.union([
  z.object({ every: z.number().int().positive() }).strict(),
  z
    .object({
      pattern: z.string().min(1),
      tz: z.string().refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value })
          return true
        } catch (error) {
          if (error instanceof RangeError) return false
          throw error
        }
      }, "Schedules require a valid timezone."),
    })
    .strict(),
])

export async function upsertJobSchedule<T>(
  queue: JobQueue,
  {
    id,
    definition,
    payload,
    repeat,
  }: { id: string; definition: JobDefinition<T>; payload: T; repeat: JobScheduleRepeat },
) {
  if (queue.name !== "scheduled") {
    throw new Error("Recurring jobs must use the scheduled queue.")
  }
  z.string().min(1).parse(id)
  const settings = repeatSchema.parse(repeat)
  const data = parseJobPayload(definition, payload)
  return await queue.upsertJobScheduler(id, settings, {
    name: definition.name,
    data,
    opts: definition.options,
  })
}
