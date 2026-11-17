import type { Request, Response } from "express"

import { bootstrapSecretHeader } from "../authorize-github-setup/index.ts"
import type { GitHubSetupCaller, GitHubSetupRouteDependencies } from "../types.ts"

/** Rechecks the same caller without charging another bootstrap attempt. */
export async function recheckGitHubSetupAuthority(
  request: Request,
  response: Response,
  dependencies: GitHubSetupRouteDependencies,
  caller: GitHubSetupCaller,
) {
  const current = await dependencies.authorize({
    bootstrapSecret: request.get(bootstrapSecretHeader),
    sessionDigest: caller.sessionDigest,
  })
  if (current.allowed && current.membershipId === caller.membershipId) return true

  response.status(403).json({
    error: "Administrator access is required.",
    requires: "administrator",
  })
  return false
}
