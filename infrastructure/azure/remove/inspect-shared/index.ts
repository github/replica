import { installationNames } from "../../install/settings.ts"
import type { RemovalContext, RemovalResource } from "../types.ts"
import { RemovalInspectionError } from "../inspection-error/index.ts"

export async function inspectSharedRemoval(
  { config, azure }: RemovalContext,
  resources?: readonly RemovalResource[],
): Promise<void> {
  const names = installationNames(config)
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  const environment =
    `${group}/providers/Microsoft.App/managedEnvironments/${config.name}-environment`.toLowerCase()
  const foundation =
    `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}`.toLowerCase()
  const registry = `${names.registry}.azurecr.io`
  const vault = `${names.vault}.vault.azure.net`
  const own = new Set(
    [
      `${group}/providers/Microsoft.App/containerApps/${config.name}-hub`,
      `${group}/providers/Microsoft.App/jobs/${config.name}-setup`,
      `${group}/providers/Microsoft.App/jobs/${config.name}-provision`,
    ].map((id) => id.toLowerCase()),
  )
  function invalid(
    reason: string,
    subject?: string,
    remedy = "Azure did not provide verifiable consumer metadata. Check this resource's configuration and read permissions; unknown metadata is not proof that resources are shared or safe to remove.",
  ): never {
    throw new RemovalInspectionError({
      installation: config.name,
      subscription: config.azure.subscriptionId,
      subject,
      reason,
      remedy,
    })
  }
  function record(value: unknown, reason: string, subject?: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(reason, subject)
    return value as Record<string, unknown>
  }
  function strings(value: unknown, field: string, subject: string): string[] {
    if (value === null || value === undefined) return []
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
      invalid(`Consumer metadata field ${field} must be a list of strings.`, subject)
    return value as string[]
  }
  const projection =
    "{id:id,environment:properties.environmentId,managedEnvironment:properties.managedEnvironmentId,connectedEnvironment:properties.connectedEnvironmentId,images:properties.template.containers[].image,initialImages:properties.template.initContainers[].image,registries:properties.configuration.registries[].server,secrets:properties.configuration.secrets[].keyVaultUrl,runtimeReferences:properties.template.containers[].env[?name=='AZURE_KEY_VAULT_SECRET_REFERENCES'].value[],initialReferences:properties.template.initContainers[].env[?name=='AZURE_KEY_VAULT_SECRET_REFERENCES'].value[]}"
  const fields = [
    "images",
    "initialImages",
    "registries",
    "secrets",
    "runtimeReferences",
    "initialReferences",
  ]
  const environments = (workload: Record<string, unknown>) =>
    [workload.environment, workload.managedEnvironment, workload.connectedEnvironment].filter(
      (value) => value !== null && value !== undefined,
    )
  const validEnvironment = (value: unknown) =>
    typeof value === "string" &&
    /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[a-zA-Z0-9._()-]+\/providers\/Microsoft\.App\/(?:managedEnvironments|connectedEnvironments)\/[a-zA-Z0-9-]+$/i.test(
      value,
    )
  async function json(args: string[], subject: string): Promise<unknown> {
    const raw = await azure(...args)
    try {
      return JSON.parse(raw) as unknown
    } catch {
      invalid(
        "Azure returned invalid consumer metadata JSON; the response was not printed.",
        subject,
      )
    }
  }
  function workloadIdentity(value: unknown): {
    id: string
    resourceGroup: string
    type: "containerApps" | "jobs"
    name: string
  } {
    if (typeof value !== "string") invalid("A subscription workload has no verifiable resource ID.")
    const match =
      /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.App\/(containerApps|jobs)\/([^/]+)$/i.exec(
        value,
      )
    if (
      !match ||
      match[1]!.toLowerCase() !== config.azure.subscriptionId ||
      !/^[a-zA-Z0-9._()-]+$/.test(match[2]!) ||
      !/^[a-zA-Z0-9-]+$/.test(match[4]!)
    )
      invalid("A subscription workload has an invalid or foreign resource ID.")
    return {
      id: value,
      resourceGroup: match[2]!,
      type: match[3]!.toLowerCase() === "jobs" ? "jobs" : "containerApps",
      name: match[4]!,
    }
  }
  function safeResourceId(value: unknown, field: string): string {
    if (
      typeof value !== "string" ||
      !/^\/subscriptions\/[a-f0-9-]{36}(?:\/resourceGroups\/[a-zA-Z0-9._()-]+)?(?:\/providers\/[a-zA-Z0-9._/-]+)?$/i.test(
        value,
      )
    )
      invalid(`Azure returned unknown ${field} resource identity metadata.`)
    return value
  }
  const seen = new Set<string>()
  for (const command of [
    ["containerapp", "list"],
    ["containerapp", "job", "list"],
  ]) {
    const operation = command.join(" ")
    const workloads = await json([...command, "--query", `[].${projection}`], operation)
    if (!Array.isArray(workloads))
      invalid("Azure returned an unknown subscription workload list.", operation)
    for (const raw of workloads) {
      let workload = record(raw, "A subscription workload is not an object.", operation)
      const identity = workloadIdentity(workload.id)
      const id = identity.id.toLowerCase()
      if (identity.type !== (command.length === 2 ? "containerApps" : "jobs"))
        invalid("Azure returned a workload of the wrong resource type.", identity.id)
      seen.add(id)
      if (own.has(id)) continue
      if (
        !environments(workload).length ||
        environments(workload).some((value) => !validEnvironment(value)) ||
        fields.some(
          (field) =>
            workload[field] !== undefined &&
            workload[field] !== null &&
            (!Array.isArray(workload[field]) ||
              workload[field].some((value) => typeof value !== "string")),
        )
      ) {
        workload = record(
          await json(
            [
              ...(identity.type === "jobs"
                ? ["containerapp", "job", "show"]
                : ["containerapp", "show"]),
              "--name",
              identity.name,
              "--resource-group",
              identity.resourceGroup,
              "--query",
              projection,
            ],
            identity.id,
          ),
          "Azure returned unknown workload details.",
          identity.id,
        )
        if (typeof workload.id !== "string" || workload.id.toLowerCase() !== id)
          invalid(
            "The detailed workload identity did not match subscription discovery.",
            identity.id,
          )
      }
      const environmentIds = environments(workload)
      if (!environmentIds.length || environmentIds.some((value) => !validEnvironment(value)))
        invalid(
          "Consumer environment metadata is missing or invalid after a targeted workload check.",
          identity.id,
        )
      if (environmentIds.some((value) => String(value).toLowerCase() === environment))
        invalid(
          `An unselected workload shares the installation's Container Apps environment ${environment}.`,
          identity.id,
          "Move or remove this consumer through its own authorized lifecycle, or exclude this installation from removal. This installer does not stop or delete unselected workloads.",
        )
      if (
        [
          ...strings(workload.images, "images", identity.id),
          ...strings(workload.initialImages, "initialImages", identity.id),
        ].some((value) => value.split("/")[0]!.toLowerCase() === registry) ||
        strings(workload.registries, "registries", identity.id).some(
          (value) => value.toLowerCase() === registry,
        )
      )
        invalid(
          `An unselected workload uses the installation's container registry ${registry}.`,
          identity.id,
          "Move this consumer to another registry through its own authorized lifecycle, or keep this installation. Shared images and unselected workloads are not deleted automatically.",
        )
      const references = strings(workload.secrets, "secrets", identity.id)
      for (const field of ["runtimeReferences", "initialReferences"]) {
        for (const encoded of strings(workload[field], field, identity.id)) {
          let parsed: unknown
          try {
            parsed = JSON.parse(encoded)
          } catch {
            invalid(
              `Consumer metadata field ${field} is invalid JSON; its contents were not printed.`,
              identity.id,
            )
          }
          const values = Object.values(
            record(parsed, `Consumer metadata field ${field} is not an object.`, identity.id),
          )
          if (values.some((value) => typeof value !== "string"))
            invalid(`Consumer metadata field ${field} contains non-string values.`, identity.id)
          references.push(...(values as string[]))
        }
      }
      for (const uri of references) {
        let url: URL
        try {
          url = new URL(uri)
        } catch {
          invalid(
            "A consumer's Key Vault reference is not a valid URL; its contents were not printed.",
            identity.id,
          )
        }
        if (url.hostname.toLowerCase() === vault)
          invalid(
            `An unselected workload uses the installation's Key Vault ${vault}.`,
            identity.id,
            "Move this consumer's secret references through its own authorized lifecycle, or keep this installation. External consumers and their secret values are not changed automatically.",
          )
      }
    }
  }
  if (!resources) return
  for (const resource of resources) {
    if (
      ["azurerm_container_app", "azurerm_container_app_job"].includes(resource.type) &&
      !seen.has(resource.id.toLowerCase())
    )
      invalid(
        "Subscription workload discovery did not include a tracked app or job.",
        safeResourceId(resource.id, "tracked workload"),
        "Check subscription-wide Container Apps read access and retry. Incomplete discovery is not proof that this tracked workload is absent.",
      )
  }
  const allowed = new Set(
    resources
      .filter(({ type }) => type === "azurerm_role_assignment")
      .map(({ id }) => id.toLowerCase()),
  )
  const grants = await json(
    [
      "role",
      "assignment",
      "list",
      "--all",
      "--fill-principal-name",
      "false",
      "--fill-role-definition-name",
      "false",
      "--query",
      "[].{id:id,scope:scope}",
    ],
    "role assignment list",
  )
  if (!Array.isArray(grants))
    invalid("Azure returned unknown role-assignment discovery metadata.", "role assignment list")
  for (const raw of grants) {
    const grant = record(
      raw,
      "Azure returned a malformed role-assignment record.",
      "role assignment list",
    )
    if (typeof grant.scope !== "string" || typeof grant.id !== "string")
      invalid("A role assignment is missing scope or resource ID metadata.", "role assignment list")
    const scope = grant.scope.toLowerCase()
    if (
      [foundation, group.toLowerCase()].some(
        (group) => scope === group || scope.startsWith(`${group}/`),
      ) &&
      !allowed.has(grant.id.toLowerCase())
    )
      invalid(
        `An untracked grant exists within this installation's owned scope: ${safeResourceId(grant.scope, "role-assignment scope")}.`,
        safeResourceId(grant.id, "role assignment"),
        "Review this exact grant against the installation's Terraform state and its consumer. Remove it only through a separately authorized lifecycle if obsolete, or restore the matching state if it is installation-owned. This installer does not adopt or delete untracked grants.",
      )
  }
}
