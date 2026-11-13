import type { Request } from "express"
import { z } from "zod"

export function readReviewIdentifiers(
  request: Request,
  names: readonly ("commentId" | "prototypeId" | "repositoryId" | "threadId")[],
): Record<(typeof names)[number], string> | null {
  const values: Record<string, string> = {}
  for (const name of names) {
    const schema =
      name === "repositoryId" || name === "prototypeId"
        ? z.uuid()
        : z
            .string()
            .regex(/^[1-9]\d*$/)
            .refine((value) => Number.isSafeInteger(Number(value)))
    const parsed = schema.safeParse(request.params[name])
    if (!parsed.success) return null
    values[name] = parsed.data
  }
  return values
}
