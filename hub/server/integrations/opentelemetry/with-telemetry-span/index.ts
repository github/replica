import { SpanStatusCode, trace } from "@opentelemetry/api"
import { z } from "zod"

import type { TelemetryAttributes } from "./types.ts"

const attributesSchema = z.strictObject({
  "replica.repository.id": z.uuid().optional(),
  "replica.prototype.id": z.uuid().optional(),
  "replica.build.id": z.uuid().optional(),
  "replica.thread.id": z.uuid().optional(),
  "replica.comment.id": z.uuid().optional(),
})

export async function withTelemetrySpan<T>(
  name: string,
  attributes: TelemetryAttributes,
  operation: () => T | Promise<T>,
): Promise<T> {
  if (name.length > 100 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name)) {
    throw new Error(
      "Telemetry span names must be static lowercase identifiers of 1 through 100 characters.",
    )
  }
  const parsed = attributesSchema.safeParse(attributes)
  if (!parsed.success) {
    throw new Error("Telemetry attributes must contain only approved UUID identifiers.")
  }
  return trace
    .getTracer("replica-hub")
    .startActiveSpan(name, { attributes: parsed.data }, async (span) => {
      try {
        const result = await operation()
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    })
}
