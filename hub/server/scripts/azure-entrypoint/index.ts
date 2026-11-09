import { createLogger } from "../../integrations/pino/create-logger/index.ts"
import { runAzureEntrypoint } from "./run/index.ts"

try {
  await runAzureEntrypoint(process.argv[2])
} catch (error) {
  createLogger().fatal(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "Azure startup failed; check secret references, managed identity, Key Vault access, and workload configuration",
  )
  process.exitCode = 1
}
