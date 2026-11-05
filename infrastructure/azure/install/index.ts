import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { parseConfig } from "../../installer/config/index.ts"
import type { DeploymentConfig, InstallerUI, RunCommand } from "../../installer/types.ts"
import { terraformModule } from "../../terraform/index.ts"
import { prepareBackend } from "./backend/index.ts"
import { publishImage } from "./image/index.ts"
import { acquireLease } from "./lease/index.ts"
import { verifyAzureTarget } from "./preflight/index.ts"
import { provisionDatabase } from "./provision/index.ts"
import { installationSecrets } from "./secrets/index.ts"
import { installationNames } from "./settings.ts"
import { verifyInstallationGroup } from "./group/index.ts"
import { recoverLease } from "./lease/recover/index.ts"
import type { AzureInstallation, Foundation, Installation } from "./types.ts"

export async function installAzure(
  input: DeploymentConfig,
  {
    directory,
    run,
    ui,
    saveNpmRegistry,
  }: {
    directory: string
    run: RunCommand
    ui: InstallerUI
    saveNpmRegistry?(registry: string): Promise<void>
  },
): Promise<string> {
  const config = parseConfig(input)
  await verifyAzureTarget(config, run)
  const env: NodeJS.ProcessEnv = {
    ARM_SUBSCRIPTION_ID: config.azure.subscriptionId,
    ARM_TENANT_ID: config.azure.tenantId,
    ARM_USE_CLI: "true",
    ARM_USE_OIDC: "false",
    ARM_CLIENT_ID: undefined,
    ARM_CLIENT_SECRET: undefined,
    ARM_CLIENT_CERTIFICATE_PATH: undefined,
    ARM_OIDC_TOKEN: undefined,
  }
  const context: AzureInstallation = {
    config,
    directory,
    run,
    ui,
    env,
    saveNpmRegistry,
    azure: (...args) =>
      run("az", [
        ...args,
        "--subscription",
        config.azure.subscriptionId,
        "--only-show-errors",
        "--output",
        "json",
      ]),
  }
  const { azure } = context
  const names = installationNames(config)
  await ui.phase?.("review")
  ui.status(
    `Target: ${config.azure.subscriptionId} / ${config.azure.location}. App group: ${config.azure.resourceGroup}. State group: ${names.stateGroup}. Foundation group: ${names.foundationGroup}.`,
  )
  ui.status(
    `State access: Azure authentication and Blob data permissions, without IP restrictions. npm registry: ${config.npmRegistry ?? "npm default"}. ACR: ${names.registry}. Key Vault: ${names.vault}.`,
  )
  ui.status(
    "This creates billable PostgreSQL, Container Apps, Blob Storage, ACR, Key Vault and logs. It is not high availability, and this Hub has no sign-in or hosted review features yet.",
  )
  ui.notice?.(
    "warning",
    `Target: ${config.azure.subscriptionId} / ${config.azure.location}. App group: ${config.azure.resourceGroup}. State group: ${names.stateGroup}. Foundation group: ${names.foundationGroup}.\nThis creates billable PostgreSQL, Container Apps, Blob Storage, ACR, Key Vault and logs, publishes an image, and requires a maintenance window. Hub has no sign-in or hosted review features yet.`,
  )
  if (
    !(await ui.confirm(
      "Authorize resource creation, role assignments, image publication, and a maintenance-window deployment in this subscription?",
    ))
  ) {
    throw new Error("Installation cancelled before cloud changes.")
  }
  await ui.phase?.("provision")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (const namespace of [
    "Microsoft.App",
    "Microsoft.OperationalInsights",
    "Microsoft.Network",
    "Microsoft.Storage",
    "Microsoft.DBforPostgreSQL",
    "Microsoft.ManagedIdentity",
    "Microsoft.ContainerRegistry",
    "Microsoft.KeyVault",
  ]) {
    ui.status(`Checking Azure provider ${namespace}`)
    while (true) {
      const provider = JSON.parse(await azure("provider", "show", "--namespace", namespace)) as {
        registrationState: string
      }
      if (provider.registrationState === "Registered") break
      try {
        await azure("provider", "register", "--namespace", namespace, "--wait")
      } catch {
        await ui.wait(
          `An administrator must register ${namespace} in subscription ${config.azure.subscriptionId}. Complete that action, then continue to recheck.`,
        )
      }
    }
  }
  ui.status("Preparing protected Terraform state")
  const state = await prepareBackend(context)
  const lock = await acquireLease(
    context,
    state.account,
    "terraform",
    `${config.name}/installer.lock`,
    true,
  )
  try {
    const infrastructure = resolve(import.meta.dirname, "../..")
    const module = (name: string, path: string, environment = env) =>
      terraformModule({
        directory: path,
        dataDirectory: join(directory, "terraform", name),
        run,
        ui,
        env: environment,
      })
    await verifyInstallationGroup(context, names.foundationGroup)
    await verifyInstallationGroup(context, config.azure.resourceGroup)
    const foundation = module("foundation", join(infrastructure, "azure", "foundation"))
    await foundation.init(await state.backend("foundation"))
    if (
      JSON.parse(await azure("group", "exists", "--name", names.foundationGroup)) &&
      !(await foundation.state()).length
    ) {
      throw new Error(
        "The foundation group exists without matching Terraform state. Review import/recovery instead of adopting it.",
      )
    }
    const foundationVariables = join(directory, "foundation.tfvars.json")
    await writeFile(
      foundationVariables,
      JSON.stringify({
        subscription_id: config.azure.subscriptionId,
        tenant_id: config.azure.tenantId,
        name: config.name,
        owner: config.owner,
        location: config.azure.location,
        registry_name: names.registry,
        vault_name: names.vault,
      }),
      { mode: 0o600 },
    )
    ui.status("Preparing registry and Key Vault")
    await foundation.apply(foundationVariables)
    const resources = await foundation.output<Foundation>("installation")
    const secrets = await installationSecrets(context, resources)
    env.TF_VAR_postgres_admin_password = secrets.adminPassword
    ui.status("Building and publishing the Hub image")
    const image = await publishImage(context, resources)
    ui.status(`Image: ${image}`)
    const app = module("app", join(infrastructure, "azure"))
    const appBackend = await state.backend("app")
    await app.init(appBackend)
    const appState = await app.state()
    if (
      JSON.parse(await azure("group", "exists", "--name", config.azure.resourceGroup)) &&
      !appState.length
    ) {
      throw new Error(
        "The app group exists without matching Terraform state. Review import/recovery first.",
      )
    }
    const appCreated = appState.includes("azurerm_container_app.hub[0]")
    const variables = join(directory, "installation.tfvars.json")
    const inputs = {
      subscription_id: config.azure.subscriptionId,
      name: config.name,
      owner: config.owner,
      location: config.azure.location,
      resource_group_name: config.azure.resourceGroup,
      grant_deployment_storage_access: true,
      image,
      deploy_hub: appCreated,
      acr_id: resources.registry_id,
      runtime_database_secret: { key_vault_id: resources.vault_id, secret_id: secrets.runtimeUrl },
      setup_database_secret: { key_vault_id: resources.vault_id, secret_id: secrets.migrationUrl },
    }
    await writeFile(variables, JSON.stringify(inputs), { mode: 0o600 })
    if (!appCreated) {
      ui.status("Bootstrapping infrastructure with Hub stopped")
      await app.apply(variables)
    } else if (!(await secrets.provisioned())) {
      throw new Error(
        "An app exists without the wizard's database provisioning marker. Review ownership; do not provision database roles again.",
      )
    }
    const installation = await app.output<Installation>("installation")
    if (installation.postgres_host !== `${config.name}-postgres.postgres.database.azure.com`) {
      throw new Error(
        "The database hostname differs from the installation's stored credential URLs.",
      )
    }
    ui.status("Checking private-network database initialization")
    await provisionDatabase(
      context,
      installation,
      resources,
      secrets,
      image,
      await state.backend("provision"),
    )
    ui.notice?.(
      "warning",
      `Release ${image} in subscription ${config.azure.subscriptionId}. Hub will be unavailable while all old revisions stop and setup runs. This requires fresh maintenance-window approval.`,
    )
    if (
      !(await ui.confirm(
        "Stop all Hub revisions, run setup, and release this image? Hub will be unavailable during this maintenance window.",
      ))
    ) {
      throw new Error(
        "Release cancelled. Infrastructure remains provisioned; the installation lock is retained for review.",
      )
    }
    await ui.phase?.("release")
    await recoverLease(context, installation.storage_account, "releases", "deployment.lock")
    ui.status("Running the serialized maintenance-window release")
    try {
      await run(
        process.execPath,
        [
          join(infrastructure, "azure", "deploy-hub", "index.ts"),
          "release",
          "--subscription",
          config.azure.subscriptionId,
          "--backend",
          appBackend,
          "--variables",
          variables,
          "--image",
          image,
          "--accept-maintenance",
        ],
        { env: { ...env, TF_DATA_DIR: join(directory, "terraform", "app") } },
      )
    } catch (error) {
      ui.notice?.(
        "error",
        `Release failed. Review ${installation.storage_account}/releases/deployment.lock and the installation lease before retrying.`,
      )
      ui.status(
        `Release failed. Check whether ${installation.storage_account}/releases/deployment.lock is retained; follow the release recovery procedure before retrying.`,
      )
      throw error
    }
    await ui.phase?.("verify")
    const released = await app.output<Installation>("installation")
    if (!released.url?.startsWith("https://"))
      throw new Error("Release did not return an HTTPS endpoint.")
    await lock.release()
    return released.url
  } finally {
    delete env.TF_VAR_postgres_admin_password
    lock.reportRetained()
  }
}
