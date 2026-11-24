import { parseArgs } from "node:util"

import { createArtifactStorage } from "../../../domains/artifacts/create-artifact-storage/index.ts"
import { createConfiguredArtifactStorage } from "../../../domains/artifacts/create-configured-artifact-storage/index.ts"
import { publishGitHubBuildPreview } from "../../../domains/private-preview/publish-github-build-preview/index.ts"
import { readPrivatePreviewWriterSettings } from "../../../domains/private-preview/read-writer-settings/index.ts"
import { logLevels } from "../../../integrations/pino/constants.ts"
import { createLogger } from "../../../integrations/pino/create-logger/index.ts"
import { findPrivatePreviewTarget } from "../../../repositories/private-previews/find-private-preview-target/index.ts"
import { privatePreviewAddress } from "../../../utils/private-preview-address/index.ts"

export async function runPrivatePreviewReplay(args: string[]) {
  function fail(message: string) {
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }

  const usage = "Specify one --repository-id, one owning --run-id, and one --build-id."
  const input = (() => {
    try {
      return parseArgs({
        args,
        options: {
          "repository-id": { type: "string" },
          "run-id": { type: "string" },
          "build-id": { type: "string" },
        },
        tokens: true,
      })
    } catch (error) {
      if (
        error instanceof TypeError &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code.startsWith("ERR_PARSE_ARGS_")
      ) {
        return null
      }
      throw error
    }
  })()
  const address = privatePreviewAddress(
    input?.values["repository-id"] ?? "",
    input?.values["run-id"] ?? "",
  )
  const buildId = input?.values["build-id"]?.toLowerCase()
  if (
    !address ||
    input?.tokens.length !== 3 ||
    !buildId ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(buildId)
  ) {
    fail(usage)
    return
  }

  const level = logLevels.find((candidate) => candidate === (process.env.LOG_LEVEL ?? "info"))
  if (!level) {
    fail("LOG_LEVEL must be trace, debug, info, warn, error, fatal, or silent.")
    return
  }
  const logger = createLogger({ level, destination: process.stderr })

  let step = "read writer settings"
  try {
    const preview = readPrivatePreviewWriterSettings(process.env)
    if (preview?.repositoryId !== address.repositoryId) {
      fail("Private preview publication is disabled or not configured for this repository.")
      return
    }
    step = "find the pending Build"
    const { prisma } = await import("../../../integrations/prisma/index.ts")
    try {
      const pending = await findPrivatePreviewTarget(prisma, address, "pending")
      if (pending?.buildId === buildId) {
        step = "publish the retained package"
        await publishGitHubBuildPreview(
          {
            database: prisma,
            logger,
            storage: await createConfiguredArtifactStorage(process.env),
            privatePreviewWriter: {
              repositoryId: preview.repositoryId,
              storage: await createArtifactStorage(preview.storage),
            },
          },
          buildId,
          address,
        )
      }
      step = "confirm publication"
      const ready = await findPrivatePreviewTarget(prisma, address)
      if (ready?.buildId !== buildId) {
        fail("No ready private preview for this exact Build and owning run; verify the target.")
        return
      }
    } finally {
      await prisma.$disconnect()
    }
    process.stdout.write(`${JSON.stringify({ buildId, runId: address.runId, status: "ready" })}\n`)
  } catch {
    fail(
      `Private preview replay failed at step: ${step}. Check runtime configuration, service access, and publication logs.`,
    )
  }
}
