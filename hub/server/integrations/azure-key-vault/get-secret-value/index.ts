import type { AzureKeyVaultSecretRequest } from "./types.ts"

export async function getAzureKeyVaultSecret({
  url,
  credential,
  signal,
}: AzureKeyVaultSecretRequest): Promise<string> {
  try {
    if (
      !/^https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]+(?:\/[a-fA-F0-9]{32})?$/.test(
        url,
      )
    ) {
      throw new Error("Invalid Azure secret URL.")
    }
    signal.throwIfAborted()
    const token = await credential.getToken("https://vault.azure.net/.default", {
      abortSignal: signal,
    })
    if (!token?.token) throw new Error("Azure managed identity returned no token.")
    const target = new URL(url)
    target.searchParams.set("api-version", "7.4")
    const response = await fetch(target, {
      method: "GET",
      headers: { Authorization: `Bearer ${token.token}` },
      redirect: "error",
      signal,
    })
    if (response.status !== 200) {
      await response.body?.cancel()
      throw new Error("Azure Key Vault rejected secret retrieval.")
    }
    const result: unknown = await response.json()
    if (
      result === null ||
      typeof result !== "object" ||
      !("value" in result) ||
      typeof result.value !== "string"
    ) {
      throw new Error("Azure Key Vault returned an invalid secret.")
    }
    signal.throwIfAborted()
    return result.value
  } catch {
    const error = new Error("Azure Key Vault secret retrieval failed.")
    error.name = "AzureKeyVaultSecretError"
    throw error
  }
}
