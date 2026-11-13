import { createHash } from "node:crypto"
import type { RequestHandler } from "express"

import type { AdministratorRouteDependencies } from "../../../../auth/types.ts"
import { readAdministratorSession } from "../../../read-administrator-session/index.ts"

export function rateLimit(
  dependencies: Pick<AdministratorRouteDependencies, "findSession" | "start">,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const session = await readAdministratorSession(request, dependencies)
      if (!session) {
        response.status(403).json({ error: "Administrator access is required." })
        return
      }
      const provider =
        session.providerKey === "github"
          ? dependencies.start.github
          : session.providerKey === "entra"
            ? dependencies.start.entra
            : session.providerKey === "local"
              ? dependencies.start.local
              : undefined
      if (!provider) {
        response.status(409).json({ error: "The session authentication provider is unavailable." })
        return
      }
      const subjectDigest = createHash("sha256")
        .update(["start", request.ip ?? request.socket.remoteAddress ?? "unknown"].join(":"))
        .digest("hex")
      if (!(await provider.checkRateLimit("start", subjectDigest)).allowed) {
        response.status(429).json({ error: "Too many authorization attempts. Try again later." })
        return
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}
