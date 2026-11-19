import express from "express"
import type { Express, RequestHandler } from "express"
import { z } from "zod"

import { AnalyticsSettingsError } from "../../../../domains/analytics/errors.ts"
import type { AnalyticsMutation } from "../../../../domains/analytics/create-destination-service/index.ts"
import type { RepositoryAnalyticsProof } from "../../../../domains/analytics/hosted-authorization/types.ts"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../../../../domains/authentication/errors.ts"
import { AnalyticsEventName, AnalyticsProvider } from "../../../../generated/prisma/enums.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { createAuthenticationCookie } from "../../../../integrations/express/create-authentication-cookie/index.ts"
import { rateLimit } from "../../../../integrations/express/authentication-rate-limit/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { requireOrigin } from "../../../../integrations/express/require-origin/index.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import type { ProductRouteDependencies } from "../../product/types.ts"
import type { AnalyticsRouteDependencies } from "./types.ts"
import { analyticsBrowserCookie } from "./callback/index.ts"

const uuid = z.uuid().transform((value) => value.toLowerCase())

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
  githubProof?: RepositoryAnalyticsProof,
) {
  const hostedAuthorization = githubProof && analytics.hostedAuthorization
  function handle(
    action: "read" | "create" | "update" | "pause" | "resume" | "delete",
  ): RequestHandler {
    return async (request, response, next) => {
      try {
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
          const authorizationId = uuid.safeParse(request.query.authorizationId)
          const authorization =
            hostedAuthorization && !isLocal && authorizationId.success
              ? await hostedAuthorization.status(
                  repositoryId.data,
                  authorizationId.data,
                  hashAuthenticationValue(cookie),
                )
              : null
          response.json({
            ...result,
            canMutate: Boolean(isLocal || hostedAuthorization),
            ...(authorization ? { authorization } : {}),
          })
          return
        }
        const actor = { repositoryId: repositoryId.data, membershipId: viewer.membershipId }
        const sessionDigest = hashAuthenticationValue(cookie)
        let mutation: AnalyticsMutation
        if (action === "create" || action === "update") {
          const parsed = destinationSchema.safeParse(request.body)
          if (!parsed.success) {
            response
              .status(422)
              .json({ error: "Choose a provider and one or more distinct repository events." })
            return
          }
          mutation =
            action === "create"
              ? { action, input: parsed.data }
              : { action, input: parsed.data, destinationId: destinationId.data! }
        } else {
          mutation = { action, destinationId: destinationId.data! }
        }
        if (!isLocal) {
          if (!hostedAuthorization || !githubProof) {
            response
              .status(503)
              .json({ error: "Fresh GitHub repository authorization is unavailable." })
            return
          }
          const started = await hostedAuthorization.start(
            githubProof,
            repositoryId.data,
            sessionDigest,
            mutation,
          )
          response.setHeader(
            "Set-Cookie",
            createAuthenticationCookie({
              name: analyticsBrowserCookie,
              expiresAt: started.expiresAt,
              value: started.browserBinding,
              secure: githubProof.secureCookie,
            }),
          )
          response.status(202).json({
            authorization: {
              id: started.authorizationAttemptId,
              authorizationUrl: started.authorizationUrl,
              expiresAt: started.expiresAt.toISOString(),
            },
          })
          return
        }
        const result = await analytics.mutate(actor, mutation, sessionDigest)
        response.status(action === "create" ? 201 : 200).json(result)
      } catch (error) {
        if (error instanceof AnalyticsSettingsError) {
          response.status(error.status).json({ error: error.message })
        } else if (
          error instanceof GitHubProviderRequestError ||
          error instanceof AuthenticationProofError
        ) {
          response.status(503).json({ error: "GitHub could not verify repository administration." })
        } else {
          next(error)
        }
      }
    }
  }

  function finish(operation: "cancel" | "continue"): RequestHandler {
    return async (request, response, next) => {
      try {
        const repositoryId = uuid.safeParse(request.params.repositoryId)
        const id = uuid.safeParse(request.params.authorizationId)
        const cookie = readCookie(request, hubSessionCookieName)
        if (!repositoryId.success || !id.success || !cookie || !hostedAuthorization) {
          response.status(404).json({ error: "Analytics authorization is no longer available." })
          return
        }
        if (request.body !== undefined && !z.strictObject({}).safeParse(request.body).success) {
          response.status(422).json({ error: "Only the original authorized change can continue." })
          return
        }
        const result = await hostedAuthorization[operation](
          repositoryId.data,
          id.data,
          hashAuthenticationValue(cookie),
        )
        response.json(result)
      } catch (error) {
        if (error instanceof AnalyticsSettingsError)
          response.status(error.status).json({ error: error.message })
        else if (error instanceof GitHubProviderRequestError)
          response.status(503).json({ error: "GitHub could not verify repository administration." })
        else next(error)
      }
    }
  }

  const path = "/api/repositories/:repositoryId/analytics"
  const destinationPath = `${path}/destinations/:destinationId`
  const origin = requireOrigin(analytics.applicationOrigin)
  const json = express.json({ limit: "48kb", inflate: false, strict: true })
  const rate = githubProof
    ? rateLimit(githubProof, "start")
    : (((_request, _response, next) => next()) satisfies RequestHandler)
  app.get(path, handle("read"))
  app.post(`${path}/destinations`, origin, rate, json, handle("create"))
  app.patch(destinationPath, origin, rate, json, handle("update"))
  app.post(`${destinationPath}/pause`, origin, rate, handle("pause"))
  app.post(`${destinationPath}/resume`, origin, rate, handle("resume"))
  app.delete(destinationPath, origin, rate, handle("delete"))
  const authorizationPath = `${path}/authorizations/:authorizationId`
  app.post(
    `${authorizationPath}/continue`,
    origin,
    express.json({ limit: "1kb", inflate: false }),
    finish("continue"),
  )
  app.post(
    `${authorizationPath}/cancel`,
    origin,
    express.json({ limit: "1kb", inflate: false }),
    finish("cancel"),
  )
}
