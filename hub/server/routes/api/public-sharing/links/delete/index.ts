import type { RequestHandler } from "express"
import { z } from "zod"

import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../../product/types.ts"
import { authorizeHostedShareLinkRequest } from "../../authorize-hosted-share-link-request/index.ts"
import { respondPublicSharingError } from "../../respond-public-sharing-error/index.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

export function del(
  session: CurrentSessionDependencies,
  sharing: PublicSharingRouteDependencies,
  product?: ProductRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      if (sharing.hosted) response.setHeader("Cache-Control", "private, no-store")
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!cookie || !initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      const publicId = z.uuid().safeParse(request.params.shareId)
      if (!repositoryId.success || !prototypeId.success || !publicId.success) {
        response.status(400).json({ error: "Enter a valid share-link address." })
        return
      }
      const hosted = sharing.hosted
        ? await authorizeHostedShareLinkRequest({
            cookie,
            initial,
            session,
            product,
            hosted: sharing.hosted,
            repositoryId: repositoryId.data,
            prototypeId: prototypeId.data,
          })
        : undefined
      const current = hosted?.current ?? (await readProductSession(cookie, session))
      if (
        !current ||
        current.membershipId !== initial.membershipId ||
        current.userId !== initial.userId
      ) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (
        !(await sharing.revokeLink({
          repositoryId: repositoryId.data,
          prototypeId: prototypeId.data,
          publicId: publicId.data,
          ...(hosted ? { approval: hosted.approval } : {}),
        }))
      ) {
        response.status(404).json({ error: "Active share link not found." })
        return
      }
      response.json({ notice: "Share link revoked." })
    } catch (error) {
      if (!respondPublicSharingError(response, error, Boolean(sharing.hosted))) next(error)
    }
  }
}
