import type { Request } from "express"
import { z } from "zod"

type ReviewIdentifierName = "commentId" | "prototypeId" | "repositoryId" | "threadId"

export function readReviewIdentifiers<const Names extends readonly ReviewIdentifierName[]>(
  request: Request,
  names: Names,
): { [Key in Names[number]]: string } | null {
  const entries: [Names[number], string][] = []
  for (const name of names) {
    const schema =
      name === "repositoryId" || name === "prototypeId"
        ? z.uuid()
        : z
            .string()
            .regex(/^[1-9]\d*$/)
            .refine((value) => Number(value) <= 2_147_483_647)
    const parsed = schema.safeParse(request.params[name])
    if (!parsed.success) return null
    entries.push([name, parsed.data])
  }
  return Object.fromEntries(entries) as { [Key in Names[number]]: string }
}
