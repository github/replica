import { UnrecoverableError } from "bullmq"
import { z } from "zod"

import { parseJobPayload } from "../parse-job-payload/index.ts"
import type { JobDefinition, JobProcessor } from "../types.ts"

/** Bind typed domain input without making queue producers import execution code. */
export function createJobProcessor<T>(
  definition: JobDefinition<T>,
  process: (data: T) => Promise<unknown>,
  shouldRetry?: (error: unknown) => boolean,
): JobProcessor {
  return {
    name: definition.name,
    async process(payload) {
      let data: T
      try {
        data = parseJobPayload(definition, payload)
      } catch (error) {
        if (error instanceof z.ZodError) throw new UnrecoverableError("Job payload is invalid.")
        throw error
      }
      try {
        return await process(data)
      } catch (error) {
        if (shouldRetry && !shouldRetry(error)) {
          throw new UnrecoverableError("Job failed with a nonretryable error.")
        }
        throw error
      }
    },
  }
}
