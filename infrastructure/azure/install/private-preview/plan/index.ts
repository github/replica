const fixed = new Set([
  "azurerm_resource_group.reader",
  "azurerm_container_app_environment.reader",
  "azurerm_user_assigned_identity.reader",
  "azurerm_storage_container.reader",
])
// Only these may be removed, and only because their count dropped to zero.
const optional = new Set([
  "azurerm_container_app.reader[0]",
  "azurerm_role_assignment.image_pull[0]",
  "azurerm_role_assignment.reader_artifacts[0]",
  "azurerm_role_assignment.reader_secret[0]",
  "azurerm_container_app_custom_domain.reader[0]",
  "azurerm_role_definition.writer[0]",
  "azurerm_role_assignment.writer[0]",
])
// Earlier wizard versions created these without count.
const moved = new Map([
  ["azurerm_container_app.reader[0]", "azurerm_container_app.reader"],
  ["azurerm_role_assignment.image_pull[0]", "azurerm_role_assignment.image_pull"],
  ["azurerm_role_assignment.reader_artifacts[0]", "azurerm_role_assignment.reader_artifacts"],
])
const updatable = new Set(["azurerm_container_app.reader[0]"])
const grantReplacement = "azurerm_role_assignment.reader_artifacts[0]"

export const listingDeniedCondition = `(
  (
    !(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})
  )
)`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const sameText = (left: unknown, right: unknown) =>
  typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase()

// The one replacement allowed: an earlier unconditioned reader grant becomes listing-denied.
function replacesUnconditionedGrant(address: string, change: Record<string, unknown>) {
  const { before, after } = change
  return (
    address === grantReplacement &&
    isRecord(before) &&
    isRecord(after) &&
    (before.condition == null || before.condition === "") &&
    (before.condition_version == null || before.condition_version === "") &&
    before.role_definition_name === "Storage Blob Data Reader" &&
    after.role_definition_name === "Storage Blob Data Reader" &&
    sameText(before.scope, after.scope) &&
    sameText(before.principal_id, after.principal_id) &&
    after.condition === listingDeniedCondition &&
    after.condition_version === "2.0"
  )
}

export function validatePrivatePreviewPlan(plan: unknown): void {
  const reject = (reason: string): never => {
    throw new Error(`Private preview plan blocked: ${reason} No changes were applied.`)
  }
  if (!isRecord(plan) || plan.complete === false || plan.errored === true ||
      !Array.isArray(plan.resource_changes))
    return reject("Terraform did not return a complete plan.")
  const seen = new Set<string>()
  for (const resource of plan.resource_changes) {
    if (!isRecord(resource) || typeof resource.address !== "string" || !isRecord(resource.change) ||
        !Array.isArray(resource.change.actions))
      return reject("the plan has an unreadable resource change.")
    const { address, change } = resource
    const actions = (change.actions as unknown[]).join("/")
    if ((!fixed.has(address) && !optional.has(address)) || seen.has(address))
      return reject(`${address} is outside the private preview service.`)
    seen.add(address)
    if (change.importing !== undefined) return reject(`${address} would be imported.`)
    if (resource.previous_address !== undefined && resource.previous_address !== moved.get(address))
      return reject(`${address} would move from an unexpected address.`)
    if (!allowedAction(address, actions, change)) return reject(`${actions} ${address} is not allowed.`)
  }
}

function allowedAction(address: string, actions: string, change: Record<string, unknown>) {
  return (
    actions === "create" ||
    actions === "no-op" ||
    (actions === "update" && updatable.has(address)) ||
    (actions === "delete" && optional.has(address)) ||
    (actions === "delete/create" && replacesUnconditionedGrant(address, change))
  )
}

// Terraform's generic guard blocks every deletion; these are the reviewed exceptions.
export function allowedPreviewDeletion({
  address,
  change,
}: {
  address: string
  change: { actions: string[] }
}) {
  const actions = change.actions.join("/")
  return (actions === "delete" || actions === "delete/create") &&
    allowedAction(address, actions, change)
}
