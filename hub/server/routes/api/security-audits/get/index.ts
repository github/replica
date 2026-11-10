import type { RequestHandler } from "express"
import { z } from "zod"

import type { AdministratorRouteDependencies } from "../../auth/types.ts"
import { readAdministratorSession } from "../../administrators/read-administrator-session/index.ts"
import { securityAuditResponseSchema } from "../contract.ts"
import { presentSecurityAudit } from "../present-security-audit/index.ts"

const querySchema = z
  .object({
    before: z.string().min(1).max(500).optional(),
    limit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
  })
  .strict()
const cursorSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    version: z.literal(1),
  })
  .strict()

function decodeCursor(cursor: string) {
  const bytes = Buffer.from(cursor, "base64url")
  if (Buffer.from(bytes).toString("base64url") !== cursor) throw new Error("Noncanonical cursor")
  const parsed = cursorSchema.parse(JSON.parse(bytes.toString("utf8")))
  return { createdAt: new Date(parsed.createdAt), id: parsed.id }
}

function encodeCursor(cursor: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
      version: 1,
    }),
  ).toString("base64url")
}

export function get(dependencies: AdministratorRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      if (!(await readAdministratorSession(request, dependencies))) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const query = querySchema.safeParse(request.query)
      if (!query.success) {
        response.status(400).json({ error: "The security audit query is invalid." })
        return
      }
      const limit = query.data.limit ? Number(query.data.limit) : 50
      if (limit > 50) {
        response.status(400).json({ error: "The security audit limit exceeds the maximum of 50." })
        return
      }
      let before
      if (query.data.before) {
        try {
          before = decodeCursor(query.data.before)
        } catch {
          response.status(400).json({ error: "The security audit cursor is invalid." })
          return
        }
      }
      const result = await dependencies.listSecurityAudits({ before, limit })
      response.json(
        securityAuditResponseSchema.parse({
          records: result.records.map(presentSecurityAudit),
          nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
        }),
      )
    } catch (error) {
      next(error)
    }
  }
}
