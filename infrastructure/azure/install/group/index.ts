import type { AzureInstallation } from "../types.ts"

export async function verifyInstallationGroup(context: AzureInstallation, name: string) {
  const { azure, config } = context
  const exists: unknown = JSON.parse(await azure("group", "exists", "--name", name))
  if (exists === false) return false
  if (exists !== true) throw new Error("Azure did not return resource group existence.")
  const group = JSON.parse(await azure("group", "show", "--name", name)) as {
    tags?: Record<string, string>
  }
  const expected = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  if (Object.entries(expected).some(([key, value]) => group?.tags?.[key] !== value))
    throw new Error(
      `Resource group ${name} belongs to another installation. Automatic adoption is not supported.`,
    )
  return true
}
