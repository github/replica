import type { AzureInstallation } from "../../types.ts"

export async function readBlobLease(
  context: Pick<AzureInstallation, "azure">,
  account: string,
  container: string,
  blob: string,
): Promise<unknown> {
  return JSON.parse(
    await context.azure(
      "storage",
      "blob",
      "show",
      "--account-name",
      account,
      "--container-name",
      container,
      "--name",
      blob,
      "--auth-mode",
      "login",
      "--query",
      "properties.lease",
    ),
  ) as unknown
}
