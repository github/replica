import express from "express"
import type { Request, RequestHandler, Response } from "express"
import { z } from "zod"

import {
  createCanvasAuthorization,
  type GetCanvasRepositoryPermission,
} from "../../../domains/canvas/authorization/index.ts"
import { createCanvasConnections } from "../../../domains/canvas/connections/index.ts"
import { canvasDigest, userCodePattern } from "../../../domains/canvas/credentials/index.ts"
import { createCanvasPairings } from "../../../domains/canvas/pairings/index.ts"
import { requireOrigin } from "../../../integrations/express/require-origin/index.ts"
import { hubSessionCookieName } from "../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../integrations/express/read-cookie/index.ts"
import { GitHubProviderRequestError } from "../../../integrations/github/errors.ts"
import { DecisionModelError } from "../../../domains/decision-model/errors.ts"
import { reserveAuthenticationRateLimit } from "../../../repositories/authentication-rate-limits/reserve-authentication-rate-limit/index.ts"
import { post as handleAgentVisualCriticPost } from "./decision-model/evaluations/post/index.ts"
import type { AgentVisualCriticRouteDependencies } from "./decision-model/types.ts"
import type { ProductRouteDependencies } from "../product/types.ts"

const startSchema = z
  .object({
    repository: z
      .string()
      .max(255)
      .regex(/^[^/\s]+\/[^/\s]+$/u),
    renewable: z.boolean().optional(),
  })
  .strict()
const pollSchema = z.object({ device_code: z.string().max(200) }).strict()
const renewalSchema = z.object({ refresh_token: z.string().max(200) }).strict()
const scope = {
  repository_github_id: z
    .string()
    .regex(/^[1-9]\d{0,15}$/)
    .optional(),
}
const connectionQuery = z.object(scope).strict()
const prototypeQuery = z.object({ ...scope, branch: z.string().trim().min(1).max(255) }).strict()

function unavailable(_request: Request, response: Response) {
  response.status(405).json({ error: "This Canvas action is not available." })
}

function accessToken(request: Request) {
  const header = request.get("Authorization")
  return header?.startsWith("Bearer ") ? header.slice(7) : ""
}

function status(response: Response, code: number, error: string) {
  response.status(code).json({ error })
}

function badRequest(response: Response) {
  status(response, 400, "Invalid Canvas request.")
}

function browserSessionRequired(response: Response) {
  status(response, 401, "Sign in to continue.")
}

function scopedResult(
  response: Response,
  result:
    | { status: "ok"; data: unknown }
    | { status: "activity" | "unauthorized" | "hidden" | "forbidden" | "excluded" },
) {
  switch (result.status) {
    case "ok":
      response.json(result.data)
      break
    case "activity":
      response.status(204).end()
      break
    case "unauthorized":
      status(response, 401, "Canvas connection is no longer active.")
      break
    case "forbidden":
      status(response, 403, "Repository access was denied.")
      break
    case "hidden":
      status(response, 404, "Canvas repository or branch was not found.")
      break
    case "excluded":
      response.status(404).json({
        error: "Hub has not discovered a reviewable prototype on this branch.",
        registrationReason: "branch_not_reviewable",
      })
      break
  }
}

export function canvasRoutes(
  applicationOrigin: string,
  product: ProductRouteDependencies & { getRepositoryPermission?: GetCanvasRepositoryPermission },
  agentVisualCritic?: AgentVisualCriticRouteDependencies,
) {
  const router = express.Router()
  const browserMutation = requireOrigin(applicationOrigin)

  async function dependencies() {
    const { prisma } = await import("../../../integrations/prisma/index.ts")
    const authority = createCanvasAuthorization(
      prisma,
      product.getRepositoryPermission?.bind(product),
    )
    return {
      prisma,
      authority,
      pairings: createCanvasPairings(prisma, authority),
      connections: createCanvasConnections(prisma, authority, applicationOrigin),
    }
  }
  type Dependencies = Awaited<ReturnType<typeof dependencies>>

  function handler(
    handle: (request: Request, response: Response, services: Dependencies) => Promise<void>,
  ): RequestHandler {
    return async (request, response, next) => {
      try {
        await handle(request, response, await dependencies())
      } catch (error) {
        if (error instanceof GitHubProviderRequestError) {
          status(response, 503, "Repository access could not be verified. Try again.")
          return
        }
        next(error)
      }
    }
  }

  async function browser(request: Request, services: Dependencies) {
    const cookie = readCookie(request, hubSessionCookieName)
    return cookie ? services.authority.browser(canvasDigest(cookie)) : null
  }

  function approval(approve: boolean) {
    return handler(async (request, response, services) => {
      const code = request.params.userCode
      if (typeof code !== "string" || !userCodePattern.test(code)) {
        status(response, 404, "Canvas pairing was not found.")
        return
      }
      const session = await browser(request, services)
      if (!session) return browserSessionRequired(response)
      const result = await services.pairings.approval(code, session, approve)
      if (!result) return browserSessionRequired(response)
      if (result.status === "expired") {
        status(
          response,
          410,
          "This code is expired or already used. Start a new connection in Copilot.",
        )
      } else if (result.status === "hidden") {
        status(response, 404, "This repository is not available to your signed-in account.")
      } else {
        const { code, repository, expiresAt } = result
        response.json({ code, repository, expiresAt })
      }
    })
  }

  router.get("/approvals/:userCode", approval(false))
  router.post("/approvals/:userCode", browserMutation, approval(true))
  router.get(
    "/connections",
    handler(async (request, response, services) => {
      const session = await browser(request, services)
      const result = session && (await services.connections.list(session))
      if (!result) return browserSessionRequired(response)
      response.json({
        viewerId: result.viewerId,
        connections: result.connections.map(({ id, repository, expiresAt, inactiveAt }) => ({
          id,
          repository: repository.nameWithOwner,
          expiresAt,
          inactiveAt,
        })),
      })
    }),
  )
  router.delete(
    "/connections/:connectionId",
    browserMutation,
    handler(async (request, response, services) => {
      const session = await browser(request, services)
      if (!session) return browserSessionRequired(response)
      const rawId = request.params.connectionId
      const id = Number(rawId)
      if (typeof rawId !== "string" || !/^[1-9]\d{0,9}$/.test(rawId) || id > 2_147_483_647) {
        return badRequest(response)
      }
      const revoked = await services.connections.revokeBrowser(id, session)
      if (revoked === null) return browserSessionRequired(response)
      if (!revoked) {
        status(response, 404, "Canvas connection was not found.")
        return
      }
      response.status(204).end()
    }),
  )

  // Keep the extension's secret-bearing endpoints out of browser fetches, including same-origin ones.
  router.use((request, response, next) => {
    response.set("X-Replica-Canvas-Version", "1")
    const version = request.get("X-Replica-Canvas-Version")
    if (version && version !== "1") {
      response.status(409).json({
        code: "incompatible_canvas_interface",
        error:
          "This plugin and Hub do not support the same Canvas interface. Update to compatible releases.",
      })
      return
    }
    // Node's fetch also supplies Sec-Fetch-Mode; the request site identifies browser fetches.
    if (request.get("Sec-Fetch-Site") || request.get("Origin")) {
      status(response, 403, "Use your Replica extension to access this endpoint.")
      return
    }
    next()
  })

  const json = express.json({ limit: "4kb", strict: true })
  function limit(operation: string, maximum: number): RequestHandler {
    return async (request, response, next) => {
      try {
        const { prisma } = await dependencies()
        const subjectDigest = canvasDigest(request.ip ?? "unknown")
        const result = await reserveAuthenticationRateLimit(prisma, {
          operation,
          subjectDigest,
          auditFirstDenial: false,
          limit: maximum,
          windowSeconds: 60,
        })
        if (result.allowed) {
          next()
          return
        }
        response
          .set("Retry-After", "60")
          .status(429)
          .json({
            code: "rate_limited",
            retryAfter: 60,
            errors: ["Too many Canvas requests. Wait before trying again."],
          })
      } catch (error) {
        next(error)
      }
    }
  }

  if (agentVisualCritic) {
    async function authorizeEvaluationBody(
      request: Request,
      response: Response,
      next: Parameters<RequestHandler>[2],
    ) {
      try {
        const { connections } = await dependencies()
        const result = await connections.authorizeEvaluationCredential(accessToken(request))
        if (result.status === "ok") {
          next()
          return
        }
        if (result.status === "forbidden") {
          status(response, 403, "Repository write access is required for prototype evaluation.")
          return
        }
        status(response, 401, "Canvas connection is no longer active.")
      } catch (error) {
        next(error)
      }
    }
    router.post(
      "/decision-model/evaluations",
      limit("canvas-decision-evaluation-request", 30),
      authorizeEvaluationBody,
      express.json({ limit: "24mb", strict: true }),
      handler(async (request, response, { connections }) => {
        const route = handleAgentVisualCriticPost({
          ...agentVisualCritic,
          async authorize(input) {
            const result = await connections.authorizeEvaluation(input.token, input)
            if (result.status === "ok") return result.data
            if (result.status === "forbidden") {
              throw new DecisionModelError(
                403,
                "access_denied",
                "Repository write access is required for prototype evaluation.",
              )
            }
            if (result.status === "hidden" || result.status === "excluded") {
              throw new DecisionModelError(
                404,
                "repository_not_found",
                "The prototype evaluation target was not found.",
              )
            }
            throw new DecisionModelError(
              401,
              "access_denied",
              "Canvas connection is no longer active.",
            )
          },
        })
        await route(request, response, (error) => {
          throw error
        })
      }),
    )
  }

  router.post(
    "/pairings",
    limit("canvas-pairing-start", 10),
    json,
    handler(async (request, response, { pairings }) => {
      const parsed = startSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(response)
      const result = await pairings.start(parsed.data.repository, parsed.data.renewable === true)
      if (!result) {
        status(response, 404, "Canvas repository was not found.")
        return
      }
      response.status(201).json({
        ...result,
        verificationUrl: new URL(`/canvas/pair/${result.userCode}`, applicationOrigin).href,
      })
    }),
  )
  router.post(
    "/pairings/token",
    limit("canvas-pairing-poll", 60),
    json,
    handler(async (request, response, { pairings }) => {
      const parsed = pollSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(response)
      response.json(await pairings.consume(parsed.data.device_code))
    }),
  )
  router.post(
    "/connection/renewal",
    limit("canvas-renewal", 60),
    json,
    handler(async (request, response, { connections }) => {
      const parsed = renewalSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(response)
      scopedResult(response, await connections.renew(parsed.data.refresh_token))
    }),
  )
  router.delete(
    "/connection/renewal",
    limit("canvas-renewal", 60),
    json,
    handler(async (request, response, { connections }) => {
      const parsed = renewalSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(response)
      await connections.revokeDevice(parsed.data.refresh_token, true)
      response.status(204).end()
    }),
  )
  router.get(
    "/connection",
    handler(async (request, response, { connections }) => {
      const parsed = connectionQuery.safeParse(request.query)
      if (!parsed.success) return badRequest(response)
      scopedResult(
        response,
        await connections.read(accessToken(request), {
          repositoryId: parsed.data.repository_github_id,
          interactive: request.get("X-Replica-Canvas-Activity") === "interactive",
        }),
      )
    }),
  )
  router.patch(
    "/connection",
    handler(async (request, response, { connections }) => {
      const parsed = connectionQuery.safeParse(request.query)
      if (!parsed.success) return badRequest(response)
      scopedResult(
        response,
        await connections.read(accessToken(request), {
          repositoryId: parsed.data.repository_github_id,
          interactive: true,
          activityOnly: true,
        }),
      )
    }),
  )
  router.delete(
    "/connection",
    limit("canvas-revoke", 60),
    handler(async (request, response, { connections }) => {
      if (await connections.revokeDevice(accessToken(request), false)) {
        response.status(204).end()
      } else {
        scopedResult(response, { status: "unauthorized" })
      }
    }),
  )
  router.get(
    "/prototype",
    handler(async (request, response, { connections }) => {
      const parsed = prototypeQuery.safeParse(request.query)
      if (!parsed.success) return badRequest(response)
      scopedResult(
        response,
        await connections.read(accessToken(request), {
          repositoryId: parsed.data.repository_github_id,
          branch: parsed.data.branch,
          interactive: request.get("X-Replica-Canvas-Activity") === "interactive",
        }),
      )
    }),
  )
  router.patch("/prototype", unavailable)
  router.put("/prototype", unavailable)
  return router
}
