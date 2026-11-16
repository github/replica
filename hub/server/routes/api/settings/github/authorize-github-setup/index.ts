import { createHash } from "node:crypto"
import type { Request, Response } from "express"

import { hashAuthenticationValue } from "../../../../../domains/authentication/hash-authentication-value/index.ts"
import { hubSessionCookieName } from "../../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../../integrations/express/read-cookie/index.ts"
import type { GitHubSetupRouteDependencies } from "../types.ts"

export const bootstrapSecretHeader = "x-hub-bootstrap-secret"

/** Admits administrators, or the bootstrap secret until the first administrator exists. */
export async function authorizeGitHubSetup(
  request: Request,
  response: Response,
  dependencies: GitHubSetupRouteDependencies,
) {
  const sessionValue = readCookie(request, hubSessionCookieName)
  const bootstrapSecret = request.get(bootstrapSecretHeader)
  if (bootstrapSecret) {
    const subjectDigest = createHash("sha256")
      .update(["github_setup", request.ip ?? request.socket.remoteAddress ?? "unknown"].join(":"))
      .digest("hex")
    if (!(await dependencies.checkRateLimit("github_setup", subjectDigest))) {
      response.status(429).json({ error: "Too many setup attempts. Try again later." })
      return null
    }
  }
  const access = await dependencies.authorize({
    sessionDigest: sessionValue ? hashAuthenticationValue(sessionValue) : undefined,
    bootstrapSecret,
  })
  if (!access.allowed) {
    response.status(403).json({
      error:
        access.requires === "bootstrap"
          ? "Enter the bootstrap secret to view GitHub setup."
          : "Administrator access is required.",
      requires: access.requires,
    })
    return null
  }
  return access
}
