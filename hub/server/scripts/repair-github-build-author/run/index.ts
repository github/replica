import { parseArgs } from "node:util"

import { readGitHubAppConfiguration } from "../../../domains/authentication/read-github-app-configuration/index.ts"
import { repairGitHubBuildAuthor } from "../../../domains/github-builds/repair-github-build-author/index.ts"
import { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import { logger } from "../../../integrations/pino/index.ts"
import { GitHubMaintenanceInputError } from "../../github-maintenance-errors.ts"
import { presentGitHubMaintenanceFailure } from "../../present-github-maintenance-failure/index.ts"

export async function runGitHubBuildAuthorRepair(args: string[]) {
  try {
    function parseArguments() {
      try {
        return parseArgs({
          args,
          options: {
            "repository-id": { type: "string" },
            "build-id": { type: "string" },
            apply: { type: "boolean", default: false },
          },
        })
      } catch (error) {
        if (
          error instanceof TypeError &&
          "code" in error &&
          typeof error.code === "string" &&
          error.code.startsWith("ERR_PARSE_ARGS_")
        ) {
          throw new GitHubMaintenanceInputError("repair-usage")
        }
        throw error
      }
    }
    const { values } = parseArguments()
    const githubRepositoryId = Number(values["repository-id"])
    const buildId = values["build-id"]
    if (
      !Number.isSafeInteger(githubRepositoryId) ||
      githubRepositoryId <= 0 ||
      !buildId ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(buildId)
    ) {
      throw new GitHubMaintenanceInputError("repair-usage")
    }
    const credentials = readGitHubAppConfiguration(process.env).appCredentials
    if (!credentials) throw new GitHubMaintenanceInputError("configuration")
    const { prisma } = await import("../../../integrations/prisma/index.ts")
    try {
      const result = await repairGitHubBuildAuthor(
        {
          database: prisma,
          client: createGitHubActionsClient({ ...credentials, githubRepositoryId }),
          logger,
        },
        { githubRepositoryId, buildId, apply: values.apply },
      )
      process.stdout.write(`${JSON.stringify({ buildId, ...result })}\n`)
      if (result.status === "unavailable") process.exitCode = 1
    } finally {
      await prisma.$disconnect()
    }
  } catch (error) {
    process.stderr.write(`${presentGitHubMaintenanceFailure(error)}\n`)
    process.exitCode = 1
  }
}
