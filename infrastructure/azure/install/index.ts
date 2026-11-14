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
import { deploymentResult } from "./result/index.ts"
import type { AzureInstallation, DeploymentResult, Foundation, Installation } from "./types.ts"
import { openInstallationWorkspace } from "./workspace/index.ts"
import { readInstallationInputs } from "./inputs/index.ts"
import { approveDeployment } from "./approval/index.ts"
import { retryableProvisioningFailure } from "./retryable-provisioning-failure/index.ts"
import { createPostgresAvailability } from "./postgres-availability/index.ts"
import { guidedPostgresProfile, type PostgresAvailability } from "./profile.ts"
import {
  privateDirectory,
  privateFile,
  writePrivateFile,
} from "../../installer/private-files/index.ts"

export async function installAzure(
  input: DeploymentConfig,
  {
    directory,
    run,
    ui,
    saveNpmRegistry,
    signal,
    availability,
  }: {
    directory: string
    run: RunCommand
    ui: InstallerUI
    saveNpmRegistry?(registry: string): Promise<void>
    signal?: AbortSignal
    availability?: PostgresAvailability
  },
): Promise<DeploymentResult> {
  signal?.throwIfAborted()
  const execute: RunCommand = signal
    ? (executable, args, options) => {
        signal.throwIfAborted()
        return run(executable, args, { ...options, signal })
      }
    : run
  const config = parseConfig(input)
  await verifyAzureTarget(config, execute)
  const workspace = await openInstallationWorkspace(config, directory)
  try {
    signal?.throwIfAborted()
    return await install(config, {
      directory: workspace.directory,
      run: execute,
      ui,
      saveNpmRegistry,
      signal,
      availability,
    })
  } finally {
    await workspace.close()
  }
}

async function install(
  config: DeploymentConfig,
  {
    directory,
    run,
    ui,
    saveNpmRegistry,
    signal,
    availability = createPostgresAvailability(run),
  }: {
    directory: string
    run: RunCommand
    ui: InstallerUI
    saveNpmRegistry?(registry: string): Promise<void>
    signal?: AbortSignal
    availability?: PostgresAvailability
  },
): Promise<DeploymentResult> {
  const operatorInputs = await readInstallationInputs(directory, config)
  const postgres = {
    postgres_sku: operatorInputs.postgres_sku ?? guidedPostgresProfile.postgres_sku,
    postgres_version: operatorInputs.postgres_version ?? guidedPostgresProfile.postgres_version,
  }
  ui.status(`Checking PostgreSQL SKU/version support in ${config.azure.location}.`)
  const compatible = await availability(
    config.azure.subscriptionId,
    config.azure.location,
    postgres,
  )
  signal?.throwIfAborted()
  if (!compatible)
    throw new Error(
      `The configured region does not advertise PostgreSQL ${postgres.postgres_sku}, version ${postgres.postgres_version}. The target was not changed; review deployment settings or create a separate installation in another region.`,
    )
  for (const file of [
    "foundation.tfvars.json",
    "provision.tfvars.json",
    "foundation-backend.hcl",
    "app-backend.hcl",
    "provision-backend.hcl",
  ])
    await privateFile(join(directory, file))
  for (const module of ["foundation", "app", "provision"])
    await privateDirectory(join(directory, "terraform", module))
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
    signal,
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
  context.approval = await approveDeployment(context, postgres)
  signal?.throwIfAborted()
  await ui.phase?.("provision")
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
        preapproved: true,
        retryApply: retryableProvisioningFailure,
        signal,
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
    await writePrivateFile(
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
      ...postgres,
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
    await writePrivateFile(variables, JSON.stringify({ ...inputs, ...operatorInputs }))
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
        {
          env: { ...env, TF_DATA_DIR: join(directory, "terraform", "app") },
          label: "Run the maintenance-window release",
        },
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
    const result = deploymentResult({
      config,
      installation: released,
      foundation: resources,
      stateStorageId: state.id,
      image,
    })
    await lock.release()
    return result
  } finally {
    delete env.TF_VAR_postgres_admin_password
    lock.reportRetained()
  }
}
