import { ManagedIdentityCredential } from "@azure/identity"

import { getAzureKeyVaultSecret } from "../../../integrations/azure-key-vault/get-secret-value/index.ts"
import { parseAzureSecretConfiguration } from "../../../utils/parse-azure-secret-configuration/index.ts"
import type { AzureEntrypoint } from "../../../utils/parse-azure-secret-configuration/types.ts"

export async function loadAzureSecretEnvironment(
  environment: NodeJS.ProcessEnv,
  target: AzureEntrypoint,
): Promise<void> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let stopWaiting: (() => void) | undefined
  function stop() {
    controller.abort()
  }
  try {
    const configuration = parseAzureSecretConfiguration(environment, target)
    const credential = new ManagedIdentityCredential({
      clientId: configuration.managedIdentityClientId,
    })
    timeout = setTimeout(stop, 30_000)
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    const aborted = new Promise<never>((_, reject) => {
      stopWaiting = () => reject(new Error("Azure startup secret loading was cancelled."))
      controller.signal.addEventListener("abort", stopWaiting, { once: true })
    })
    const values = await Promise.race([
      aborted,
      Promise.all(
        Object.entries(configuration.references).map(
          async ([name, url]): Promise<[string, string]> => [
            name,
            await getAzureKeyVaultSecret({ url, credential, signal: controller.signal }),
          ],
        ),
      ),
    ])
    controller.signal.throwIfAborted()
    if (values.some(([name]) => environment[name] !== undefined)) {
      throw new Error("Azure startup environment changed during secret loading.")
    }
    for (const [name, value] of values) {
      environment[name] = value
    }
  } catch {
    controller.abort()
    const error = new Error("Azure startup secret loading failed.")
    error.name = "AzureSecretStartupError"
    throw error
  } finally {
    clearTimeout(timeout)
    if (stopWaiting) controller.signal.removeEventListener("abort", stopWaiting)
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}
