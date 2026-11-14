import type { AzureEntrypoint, AzureSecretConfiguration } from "./types.ts"

export function parseAzureSecretConfiguration(
  environment: Readonly<NodeJS.ProcessEnv>,
  target: AzureEntrypoint,
): AzureSecretConfiguration {
  function invalid() {
    return new Error("Azure startup secret configuration is invalid.")
  }
  const clientId = environment.AZURE_CLIENT_ID
  const input = environment.AZURE_KEY_VAULT_SECRET_REFERENCES
  if (
    !["runtime", "setup", "provision"].includes(target) ||
    !clientId ||
    !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(clientId) ||
    !input ||
    Buffer.byteLength(input, "utf8") > 65_536
  ) {
    throw invalid()
  }
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    throw invalid()
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid()
  const entries = Object.entries(value)
  const names = entries.map(([name]) => name)
  const required =
    target === "provision"
      ? ["DATABASE_URL", "HUB_MIGRATION_PASSWORD", "HUB_RUNTIME_PASSWORD"]
      : ["DATABASE_URL"]
  const reserved = new Set([
    "AZURE_CLIENT_ID",
    "AZURE_KEY_VAULT_SECRET_REFERENCES",
    "DATABASE_RUNTIME_ROLE",
    "NODE_ENV",
    "RUNTIME_MODE",
    "HOST",
    "PORT",
    "CLIENT_DIRECTORY",
    "SHUTDOWN_TIMEOUT_MS",
    "ARTIFACT_STORAGE_PROVIDER",
    "ARTIFACT_STORAGE_DIRECTORY",
    "AZURE_STORAGE_ACCOUNT",
    "AZURE_STORAGE_CONTAINER",
  ])
  if (
    !entries.length ||
    entries.length > 64 ||
    required.some((name) => !names.includes(name)) ||
    (target !== "runtime" && names.some((name) => !required.includes(name)))
  ) {
    throw invalid()
  }
  const references: Record<string, string> = {}
  for (const [name, url] of entries) {
    if (
      !/^[A-Z][A-Z0-9_]{0,40}$/.test(name) ||
      reserved.has(name) ||
      environment[name] !== undefined ||
      typeof url !== "string" ||
      !/^https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]+(?:\/[a-fA-F0-9]{32})?$/.test(
        url,
      ) ||
      (target === "provision" && new URL(url).pathname.split("/").length !== 4)
    ) {
      throw invalid()
    }
    references[name] = url
  }
  return { managedIdentityClientId: clientId.toLowerCase(), references }
}
