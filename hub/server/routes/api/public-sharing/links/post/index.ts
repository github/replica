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

const bodySchema = z
  .object({
    label: z.string(),
    expiration: z.enum(["one_day", "seven_days", "thirty_days"]),
    buildNumber: z.number().int().positive(),
  })
  .strict()

export function post(
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
      const body = bodySchema.safeParse(request.body)
      if (!repositoryId.success || !prototypeId.success || !body.success) {
        response.status(422).json({ error: "Enter valid share-link details." })
        return
      }
      const expirationDays = {
        one_day: 1,
        seven_days: 7,
        thirty_days: 30,
      }[body.data.expiration]
      if (expirationDays > sharing.maximumDays) {
        response.status(422).json({ error: "Choose an expiration allowed by this Hub." })
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
      const link = await sharing.createLink({
        repositoryId: repositoryId.data,
        prototypeId: prototypeId.data,
        createdById: current.userId,
        createdByLogin: current.login,
        actorMembershipId: current.membershipId,
        ...(hosted ? { approval: hosted.approval } : {}),
        ...body.data,
      })
      response.status(201).json({
        notice: "Share link created.",
        link: {
          id: link.id,
          shareId: link.publicId,
          repositoryId: repositoryId.data,
          prototypeId: link.prototypeId,
          buildNumber: link.buildNumber,
          label: link.label,
          createdBy: link.createdByLogin,
          createdAt: link.createdAt.toISOString(),
          expiresAt: link.expiresAt.toISOString(),
          revokedAt: null,
        },
      })
    } catch (error) {
      if (!respondPublicSharingError(response, error, Boolean(sharing.hosted))) next(error)
    }
  }
}
