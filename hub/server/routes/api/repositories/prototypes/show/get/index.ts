import type { RequestHandler } from "express"
import { z } from "zod"

import { hashAuthenticationValue } from "../../../../../../domains/authentication/hash-authentication-value/index.ts"
import { PrototypeViewError } from "../../../../../../domains/prototypes/read-prototype-with-introduction/index.ts"
import { hubSessionCookieName } from "../../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../../integrations/express/read-cookie/index.ts"
import { GitHubProviderRequestError } from "../../../../../../integrations/github/errors.ts"
import type { CurrentSessionDependencies } from "../../../../auth/types.ts"
import { readProductSession } from "../../../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../../../product/read-product-with-current-authority/index.ts"
import { canStartPrototypeSession } from "../../../../product/can-start-prototype-session/index.ts"
import type { WorkspaceProductRouteDependencies } from "../../../../product/types.ts"
import { readHostedSharingCapability } from "../../../../public-sharing/read-hosted-sharing-capability/index.ts"
import type { PublicSharingRouteDependencies } from "../../../../public-sharing/types.ts"
import { respondReviewError } from "../../../../review-comments/respond-review-error/index.ts"

const querySchema = z
  .object({
    build: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    view: z.enum(["gallery", "list", "minimized"]).optional(),
    from: z.literal("inbox").optional(),
  })
  .strict()

export function get(
  session: CurrentSessionDependencies,
  product: WorkspaceProductRouteDependencies,
  hosted?: PublicSharingRouteDependencies["hosted"],
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!cookie || !initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }

      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const prototypeId = z.uuid().safeParse(request.params.prototypeId)
      if (!repositoryId.success || !prototypeId.success) {
        response.status(400).json({ error: "Enter a valid prototype address." })
        return
      }

      const query = querySchema.safeParse(request.query)
      if (!query.success) {
        const status = Object.hasOwn(request.query, "build") ? 404 : 400
        response.status(status).json({
          error:
            status === 404 ? "Successful Build not found." : "The prototype request is invalid.",
        })
        return
      }
      const buildNumber = query.data.build ? Number(query.data.build) : undefined
      if (buildNumber !== undefined && !Number.isSafeInteger(buildNumber)) {
        response.status(404).json({ error: "Successful Build not found." })
        return
      }
      const sharing = await readHostedSharingCapability({
        cookie,
        initial,
        session,
        product,
        hosted,
        repositoryId: repositoryId.data,
        prototypeId: prototypeId.data,
      })

      const eligibility =
        initial.sessionProvider !== "local"
          ? await readProductWithCurrentAuthority(initial, cookie, session, (viewer) =>
              canStartPrototypeSession(product, viewer, repositoryId.data),
            )
          : { result: false }
      if (!eligibility) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const branch = eligibility.result ? { canBranch: true } : {}
      if (query.data.from && product.authorizeReviewAccess) {
        const access = await product.authorizeReviewAccess(repositoryId.data, {
          ...initial,
          sessionDigest: hashAuthenticationValue(cookie),
        })
        if (!access.canView) {
          response.status(404).json({ error: "Review access is not available." })
          return
        }
      }

      if (query.data.view !== "minimized" && !query.data.from && request.method === "GET") {
        const body = await product.readPrototypeWithIntroduction(
          {
            buildNumber,
            membershipId: initial.membershipId,
            prototypeId: prototypeId.data,
            repositoryId: repositoryId.data,
            sessionDigest: hashAuthenticationValue(cookie),
            userId: initial.userId,
          },
          (detail, showPrototypeInfo) =>
            JSON.stringify({
              ...detail,
              prototype: { ...detail.prototype, canEdit: true, ...sharing },
              showPrototypeInfo,
              ...branch,
            }),
        )
        // Avoid conditional 304 responses after the introduction has been recorded.
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Content-Length", Buffer.byteLength(body))
        response.end(body)
        return
      }

      const read = await readProductWithCurrentAuthority(initial, cookie, session, (viewer) =>
        product.findPrototypeDetail(viewer, repositoryId.data, prototypeId.data, buildNumber),
      )
      if (!read) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const detail = read.result
      if (!detail || (buildNumber !== undefined && !detail.selectedBuild)) {
        response.status(404).json({ error: "Prototype or successful Build not found." })
        return
      }

      response.json({
        ...detail,
        prototype: { ...detail.prototype, canEdit: true, ...sharing },
        showPrototypeInfo: false,
        ...branch,
      })
    } catch (error) {
      if (error instanceof PrototypeViewError) {
        response.status(error.code === "not_signed_in" ? 401 : 404).json({ error: error.message })
        return
      }
      if (error instanceof GitHubProviderRequestError) {
        response.status(503).json({ error: "Hub could not check GitHub repository permissions." })
        return
      }
      if (!respondReviewError(error, response)) next(error)
    }
  }
}
