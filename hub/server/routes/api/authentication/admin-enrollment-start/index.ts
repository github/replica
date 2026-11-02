import type { RequestHandler } from "express"
import { z } from "zod"

import type { AuthenticationRouteRuntime } from "../types.ts"
import { start } from "../start/index.ts"

const bodySchema = z
  .object({
    bootstrap_secret: z.string().min(1).max(2_000),
  })
  .strict()

export function adminEnrollmentStart(runtime: AuthenticationRouteRuntime): RequestHandler {
  const startEnrollment = start(runtime, "ADMIN_ENROLLMENT")
  return async (request, response, next) => {
    const body = bodySchema.safeParse(request.body)
    if (!body.success || !runtime.verifyBootstrapSecret(body.data.bootstrap_secret)) {
      try {
        await runtime.writeBootstrapDenial("invalid_secret")
      } catch (error) {
        next(error)
        return
      }
      response.status(403).json({ error: "Administrator enrollment was denied." })
      return
    }
    startEnrollment(request, response, next)
  }
}
