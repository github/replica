export function validatePostPlan(
  value: unknown,
  scope: {
    appId: string
    image: string
    principalId: string
    secretScopes: readonly string[]
    environment: Record<string, string>
  },
): boolean {
  function invalid(): never {
    throw new Error(
      "Post-setup plan blocked: only this Hub's runtime environment update and intended secret-scoped read grants are allowed. No infrastructure changes, image changes, deletions, or replacements were approved.",
    )
  }
  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid()
    return value as Record<string, unknown>
  }
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    if (value && typeof value === "object")
      return JSON.stringify(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, canonical(value)]),
      )
    return JSON.stringify(value) ?? "undefined"
  }
  function appConfiguration(value: Record<string, unknown>) {
    const copy = structuredClone(value)
    for (const key of [
      "latest_revision_name",
      "latest_ready_revision_name",
      "latest_revision_fqdn",
      "outbound_ip_addresses",
      "custom_domain_verification_id",
    ])
      delete copy[key]
    if (!Array.isArray(copy.template) || copy.template.length !== 1) invalid()
    const template = record(copy.template[0])
    delete template.revision_suffix
    if (!Array.isArray(template.container) || template.container.length !== 1) invalid()
    const container = record(template.container[0])
    delete container.env
    if (container.image !== scope.image) invalid()
    if (Array.isArray(copy.ingress)) for (const ingress of copy.ingress) delete record(ingress).fqdn
    if (Array.isArray(copy.identity))
      for (const identity of copy.identity) {
        delete record(identity).principal_id
        delete record(identity).tenant_id
      }
    return copy
  }
  function environmentSignature(environment: Record<string, string>) {
    const references = environment.AZURE_KEY_VAULT_SECRET_REFERENCES
    let parsed: unknown
    try {
      parsed = JSON.parse(references ?? "null")
    } catch {
      invalid()
    }
    record(parsed)
    return canonical({ ...environment, AZURE_KEY_VAULT_SECRET_REFERENCES: parsed })
  }
  const plan = record(value)
  if (!Array.isArray(plan.resource_changes)) invalid()
  let changed = false
  for (const item of plan.resource_changes) {
    const resource = record(item)
    const change = record(resource.change)
    if (
      !Array.isArray(change.actions) ||
      change.actions.some((action) => typeof action !== "string")
    )
      invalid()
    if (change.actions.length === 1 && ["no-op", "read"].includes(String(change.actions[0])))
      continue
    changed = true
    if (resource.address === "azurerm_container_app.hub[0]") {
      if (
        resource.mode !== "managed" ||
        resource.type !== "azurerm_container_app" ||
        change.actions.length !== 1 ||
        change.actions[0] !== "update"
      )
        invalid()
      const before = record(change.before)
      const after = record(change.after)
      if (
        typeof before.id !== "string" ||
        before.id.toLowerCase() !== scope.appId.toLowerCase() ||
        typeof after.id !== "string" ||
        after.id.toLowerCase() !== scope.appId.toLowerCase() ||
        canonical(appConfiguration(before)) !== canonical(appConfiguration(after))
      )
        invalid()
      const template = record((after.template as unknown[])[0])
      const container = record((template.container as unknown[])[0])
      if (!Array.isArray(container.env)) invalid()
      const environment: Record<string, string> = {}
      for (const entry of container.env) {
        const env = record(entry)
        if (
          typeof env.name !== "string" ||
          typeof env.value !== "string" ||
          env.secret_name ||
          Object.hasOwn(environment, env.name)
        )
          invalid()
        environment[env.name] = env.value
      }
      if (environmentSignature(environment) !== environmentSignature(scope.environment)) invalid()
      continue
    }
    const after = record(change.after)
    if (
      change.actions.length !== 1 ||
      change.actions[0] !== "create" ||
      typeof resource.address !== "string" ||
      resource.mode !== "managed" ||
      resource.type !== "azurerm_role_assignment" ||
      typeof after.scope !== "string" ||
      !scope.secretScopes.includes(after.scope) ||
      resource.address !==
        `azurerm_role_assignment.runtime_secrets[${JSON.stringify(after.scope)}]` ||
      typeof after.principal_id !== "string" ||
      after.principal_id.toLowerCase() !== scope.principalId.toLowerCase() ||
      after.role_definition_name !== "Key Vault Secrets User"
    )
      invalid()
  }
  return changed
}
