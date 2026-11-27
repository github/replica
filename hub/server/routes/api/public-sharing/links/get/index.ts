import type { RequestHandler } from "express"
import { z } from "zod"

import { readHubSessionCookie } from "../../../../../integrations/express/read-hub-session-cookie/index.ts"
import type { CurrentSessionDependencies } from "../../../auth/types.ts"
import { readProductSession } from "../../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../../product/types.ts"
import { authorizeHostedShareLinkRequest } from "../../authorize-hosted-share-link-request/index.ts"
import { respondPublicSharingError } from "../../respond-public-sharing-error/index.ts"
import type { PublicSharingRouteDependencies } from "../../types.ts"

const querySchema = z.object({ build: z.coerce.number().int().positive().optional() }).strict()

export function get(
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
  sharing: PublicSharingRouteDependencies,
): RequestHandler {
  return async (request, response, next) => {
    try {
      if (sharing.hosted) response.setHeader("Cache-Control", "private, no-store")
      const cookie = readHubSessionCookie(request)
      const initial = await readProductSession(cookie, session)
      if (!cookie || !initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      const query = querySchema.safeParse(request.query)
      if (!repositoryId.success || !prototypeId.success || !query.success) {
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
      const [resource, links, settings] = await Promise.all([
        product.findPrototypeDetail(
          hosted?.current ?? initial,
          repositoryId.data,
          prototypeId.data,
          query.data.build,
        ),
        hosted
          ? sharing.listLinks(prototypeId.data, hosted.approval)
          : sharing.listLinks(prototypeId.data),
        sharing.getSettings(),
      ])
      const current = await readProductSession(cookie, session)
      if (
        !current ||
        current.membershipId !== initial.membershipId ||
        current.userId !== initial.userId ||
        (hosted &&
          (current.sessionProvider !== "github" ||
            current.externalIdentityId !== hosted.approval.identity.id ||
            current.role !== hosted.current.role))
      ) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      if (!resource || (query.data.build !== undefined && !resource.selectedBuild)) {
        response.status(404).json({ error: "Prototype or successful Build not found." })
        return
      }
      response.json({
        resource: {
          ...resource,
          prototype: {
            ...resource.prototype,
            canEdit: true,
            ...(hosted ? { canManageShareLinks: true } : {}),
          },
        },
        enabled: settings.enabled,
        canManage: true,
        links: links.map((link) => ({
          id: link.id,
          shareId: link.publicId,
          repositoryId: repositoryId.data,
          prototypeId: link.prototypeId,
          buildNumber: link.buildNumber,
          label: link.label,
          createdBy: link.createdByLogin,
          createdAt: link.createdAt.toISOString(),
          expiresAt: link.expiresAt.toISOString(),
          revokedAt: link.revokedAt?.toISOString() ?? null,
        })),
        expirationOptions: [
          "one_day",
          ...(sharing.maximumDays >= 7 ? (["seven_days"] as const) : []),
          ...(sharing.maximumDays >= 30 ? (["thirty_days"] as const) : []),
        ],
      })
    } catch (error) {
      if (!respondPublicSharingError(response, error, Boolean(sharing.hosted))) next(error)
    }
  }
}
