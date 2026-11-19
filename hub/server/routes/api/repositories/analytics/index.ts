import express from "express"
import type { Express, RequestHandler } from "express"
import { z } from "zod"

import { AnalyticsSettingsError } from "../../../../domains/analytics/errors.ts"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { AnalyticsEventName, AnalyticsProvider } from "../../../../generated/prisma/enums.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { requireOrigin } from "../../../../integrations/express/require-origin/index.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../product/types.ts"
import type { AnalyticsRouteDependencies } from "./types.ts"

const destinationSchema = z.strictObject({
  provider: z.enum(AnalyticsProvider),
  eventTypes: z
    .array(z.enum(AnalyticsEventName))
    .min(1)
    .max(7)
    .refine((values) => new Set(values).size === values.length),
  configuration: z.unknown(),
  includeRetained: z.boolean().optional(),
})

export function mountRepositoryAnalytics(
  app: Express,
  session: CurrentSessionDependencies,
  product: ProductRouteDependencies,
  analytics: AnalyticsRouteDependencies,
) {
  function handle(
    action: "read" | "create" | "update" | "pause" | "resume" | "delete",
  ): RequestHandler {
    return async (request, response, next) => {
      try {
        const uuid = z.uuid().transform((value) => value.toLowerCase())
        const repositoryId = uuid.safeParse(request.params.repositoryId)
        const destinationId = uuid.safeParse(request.params.destinationId)
        if (
          !repositoryId.success ||
          (action !== "read" && action !== "create" && !destinationId.success)
        ) {
          response.status(404).json({ error: "Repository or destination not found." })
          return
        }
        const cookie = readCookie(request, hubSessionCookieName)
        const viewer = await readProductSession(cookie, session)
        if (!cookie || !viewer) {
          response.status(401).json({ error: "Sign in to continue." })
          return
        }

        const isLocal =
          analytics.localAdministration &&
          viewer.sessionProvider === "local" &&
          (await analytics.isLocalAdministrator(viewer, repositoryId.data))
        const permission =
          (viewer.sessionProvider === "github" && viewer.externalIdentityId) || isLocal
            ? product.getRepositoryPermission
              ? await product.getRepositoryPermission(viewer, repositoryId.data)
              : isLocal
                ? "admin"
                : "none"
            : "none"
        if (permission !== "admin") {
          response.status(404).json({ error: "Repository not found." })
          return
        }

        const current = await readProductSession(cookie, session)
        if (
          !current ||
          current.membershipId !== viewer.membershipId ||
          current.userId !== viewer.userId ||
          current.sessionProvider !== viewer.sessionProvider ||
          current.externalIdentityId !== viewer.externalIdentityId ||
          (isLocal && current.role !== "ADMINISTRATOR")
        ) {
          response.status(401).json({ error: "Sign in to continue." })
          return
        }
        if (action === "read") {
          const result = await analytics.list(repositoryId.data)
          response.json({ ...result, canMutate: isLocal })
          return
        }
        if (!isLocal) {
          // The existing fresh flow authorizes Hub administration, not GitHub repository intent.
          response.status(503).json({
            error:
              "Hosted destination changes require fresh GitHub repository authorization, which is not available yet.",
          })
          return
        }
        const actor = { repositoryId: repositoryId.data, membershipId: viewer.membershipId }
        const sessionDigest = hashAuthenticationValue(cookie)
        let result: { id: string }
        if (action === "create" || action === "update") {
          const parsed = destinationSchema.safeParse(request.body)
          if (!parsed.success) {
            response
              .status(422)
              .json({ error: "Choose a provider and one or more distinct repository events." })
            return
          }
          result = await analytics.mutate(
            actor,
            action === "create"
              ? { action, input: parsed.data }
              : { action, input: parsed.data, destinationId: destinationId.data! },
            sessionDigest,
          )
        } else {
          result = await analytics.mutate(
            actor,
            { action, destinationId: destinationId.data! },
            sessionDigest,
          )
        }
        response.status(action === "create" ? 201 : 200).json(result)
      } catch (error) {
        if (error instanceof AnalyticsSettingsError) {
          response.status(error.status).json({ error: error.message })
        } else if (error instanceof GitHubProviderRequestError) {
          response.status(503).json({ error: "GitHub could not verify repository administration." })
        } else {
          next(error)
        }
      }
    }
  }

  const path = "/api/repositories/:repositoryId/analytics"
  const destinationPath = `${path}/destinations/:destinationId`
  const origin = requireOrigin(analytics.applicationOrigin)
  const json = express.json({ limit: "48kb", inflate: false, strict: true })
  app.get(path, handle("read"))
  app.post(`${path}/destinations`, origin, json, handle("create"))
  app.patch(destinationPath, origin, json, handle("update"))
  app.post(`${destinationPath}/pause`, origin, handle("pause"))
  app.post(`${destinationPath}/resume`, origin, handle("resume"))
  app.delete(destinationPath, origin, handle("delete"))
}
