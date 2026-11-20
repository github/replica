import { parseArgs } from "node:util"

import { readGitHubAppConfiguration } from "../../../domains/authentication/read-github-app-configuration/index.ts"
import { checkGitHubWebhookCommunication } from "../../../domains/github-webhooks/check-github-webhook-communication/index.ts"
import { GitHubMaintenanceInputError } from "../../github-maintenance-errors.ts"
import { presentGitHubMaintenanceFailure } from "../../present-github-maintenance-failure/index.ts"

export async function runGitHubWebhookCheck(args: string[]) {
  try {
    function parseArguments() {
      try {
        return parseArgs({
          args,
          options: {
            "repository-id": { type: "string" },
            "run-id": { type: "string" },
            "delivery-guid": { type: "string" },
          },
        })
      } catch (error) {
        if (
          error instanceof TypeError &&
          "code" in error &&
          typeof error.code === "string" &&
          error.code.startsWith("ERR_PARSE_ARGS_")
        ) {
          throw new GitHubMaintenanceInputError("webhook-usage")
        }
        throw error
      }
    }
    const { values } = parseArguments()
    const githubRepositoryId = Number(values["repository-id"])
    const runId = Number(values["run-id"])
    const deliveryGuid = values["delivery-guid"]
    const applicationOrigin = process.env.HUB_APPLICATION_ORIGIN
    if (
      ![githubRepositoryId, runId].every((id) => Number.isSafeInteger(id) && id > 0) ||
      !applicationOrigin ||
      (deliveryGuid && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deliveryGuid))
    ) {
      throw new GitHubMaintenanceInputError("webhook-usage")
    }
    const credentials = readGitHubAppConfiguration(process.env).appCredentials
    if (!credentials) throw new GitHubMaintenanceInputError("configuration")
    const database = deliveryGuid
      ? (await import("../../../integrations/prisma/index.ts")).prisma
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
      process.stdout.write(`${JSON.stringify({ checks })}\n`)
      if (checks.some((check) => check.result === "fail")) process.exitCode = 1
    } finally {
      await database?.$disconnect()
    }
  } catch (error) {
    process.stderr.write(`${presentGitHubMaintenanceFailure(error)}\n`)
    process.exitCode = 1
  }
}
