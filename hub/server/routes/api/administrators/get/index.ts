import type { RequestHandler } from "express"
import { z } from "zod"

import type { AdministratorRouteDependencies } from "../../auth/types.ts"
import { readAdministratorSession } from "../read-administrator-session/index.ts"

const querySchema = z
  .object({
    before: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict()
const cursorSchema = z.object({ createdAt: z.iso.datetime(), membershipId: z.uuid() }).strict()

export function get(dependencies: AdministratorRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!(await readAdministratorSession(request, dependencies))) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const query = querySchema.safeParse(request.query)
      if (!query.success) {
        response.status(400).json({ error: "The administrator list query is invalid." })
        return
      }
      let before
      if (query.data.before) {
        try {
          const parsed = cursorSchema.parse(
            JSON.parse(Buffer.from(query.data.before, "base64url").toString("utf8")),
          )
          before = { createdAt: new Date(parsed.createdAt), membershipId: parsed.membershipId }
        } catch {
          response.status(400).json({ error: "The administrator cursor is invalid." })
          return
        }
      }
      const result = (await dependencies.list({ before, limit: query.data.limit })) as {
        administrators: unknown[]
        nextCursor: { createdAt: Date; membershipId: string } | null
      }
      response.json({
        administrators: result.administrators,
        nextCursor: result.nextCursor
          ? Buffer.from(
              JSON.stringify({
                createdAt: result.nextCursor.createdAt.toISOString(),
                membershipId: result.nextCursor.membershipId,
              }),
            ).toString("base64url")
          : null,
      })
    } catch (error) {
      next(error)
    }
  }
}
