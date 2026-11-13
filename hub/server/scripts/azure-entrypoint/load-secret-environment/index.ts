import { ManagedIdentityCredential } from "@azure/identity"

import { getAzureKeyVaultSecret } from "../../../integrations/azure-key-vault/get-secret-value/index.ts"
import { parseAzureSecretConfiguration } from "../../../utils/parse-azure-secret-configuration/index.ts"
import type { AzureEntrypoint } from "../../../utils/parse-azure-secret-configuration/types.ts"

function retryable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AzureKeyVaultSecretError" &&
    "retryable" in error &&
    error.retryable === true
  )
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel)
      resolve()
    }, delay)
    function cancel() {
      clearTimeout(timer)
      signal.removeEventListener("abort", cancel)
      reject(new Error("Azure startup secret loading was cancelled."))
    }
    signal.addEventListener("abort", cancel, { once: true })
  })
}

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
    async function getSecret(url: string) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await getAzureKeyVaultSecret({
            url,
            credential,
            signal: controller.signal,
          })
        } catch (error) {
          controller.signal.throwIfAborted()
          if (!retryable(error) || attempt === 5) throw error
          await waitForRetry(500 * 2 ** attempt, controller.signal)
        }
      }
    }
    const values = await Promise.race([
      aborted,
      Promise.all(
        Object.entries(configuration.references).map(
          async ([name, url]): Promise<[string, string]> => [name, await getSecret(url)],
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
