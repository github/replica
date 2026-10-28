import { z } from "zod"

import type { JobDefinition } from "../types.ts"

export function parseJobPayload<T>(definition: JobDefinition<T>, payload: unknown) {
  const data = definition.schema.parse(payload)
  z.json().parse(data)
  return data
}
