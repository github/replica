import type { z } from "zod"

import { MockStoreError } from "../store-error"

export function parseMockQuery<T>(
  url: string,
  schema: z.ZodType<T>,
  message = "Invalid request filters.",
): T {
  const parsed = schema.safeParse(Object.fromEntries(new URL(url).searchParams))
  if (!parsed.success) throw new MockStoreError(400, message)
  return parsed.data
}
