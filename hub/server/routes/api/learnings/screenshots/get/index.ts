import type { RequestHandler } from "express"
import { z } from "zod"

import { readLearningSession } from "../../read-learning-session/index.ts"
import { respondLearningError } from "../../respond-learning-error/index.ts"
import type { LearningsRouteDependencies } from "../../types.ts"

const notFound = { code: "screenshot_not_found", error: "Screenshot not found." }

/**
 * Serves one agent screenshot to anyone who can read the library, only while the
 * repository still allows screenshots. Access is read again before sending the bytes.
 */
export function get(dependencies: LearningsRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const repositoryId = z.uuid().safeParse(request.params.repositoryId)
      const sha256 = z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .safeParse(request.params.sha256)
      if (!repositoryId.success || !sha256.success) {
        response.status(404).json(notFound)
        return
      }
      const initial = await readLearningSession(request, dependencies)
      if (!initial) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(initial, repositoryId.data))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      const bytes = await dependencies.readScreenshot({
        repositoryId: repositoryId.data,
        sha256: sha256.data,
      })
      const current = await readLearningSession(request, dependencies)
      if (!current || current.membershipId !== initial.membershipId) {
        response.status(401).json({ code: "sign_in_required", error: "Sign in to continue." })
        return
      }
      if (!(await dependencies.findRepository(current, repositoryId.data))) {
        response.status(404).json({ code: "repository_not_found", error: "Repository not found." })
        return
      }
      if (!bytes) {
        response.status(404).json(notFound)
        return
      }
      // Screenshots come from agents, so never let a browser run them as anything else.
      response.set({
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'",
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
      })
      response.send(Buffer.from(bytes))
    } catch (error) {
      if (!respondLearningError(response, error)) next(error)
    }
  }
}
