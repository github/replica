import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import { listSecurityAudits } from "../../../../repositories/security-audits/list-security-audits/index.ts"
import type {
  AdministratorRouteDependencies,
  CurrentSessionDependencies,
} from "../../auth/types.ts"
import { readAdministratorSession } from "../../administrators/read-administrator-session/index.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../product/read-product-with-current-authority/index.ts"
import type { ProductRouteDependencies } from "../../product/types.ts"
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
    repositoryId: z.uuid().optional(),
    version: z.literal(1),
  })
  .strict()

function decodeCursor(cursor: string, repositoryId?: string) {
  const bytes = Buffer.from(cursor, "base64url")
  if (Buffer.from(bytes).toString("base64url") !== cursor) throw new Error("Noncanonical cursor")
  const parsed = cursorSchema.parse(JSON.parse(bytes.toString("utf8")))
  if (parsed.repositoryId !== repositoryId) throw new Error("Cursor scope does not match")
  return { createdAt: new Date(parsed.createdAt), id: parsed.id }
}

function encodeCursor(cursor: { createdAt: Date; id: string }, repositoryId?: string) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
      repositoryId,
      version: 1,
    }),
  ).toString("base64url")
}

export function get(
  dependencies:
    | AdministratorRouteDependencies
    | {
        session: CurrentSessionDependencies
        product: ProductRouteDependencies
      },
): RequestHandler {
  return async (request, response, next) => {
    try {
      let repositoryId: string | undefined
      if ("session" in dependencies) {
        const address = z.uuid().safeParse(request.params.repositoryId)
        if (!address.success) {
          response.status(400).json({ error: "Enter a valid repository address." })
          return
        }
        repositoryId = address.data
      } else if (!(await readAdministratorSession(request, dependencies))) {
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
      let before: ReturnType<typeof decodeCursor> | undefined
      if (query.data.before) {
        try {
          before = decodeCursor(query.data.before, repositoryId)
        } catch {
          response.status(400).json({ error: "The security audit cursor is invalid." })
          return
        }
      }
      let result
      if ("session" in dependencies && repositoryId) {
        const { session, product } = dependencies
        const cookie = readCookie(request, hubSessionCookieName)
        const initial = await readProductSession(cookie, session)
        const id = repositoryId
        const read =
          initial &&
          (await readProductWithCurrentAuthority(initial, cookie, session, async (viewer) => {
            if ((await product.getRepositoryPermission?.(viewer, id)) !== "admin") return null
            const { prisma } = await import("../../../../integrations/prisma/index.ts")
            const records = await listSecurityAudits(prisma, { before, limit, repositoryId: id })
            return (await product.isRepositoryVisible(viewer, id)) ? records : null
          }))
        if (!read) {
          response.status(401).json({ error: "Sign in to continue." })
          return
        }
        if (!read.result) {
          response.status(404).json({ error: "Repository not found." })
          return
        }
        result = read.result
      } else if ("listSecurityAudits" in dependencies) {
        result = await dependencies.listSecurityAudits({ before, limit })
      } else {
        throw new Error("The audit route requires a scope.")
      }
      response.json(
        securityAuditResponseSchema.parse({
          records: result.records.map(presentSecurityAudit),
          nextCursor: result.nextCursor ? encodeCursor(result.nextCursor, repositoryId) : null,
        }),
      )
    } catch (error) {
      if (error instanceof GitHubProviderRequestError) {
        response.status(503).json({ error: "GitHub repository access is unavailable." })
        return
      }
      next(error)
    }
  }
}
