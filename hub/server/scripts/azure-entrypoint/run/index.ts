import { loadAzureSecretEnvironment } from "../load-secret-environment/index.ts"

export async function runAzureEntrypoint(target: string | undefined): Promise<void> {
  if (!["runtime", "setup", "provision"].includes(target ?? "")) {
    throw new Error("Azure entrypoint must be runtime, setup, or provision.")
  }
  const environment = process.env
  if (
    (target === "runtime" && environment.RUNTIME_MODE === "setup") ||
    (target === "setup" && environment.RUNTIME_MODE !== "setup")
  ) {
    throw new Error("Azure entrypoint and runtime mode disagree.")
  }
  if (target === "runtime") {
    await loadAzureSecretEnvironment(environment, "runtime")
    await import("../../../index.ts")
  } else if (target === "setup") {
    await loadAzureSecretEnvironment(environment, "setup")
    const { setup } = await import("../../setup/index.ts")
    await setup()
  } else {
    await loadAzureSecretEnvironment(environment, "provision")
    const { provisionDatabaseAccess } = await import("../../provision-database-access/index.ts")
    const { logger } = await import("../../../integrations/pino/index.ts")
    await provisionDatabaseAccess({
      databaseUrl: environment.DATABASE_URL ?? "",
      migrationPassword: environment.HUB_MIGRATION_PASSWORD ?? "",
      runtimePassword: environment.HUB_RUNTIME_PASSWORD ?? "",
    })
    logger.info("Database access provisioned")
  }
}
