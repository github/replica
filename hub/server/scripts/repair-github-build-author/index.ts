import "dotenv/config"
import { parseArgs } from "node:util"

import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { repairGitHubBuildAuthor } from "../../domains/github-builds/repair-github-build-author/index.ts"
import { createGitHubActionsClient } from "../../integrations/github/create-github-actions-client/index.ts"
import { logger } from "../../integrations/pino/index.ts"

try {
  const { values } = parseArgs({
    options: {
      "repository-id": { type: "string" },
      "build-id": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  })
  const githubRepositoryId = Number(values["repository-id"])
  const buildId = values["build-id"]
  if (
    !Number.isSafeInteger(githubRepositoryId) ||
    githubRepositoryId <= 0 ||
    !buildId ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(buildId)
  ) {
    throw new Error("Provide --repository-id and --build-id; add --apply only to save the repair.")
  }
  const credentials = readGitHubAppConfiguration(process.env).appCredentials
  if (!credentials) throw new Error("GitHub App installation settings are incomplete or invalid.")
  const { prisma } = await import("../../integrations/prisma/index.ts")
  try {
    const result = await repairGitHubBuildAuthor(
      {
        database: prisma,
        client: createGitHubActionsClient({ ...credentials, githubRepositoryId }),
        logger,
      },
      { githubRepositoryId, buildId, apply: values.apply },
    )
    logger.info({ buildId, ...result }, "GitHub Build author repair finished")
    if (result.status === "unavailable") process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
} catch (error) {
  logger.error(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "GitHub Build author repair failed; check the scoped IDs, commit author, credentials, and database access",
  )
  process.exitCode = 1
}
