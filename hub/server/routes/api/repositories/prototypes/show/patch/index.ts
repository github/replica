import type { RequestHandler } from "express"
import { z } from "zod"

import { hashAuthenticationValue } from "../../../../../../domains/authentication/hash-authentication-value/index.ts"
import { PrototypeMetadataError } from "../../../../../../domains/prototypes/errors.ts"
import { hubSessionCookieName } from "../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import { readProductSession } from "../../../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../../../product/types.ts"

const bodySchema = z
  .object({
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    startPage: z.string().nullable().optional(),
  })
  .strict()

const errorStatus = { invalid_input: 400, not_found: 404, not_signed_in: 401 } as const

export function patch(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      if (!cookie || !(await readProductSession(cookie, session))) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }

      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      if (!repositoryId.success || !prototypeId.success) {
        response.status(400).json({ error: "Enter a valid prototype address." })
        return
      }
      const changes = bodySchema.safeParse(request.body)
      if (!changes.success || Object.keys(changes.data).length === 0) {
        response.status(400).json({ error: "Send a prototype edit." })
        return
      }

      const detail = await product.editPrototypeMetadata({
        changes: changes.data,
        prototypeId: prototypeId.data,
        repositoryId: repositoryId.data,
        sessionDigest: hashAuthenticationValue(cookie),
      })
      response.json({ ...detail, showPrototypeInfo: false })
    } catch (error) {
      if (error instanceof PrototypeMetadataError) {
        response.status(errorStatus[error.code]).json({ error: error.message })
        return
      }
      next(error)
    }
  }
}
