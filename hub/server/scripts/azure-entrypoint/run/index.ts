import { loadAzureSecretEnvironment } from "../load-secret-environment/index.ts"

export async function runAzureEntrypoint(target: string | undefined): Promise<void> {
  const maintenance =
    target === "repair-github-build-author" ||
    target === "check-github-webhooks" ||
    target === "replay-private-preview"
  if (
    !maintenance &&
    target !== "runtime" &&
    target !== "setup" &&
    target !== "provision" &&
    target !== "provision-learning"
  ) {
    throw new Error("Azure entrypoint target is invalid.")
  }
  const environment = process.env
  if (
    ((target === "runtime" || maintenance) && environment.RUNTIME_MODE === "setup") ||
    (target === "setup" && environment.RUNTIME_MODE !== "setup")
  ) {
    throw new Error("Azure entrypoint and runtime mode disagree.")
  }
  if (target === "runtime") {
    await loadAzureSecretEnvironment(environment, "runtime")
    await import("../../../index.ts")
  } else if (maintenance) {
    await loadAzureSecretEnvironment(environment, "runtime")
    if (target === "repair-github-build-author") {
      const { runGitHubBuildAuthorRepair } =
        await import("../../repair-github-build-author/run/index.ts")
      await runGitHubBuildAuthorRepair(process.argv.slice(3))
    } else if (target === "check-github-webhooks") {
      const { runGitHubWebhookCheck } = await import("../../check-github-webhooks/run/index.ts")
      await runGitHubWebhookCheck(process.argv.slice(3))
    } else {
      const { runPrivatePreviewReplay } = await import("../../replay-private-preview/run/index.ts")
      await runPrivatePreviewReplay(process.argv.slice(3))
    }
  } else if (target === "setup") {
    await loadAzureSecretEnvironment(environment, "setup")
    const { setup } = await import("../../setup/index.ts")
    await setup()
  } else if (target === "provision") {
    await loadAzureSecretEnvironment(environment, target)
    const { provisionDatabaseAccess } = await import("../../provision-database-access/index.ts")
    const { logger } = await import("../../../integrations/pino/index.ts")
    await provisionDatabaseAccess({
      databaseUrl: environment.DATABASE_URL ?? "",
      learningPassword: environment.HUB_LEARNING_PASSWORD ?? "",
      migrationPassword: environment.HUB_MIGRATION_PASSWORD ?? "",
      runtimePassword: environment.HUB_RUNTIME_PASSWORD ?? "",
    })
    logger.info("Database access provisioned")
  } else {
    await loadAzureSecretEnvironment(environment, "provision-learning")
    const { provisionLearningDatabaseAccess } =
      await import("../../provision-learning-database-access/index.ts")
    const { logger } = await import("../../../integrations/pino/index.ts")
    await provisionLearningDatabaseAccess({
      databaseUrl: environment.DATABASE_URL ?? "",
      learningPassword: environment.HUB_LEARNING_PASSWORD ?? "",
    })
    logger.info("Learning database access provisioned")
  }
}
