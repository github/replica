import { assertDraftMatchesConfig, parseConfig } from "../../../installer/config/index.ts"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { promptForField } from "../../../installer/prompt-for-field/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../../../installer/types.ts"
import { azurePreflight } from "../preflight/index.ts"
import type { DraftAnswers, WizardSession } from "../../../installer/session/index.ts"
import { createPostgresAvailability } from "../postgres-availability/index.ts"
import { guidedPostgresProfile, type PostgresAvailability } from "../profile.ts"

export async function configureAzure(
  ui: WizardUI,
  run: RunCommand,
  existing?: DeploymentConfig,
  session?: WizardSession,
  availability: PostgresAvailability = createPostgresAvailability(run),
): Promise<DeploymentConfig> {
  if (existing) {
    existing = parseConfig(existing)
    assertDraftMatchesConfig(existing, session?.draft)
  }
  const remember = async <K extends keyof DraftAnswers>(key: K, value: DraftAnswers[K]) => {
    await session?.answer(key, value)
    return value
  }
  const choose = async (
    key: "tenantId" | "subscriptionId" | "location",
    label: string,
    options: { label: string; value: string }[],
  ): Promise<string> => {
    if (existing) {
      const fixed = existing.azure[key]
      if (!options.some(({ value }) => value === fixed))
        throw new Error(
          `The saved ${label.toLowerCase()} is not available for this installation. Restore access or service support before retrying; its target will not be changed.`,
        )
      return fixed
    }
    const saved = session?.draft?.answers[key]
    if (saved && options.some(({ value }) => value === saved)) return saved
    if (saved) {
      await session?.clear([key])
      const message = `The saved ${label.toLowerCase()} is no longer available. Choose an authorized option; dependent choices will be checked again.`
      if (ui.notice) ui.notice("warning", message)
      else ui.status(message)
    }
    return (await remember(key, await ui.select(label, options)))!
  }
  const field = async (key: "name" | "owner" | "npmRegistry", initial?: string) =>
    session?.draft?.answers[key] ?? (await remember(key, await promptForField(ui, key, initial)))!
  const discover = async (label: string, args: string[]) => {
    while (true) {
      ui.status(label)
      try {
        return await run("az", args, { label })
      } catch (error) {
        if (!(error instanceof CommandExecutionError) || error.aborted) throw error
        await ui.wait(
          `${error.message}\nCheck Azure sign-in, subscription permissions, and connectivity in a separate terminal, then continue to retry this read-only lookup. Your previous choices are retained.`,
        )
      }
    }
  }
  await ui.phase?.("checks")
  let subscriptions = await azurePreflight(run, ui)
  while (
    existing &&
    !subscriptions.some(
      ({ id, tenantId }) =>
        id === existing.azure.subscriptionId && tenantId === existing.azure.tenantId,
    )
  ) {
    await ui.wait(
      "The saved installation subscription is not available in the current Azure sign-in. Restore access in a separate terminal, then recheck. Use another --config path for a different installation; this target will not be changed.",
    )
    subscriptions = await azurePreflight(run, ui)
  }
  await ui.phase?.("configure")
  ui.status(
    "Tenants come from enabled subscriptions in your Azure CLI sign-in. If a tenant is missing, use az login --tenant TENANT_ID in a separate terminal, then restart the wizard.",
  )
  const tenants = [
    ...new Map(subscriptions.map((subscription) => [subscription.tenantId, subscription])).values(),
  ]
  const tenantId = await choose(
    "tenantId",
    "Azure tenant",
    tenants
      .toSorted(
        (a, b) =>
          Number(b.tenantId === existing?.azure.tenantId) -
          Number(a.tenantId === existing?.azure.tenantId),
      )
      .map(({ tenantId, tenantDisplayName, tenantDefaultDomain }) => ({
        value: tenantId,
        label: `${tenantDisplayName || tenantDefaultDomain || "Tenant"} (${tenantId})${tenantId === existing?.azure.tenantId ? " - saved tenant" : ""}`,
      })),
  )
  const tenantSubscriptions = subscriptions.filter(
    (subscription) => subscription.tenantId === tenantId,
  )
  if (!tenantSubscriptions.length)
    throw new Error("Choose an authorized tenant with an enabled subscription.")
  const subscriptionId = await choose(
    "subscriptionId",
    "Azure subscription",
    tenantSubscriptions
      .toSorted(
        (a, b) =>
          Number(b.id === existing?.azure.subscriptionId) -
          Number(a.id === existing?.azure.subscriptionId),
      )
      .map(({ id, name }) => ({
        label: `${name} (${id})${id === existing?.azure.subscriptionId ? " - saved target" : ""}`,
        value: id,
      })),
  )
  const subscription = tenantSubscriptions.find(({ id }) => id === subscriptionId)
  if (!subscription) throw new Error("Choose an authorized subscription in the selected tenant.")
  const locationStep = "Listing Azure regions for the selected subscription"
  const locations = JSON.parse(
    await discover(locationStep, [
      "rest",
      "--method",
      "get",
      "--url",
      `/subscriptions/${subscriptionId}/locations?api-version=2022-12-01`,
      "--subscription",
      subscriptionId,
      "--query",
      "value",
      "--output",
      "json",
      "--only-show-errors",
    ]),
  ) as { name: string; displayName: string }[]
  const normalize = (value: string) => value.toLowerCase().replace(/\s/g, "")
  const required = [
    ["Microsoft.App", "managedEnvironments"],
    ["Microsoft.DBforPostgreSQL", "flexibleServers"],
    ["Microsoft.ContainerRegistry", "registries"],
    ["Microsoft.KeyVault", "vaults"],
  ] as const
  let supported = locations
  for (const [namespace, type] of required) {
    const providerStep = `Checking Azure region support for ${namespace}/${type}`
    const provider = JSON.parse(
      await discover(providerStep, [
        "provider",
        "show",
        "--namespace",
        namespace,
        "--subscription",
        subscriptionId,
        "--output",
        "json",
        "--only-show-errors",
      ]),
    ) as {
      resourceTypes: { resourceType: string; locations: string[] }[]
    }
    const advertised = provider.resourceTypes.find(
      ({ resourceType }) => resourceType.toLowerCase() === type.toLowerCase(),
    )
    if (!advertised)
      throw new Error(`Azure did not advertise ${namespace}/${type} for this subscription.`)
    const available = new Set(advertised.locations.map(normalize))
    supported = supported.filter(
      ({ name, displayName }) =>
        available.has(normalize(name)) || available.has(normalize(displayName)),
    )
  }
  if (!supported.length)
    throw new Error("No region advertises every required Azure service in this subscription.")
  if (!existing) {
    while (true) {
      ui.status(
        `Checking regional support for PostgreSQL ${guidedPostgresProfile.postgres_sku}, version ${guidedPostgresProfile.postgres_version}. Advertised support does not reserve capacity.`,
      )
      const results = await Promise.allSettled(
        supported.map(({ name }) => availability(subscriptionId, name, guidedPostgresProfile)),
      )
      const failures = results.filter((result) => result.status === "rejected")
      for (const failure of failures) {
        const error: unknown = failure.reason
        if (
          (error instanceof CommandExecutionError && error.aborted) ||
          (error instanceof Error && error.name === "AbortError")
        )
          throw error
      }
      const failure =
        failures.find((failure) => !(failure.reason instanceof CommandExecutionError)) ??
        failures[0]
      if (failure) {
        const error: unknown = failure.reason
        if (!(error instanceof CommandExecutionError) || error.aborted) throw error
        await ui.wait(
          "Regional PostgreSQL compatibility could not be verified. Check Azure access, connectivity, and Azure CLI support for postgres flexible-server list-skus, then continue to retry the read-only checks. Failed lookups are not treated as compatible or unavailable.",
        )
        continue
      }
      supported = supported.filter((_, index) => {
        const result = results[index]
        return result?.status === "fulfilled" && result.value
      })
      break
    }
    if (!supported.length)
      throw new Error(
        `No region advertises all required services and PostgreSQL ${guidedPostgresProfile.postgres_sku}, version ${guidedPostgresProfile.postgres_version}, for this subscription.`,
      )
  }
  const location = await choose(
    "location",
    "Azure region",
    supported
      .toSorted(
        (a, b) =>
          Number(b.name === existing?.azure.location) - Number(a.name === existing?.azure.location),
      )
      .map(({ name, displayName }) => ({
        value: name,
        label: `${displayName} (${name})${name === existing?.azure.location ? " - saved region" : ""}`,
      })),
  )
  if (existing) {
    await remember("tenantId", tenantId)
    await remember("subscriptionId", subscriptionId)
    await remember("location", location)
  }
  const name = existing ? (await remember("name", existing.name))! : await field("name")
  const owner = existing ? (await remember("owner", existing.owner))! : await field("owner")
  const resourceGroup = existing
    ? (await remember("resourceGroup", existing.azure.resourceGroup))!
    : (session?.draft?.answers.resourceGroup ?? (await remember("resourceGroup", `${name}-hub`))!)
  ui.status(`Application resource group: ${resourceGroup}`)
  ui.status(
    "Terraform state uses Azure sign-in and Blob data permissions, without an IP allowlist. Shared-key and anonymous blob access remain disabled.",
  )
  const useProxy =
    session?.draft?.answers.useProxy ??
    (await remember(
      "useProxy",
      await ui.confirm(
        "Configure an npm proxy for the container build? Docker does not inherit host npm settings; configure a proxy here if your network blocks the public npm registry.",
      ),
    ))
  const npmRegistry = useProxy ? await field("npmRegistry", existing?.npmRegistry) : undefined
  return parseConfig({
    version: 1,
    cloud: "azure",
    name,
    owner,
    ...(npmRegistry ? { npmRegistry } : {}),
    azure: {
      subscriptionId,
      tenantId: subscription.tenantId,
      location,
      resourceGroup,
    },
  })
}
