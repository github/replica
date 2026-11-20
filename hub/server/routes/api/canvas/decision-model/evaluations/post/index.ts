import type { RequestHandler } from "express"
import { z } from "zod"

import { respondDecisionModelError } from "../../../../decision-model/respond-decision-model-error/index.ts"
import type { AgentEvaluationAuthority } from "../../../../../../domains/decision-model/types.ts"
import { DecisionModelError } from "../../../../../../domains/decision-model/errors.ts"
import type { AgentVisualCriticRouteDependencies } from "../../types.ts"

const routeSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("?") &&
      !value.includes("#"),
  )
const requestSchema = z
  .object({
    branch: z.string().min(1).max(255),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    currentRoute: routeSchema.nullable(),
    screenshots: z
      .array(
        z
          .object({
            route: routeSchema,
            viewport: z.enum(["desktop", "narrow"]),
            theme: z.enum(["light", "dark"]),
            dataBase64: z.string().min(1).max(2_796_204),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()

function bearerToken(header: string | undefined) {
  const match = /^Bearer ([^\s]{20,4096})$/.exec(header ?? "")
  return match?.[1] ?? null
}

export function post(
  dependencies: AgentVisualCriticRouteDependencies & {
    authorize(input: {
      token: string
      branch: string
      commitSha: string
    }): Promise<AgentEvaluationAuthority>
  },
): RequestHandler {
  return async (request, response, next) => {
    try {
      const token = bearerToken(request.get("authorization"))
      if (!token) {
        response.status(401).json({
          code: "canvas_authorization_required",
          error: "Connect this repository to Hub before requesting prototype evaluation.",
        })
        return
      }
      const parsed = requestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new DecisionModelError(
          422,
          "invalid_request",
          "The prototype-evaluation request is not valid.",
          { cause: parsed.error },
        )
      }
      const input = parsed.data
      const authority = await dependencies.authorize({
        token,
        branch: input.branch,
        commitSha: input.commitSha,
      })
      response.setHeader("X-Replica-Canvas-Version", "1")
      response.json(
        await dependencies.evaluate({
          authority,
          currentRoute: input.currentRoute,
          screenshots: input.screenshots,
        }),
      )
    } catch (error) {
      if (!respondDecisionModelError(response, error)) next(error)
    }
  }
}
