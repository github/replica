import "dotenv/config"
import { parseArgs } from "node:util"

import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { checkGitHubWebhookCommunication } from "../../domains/github-webhooks/check-github-webhook-communication/index.ts"
import { logger } from "../../integrations/pino/index.ts"

try {
  const { values } = parseArgs({
    options: {
      "repository-id": { type: "string" },
      "run-id": { type: "string" },
      "delivery-guid": { type: "string" },
    },
  })
  const githubRepositoryId = Number(values["repository-id"])
  const runId = Number(values["run-id"])
  const deliveryGuid = values["delivery-guid"]
  const applicationOrigin = process.env.HUB_APPLICATION_ORIGIN
  if (
    ![githubRepositoryId, runId].every((id) => Number.isSafeInteger(id) && id > 0) ||
    !applicationOrigin ||
    (deliveryGuid && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deliveryGuid))
  ) {
    throw new Error(
      "Provide --repository-id, --run-id, and HUB_APPLICATION_ORIGIN; --delivery-guid is optional.",
    )
  }
  const credentials = readGitHubAppConfiguration(process.env).appCredentials
  if (!credentials) throw new Error("GitHub App installation settings are incomplete or invalid.")
  const database = deliveryGuid
    ? (await import("../../integrations/prisma/index.ts")).prisma
    : undefined
  try {
    const checks = await checkGitHubWebhookCommunication({
      credentials,
      applicationOrigin,
      githubRepositoryId,
      runId,
      deliveryGuid,
      database,
    })
    logger.info({ checks }, "GitHub webhook communication checks finished")
    if (checks.some((check) => check.result === "fail")) process.exitCode = 1
  } finally {
    await database?.$disconnect()
  }
} catch (error) {
  logger.error(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "GitHub webhook communication checks failed; check arguments, configuration, and database access",
  )
  process.exitCode = 1
}
