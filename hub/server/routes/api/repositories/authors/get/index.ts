import type { RequestHandler } from "express"
import { z } from "zod"

import { readHubSessionCookie } from "../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../../product/read-product-with-current-authority/index.ts"
import type { ProductRouteDependencies } from "../../../product/types.ts"

const querySchema = z
  .object({ q: z.string().max(200).optional(), cursor: z.string().max(2048).optional() })
  .strict()
const cursorSchema = z.object({ login: z.string().max(200), id: z.uuid() }).strict()

export function get(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readHubSessionCookie(request)
      const initial = await readProductSession(cookie, session)
      if (!initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      if (!repositoryId.success) {
        response.status(400).json({ error: "Enter a valid repository address." })
        return
      }
      const query = querySchema.safeParse(request.query)
      if (!query.success) {
        response.status(400).json({ error: "The user search is invalid." })
        return
      }
      // The cursor only marks where the last page ended; it grants no access.
      let after = null
      if (query.data.cursor) {
        try {
          after = cursorSchema.parse(
            JSON.parse(Buffer.from(query.data.cursor, "base64url").toString("utf8")),
          )
        } catch {
          response.status(400).json({ error: "The user cursor is invalid." })
          return
        }
      }
      const read = await readProductWithCurrentAuthority(initial, cookie, session, (viewer) =>
        product.findRepositoryAuthors(viewer, repositoryId.data, {
          viewerId: viewer.userId,
          query: (query.data.q ?? "").trim(),
          after,
        }),
      )
      if (!read) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const result = read.result
      if (!result) {
        response.status(404).json({ error: "Repository not found." })
        return
      }
      response.json({
        authors: result.authors,
        nextCursor: result.next
          ? Buffer.from(JSON.stringify(result.next)).toString("base64url")
          : null,
      })
    } catch (error) {
      next(error)
    }
  }
}
