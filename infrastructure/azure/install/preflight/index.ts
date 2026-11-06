import type { DeploymentConfig, InstallerUI, RunCommand } from "../../../installer/types.ts"
import { parseAzureId } from "../../../installer/config/fields/index.ts"

export async function azurePreflight(run: RunCommand, ui: InstallerUI) {
  for (const [executable, args, instructions] of [
    [
      "az",
      ["version"],
      "Install Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli",
    ],
    [
      "terraform",
      ["version", "-json"],
      "Install Terraform >= 1.13.0 and < 2.0.0: https://developer.hashicorp.com/terraform/install",
    ],
    [
      "docker",
      ["info"],
      "Install and start Docker: https://docs.docker.com/get-started/get-docker/",
    ],
    [
      "docker",
      ["buildx", "version"],
      "Install the Docker Buildx plugin: https://docs.docker.com/build/install-buildx/",
    ],
    [
      "az",
      ["containerapp", "job", "start", "--help"],
      "Update Azure CLI/its Container Apps extension to support jobs: https://learn.microsoft.com/azure/container-apps/jobs",
    ],
  ] as const) {
    while (true) {
      try {
        const output = await run(executable, [...args])
        if (executable === "terraform") {
          const version = JSON.parse(output) as { terraform_version: string }
          const stable =
            /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
              version.terraform_version,
            )
          if (!stable || Number(stable[1]) < 13) {
            throw new Error("Terraform >= 1.13.0 and < 2.0.0 is required by these modules.")
          }
        }
        break
      } catch {
        await ui.wait(`${instructions}\nComplete this prerequisite, then continue to recheck it.`)
      }
    }
  }
  while (true) {
    const accounts = JSON.parse(
      await run("az", ["account", "list", "--output", "json", "--only-show-errors"]),
    ) as {
      id: string
      tenantId: string
      tenantDisplayName?: string
      tenantDefaultDomain?: string
      name: string
      state: string
    }[]
    const enabled = accounts.filter(
      ({ state, name }) => state === "Enabled" && name !== "N/A(tenant level account)",
    )
    if (enabled.length)
      return enabled.map((account) => ({
        ...account,
        id: parseAzureId(account.id),
        tenantId: parseAzureId(account.tenantId),
      }))
    await ui.wait(
      "No enabled deployment subscriptions are available. Sign in in a separate terminal with az login (or az login --tenant TENANT_ID for another directory), then continue to reload subscriptions. Tenant-only sign-in is not a deployment target. Sign-in is not automated.",
    )
  }
}

export async function verifyAzureTarget(config: DeploymentConfig, run: RunCommand) {
  const account = JSON.parse(
    await run("az", [
      "account",
      "show",
      "--subscription",
      config.azure.subscriptionId,
      "--output",
      "json",
    ]),
  ) as { id: string; tenantId: string }
  if (
    parseAzureId(account.id) !== parseAzureId(config.azure.subscriptionId) ||
    parseAzureId(account.tenantId) !== parseAzureId(config.azure.tenantId)
  ) {
    throw new Error(
      "Azure returned a different subscription or tenant. Check installation configuration.",
    )
  }
}
