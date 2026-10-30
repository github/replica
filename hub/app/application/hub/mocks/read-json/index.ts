import type { z } from "zod"

import { MockStoreError } from "../store-error"

export async function readMockJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let input: unknown
  try {
    input = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new MockStoreError(400, "The request body is not valid JSON.")
    }
    throw error
  }
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new MockStoreError(422, parsed.error.issues.map(({ message }) => message).join(" "))
  }
  return parsed.data
}
