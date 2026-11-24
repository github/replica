const previewResources = new Set([
  "azurerm_resource_group.reader",
  "azurerm_container_app_environment.reader",
  "azurerm_user_assigned_identity.reader",
  "azurerm_role_assignment.image_pull",
  "azurerm_container_app.reader",
  "azurerm_storage_container.reader",
  "azurerm_role_assignment.reader_artifacts",
])

export const privatePreviewResourceCount = previewResources.size

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function validatePrivatePreviewPlan(plan: unknown, tracked?: ReadonlySet<string>): void {
  const reject = () => {
    throw new Error(
      "Private preview plan blocked: only new disabled reader resources may be created. No changes were applied.",
    )
  }
  if (!isRecord(plan) || plan.complete === false || plan.errored === true ||
      !Array.isArray(plan.resource_changes)) return reject()
  const seen = new Set<string>()
  for (const resource of plan.resource_changes) {
    if (
      !isRecord(resource) ||
      typeof resource.address !== "string" ||
      !previewResources.has(resource.address) ||
      seen.has(resource.address) ||
      resource.previous_address !== undefined ||
      !isRecord(resource.change) ||
      resource.change.importing !== undefined ||
      !Array.isArray(resource.change.actions) ||
      resource.change.actions.length !== 1 ||
      !["create", "no-op"].includes(resource.change.actions[0]) ||
      (tracked && resource.change.actions[0] !== (tracked.has(resource.address) ? "no-op" : "create"))
    )
      return reject()
    seen.add(resource.address)
  }
  if (tracked && seen.size !== previewResources.size) reject()
}
