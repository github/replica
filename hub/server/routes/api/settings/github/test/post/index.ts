import { createHash } from "node:crypto"
import type { RequestHandler } from "express"

import { authorizeGitHubSetup } from "../../authorize-github-setup/index.ts"
import type { GitHubConnectionCheck } from "../../../../../../integrations/github/test-github-app-connection/types.ts"
import type { GitHubSetupRouteDependencies } from "../../types.ts"

const listedNames = 5

/** Syncs the installation's repositories. A failed sync keeps the existing list. */
async function syncRepositoriesCheck(
  dependencies: GitHubSetupRouteDependencies,
): Promise<GitHubConnectionCheck> {
  let names: string[]
  try {
    names = await dependencies.syncRepositories()
  } catch {
    return {
      name: "repositories",
      result: "unknown",
      detail: "GitHub could not list the installation's repositories. The previous list is kept.",
    }
  }
  if (!names.length) {
    return {
      name: "repositories",
      result: "fail",
      detail:
        "The App cannot read any repositories. Choose repositories in the installation settings.",
    }
  }
  const shown = names.slice(0, listedNames).join(", ")
  const more = names.length > listedNames ? `, and ${names.length - listedNames} more` : ""
  return {
    name: "repositories",
    result: "pass",
    detail: `Hub can read ${names.length} ${names.length === 1 ? "repository" : "repositories"}: ${shown}${more}.`,
  }
}

export function post(dependencies: GitHubSetupRouteDependencies): RequestHandler {
  return async (request, response, next) => {
    try {
      const access = await authorizeGitHubSetup(request, response, dependencies)
      if (!access) return
      const subjectDigest = createHash("sha256")
        .update(["github_test", access.membershipId ?? request.ip ?? "unknown"].join(":"))
        .digest("hex")
      if (!(await dependencies.checkRateLimit("github_test", subjectDigest))) {
        response.status(429).json({ error: "Too many connection tests. Try again in a minute." })
        return
      }
      const checks = await dependencies.testConnection()
      if (!checks) {
        response.status(409).json({
          error: "Add every GitHub App setting and restart Hub before testing the connection.",
        })
        return
      }
      if (
        checks.some((check) => check.name === "installation" && check.result === "pass") &&
        !checks.some((check) => check.name === "app_identity" && check.result === "fail")
      ) {
        checks.push(await syncRepositoriesCheck(dependencies))
      }
      await dependencies.writeTestAudit({
        actorMembershipId: access.membershipId,
        failedChecks: checks.filter((check) => check.result === "fail").map((check) => check.name),
      })
      response.json({ checks })
    } catch (error) {
      next(error)
    }
  }
}
