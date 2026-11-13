import { join } from "node:path"
import { readPrivateFile, writePrivateFile } from "../../../installer/private-files/index.ts"
import { terraformModule } from "../../../terraform/index.ts"
import { readInstallationInputs } from "../../install/inputs/index.ts"
import { installationNames } from "../../install/settings.ts"
import { parseAzureId } from "../../../installer/config/fields/index.ts"
import { writeRemovalBackend } from "../backend/index.ts"
import { stageRemovalModule } from "../stage-module/index.ts"
import { validateRemovalPlan } from "../validate-plan/index.ts"
import { validateRemovalState } from "../validate-state/index.ts"
import type { RemovalContext, RemovalModule, RemovalResource } from "../types.ts"

export async function prepareRemovalModule(
  context: RemovalContext,
  kind: RemovalModule,
  staging: string,
) {
  const { config, run, env, signal, directory } = context
  const names = installationNames(config)
  const source = join(staging, kind)
  await stageRemovalModule(kind, source)
  const { backend, data } = await writeRemovalBackend(context, kind, staging)
  let resources: RemovalResource[] = []
  const module = terraformModule({
    directory: source,
    dataDirectory: data,
    run,
    env,
    signal,
    ui: { ...context.ui, select: undefined },
    preapproved: true,
    validatePlan: (plan) => validateRemovalPlan(plan, resources),
  })
  await module.init(backend)
  resources = validateRemovalState(
    JSON.parse(
      await run("terraform", [`-chdir=${source}`, "show", "-json"], {
        env: { ...env, TF_DATA_DIR: data },
        signal,
      }),
    ) as unknown,
    config,
    kind,
  )
  const filename = kind === "app" ? "installation.tfvars.json" : `${kind}.tfvars.json`
  const original =
    kind === "foundation" || !resources.length
      ? undefined
      : await readPrivateFile(join(directory, filename), { createDirectory: false })
  let variables: Record<string, unknown> = {
    subscription_id: config.azure.subscriptionId,
    name: config.name,
    location: config.azure.location,
  }
  if (kind === "foundation") {
    variables = {
      ...variables,
      tenant_id: config.azure.tenantId,
      owner: config.owner,
      registry_name: names.registry,
      vault_name: names.vault,
    }
  } else if (resources.length) {
    if (original === undefined)
      throw new Error("Removal needs the saved generated module inputs; they were not replaced.")
    const parsed: unknown = JSON.parse(original)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Removal inputs are invalid; existing files were preserved.")
    variables = parsed as Record<string, unknown>
    const group = kind === "app" ? variables.resource_group_name : variables.resource_group
    if (
      parseAzureId(variables.subscription_id) !== config.azure.subscriptionId ||
      variables.name !== config.name ||
      variables.location !== config.azure.location ||
      typeof group !== "string" ||
      group.toLowerCase() !== config.azure.resourceGroup.toLowerCase()
    )
      throw new Error("Removal inputs do not match the selected deployment identity.")
    if (kind === "app") {
      await readInstallationInputs(directory, config)
      variables = {
        ...variables,
        deploy_hub: resources.some(({ address }) => address === "azurerm_container_app.hub[0]"),
        // Destroy-only plans must contain no creates or updates; the real password is not needed.
        postgres_admin_password: "Replica-destroy-only-not-a-real-password-1!",
      }
    } else {
      const foundation = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}`
      const environment = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`
      if (
        Object.entries({
          environment_id: environment,
          vault_id: `${foundation}/providers/Microsoft.KeyVault/vaults/${names.vault}`,
          registry_id: `${foundation}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`,
        }).some(
          ([key, expected]) =>
            typeof variables[key] !== "string" ||
            variables[key].toLowerCase() !== expected.toLowerCase(),
        )
      )
        throw new Error(
          "Temporary provisioning inputs refer to an unverified environment or foundation.",
        )
    }
    if ((await readPrivateFile(join(directory, filename), { createDirectory: false })) !== original)
      throw new Error("Removal inputs changed during inspection. Nothing was overwritten.")
  }
  const path = join(staging, `${kind}-variables.json`)
  if (resources.length) await writePrivateFile(path, JSON.stringify(variables), { exclusive: true })
  const managedState = async () => (await module.state()).filter((address) => !address.startsWith("data."))
  return {
    kind,
    resources,
    async verifyInputs() {
      if (
        original !== undefined &&
        (await readPrivateFile(join(directory, filename), { createDirectory: false })) !== original
      )
        throw new Error("Saved module inputs changed after removal approval. Deletion stopped.")
    },
    async destroy() {
      if (!resources.length) return
      await module.apply(path, {
        destroy: true,
        allowedDeletions: resources.map(({ address }) => address),
      })
      if ((await managedState()).length)
        throw new Error(
          "Removal did not leave an empty Terraform state. The backend was preserved.",
        )
    },
    async empty() {
      if ((await managedState()).length)
        throw new Error("Terraform still tracks resources. State storage cannot be removed.")
    },
  }
}
