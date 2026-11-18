import type { PlannedCreate } from "../../../terraform/index.ts"

const normalized = (value: string) => value.replace(/\/+$/, "").toLowerCase()

const same = (left: string, right: string) => normalized(left) === normalized(right)

const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value

function azureScope(value: unknown): value is string {
  if (!nonempty(value) || !value.startsWith("/")) return false
  const path = value.replace(/\/+$/, "")
  if (!path) return true
  const segments = path.slice(1).split("/")
  if (segments.some((segment) => !nonempty(segment))) return false
  let index = 0
  if (segments[0]?.toLowerCase() === "subscriptions") {
    if (!guid.test(segments[1] ?? "")) return false
    index = 2
    if (segments[index]?.toLowerCase() === "resourcegroups") {
      if (!segments[index + 1]) return false
      index += 2
    }
  }
  while (index < segments.length) {
    if (segments[index]?.toLowerCase() !== "providers" || !segments[index + 1]) return false
    index += 2
    let resources = 0
    while (index < segments.length && segments[index]?.toLowerCase() !== "providers") {
      if (!segments[index + 1]) return false
      index += 2
      resources += 1
    }
    if (!resources) return false
  }
  return index > 0
}

function roleDefinitionId(value: unknown): value is string {
  if (!nonempty(value)) return false
  const id = normalized(value)
  const separator = "/providers/microsoft.authorization/roledefinitions/"
  const index = id.lastIndexOf(separator)
  return (
    index >= 0 &&
    azureScope(id.slice(0, index) || "/") &&
    guid.test(id.slice(index + separator.length))
  )
}

function assignmentId(value: unknown, scope: string): value is string {
  if (!nonempty(value)) return false
  const id = normalized(value)
  const prefix = `${normalized(scope)}/providers/microsoft.authorization/roleassignments/`
  return id.startsWith(prefix) && guid.test(id.slice(prefix.length))
}

// Read-only: finds an existing role assignment with the exact planned scope, principal, and role.
// An ID must match in full; a conflicting planned name and returned ID makes the lookup inconclusive.
export function existingRoleAssignment(
  azure: (...args: string[]) => Promise<string>,
  subscriptionId: string,
) {
  return async ({ type, after }: PlannedCreate): Promise<string | undefined> => {
    if (type !== "azurerm_role_assignment" || !after || typeof after !== "object") return
    const { scope, principal_id, role_definition_id, role_definition_name } = after as Record<
      string,
      unknown
    >
    const roleId = typeof role_definition_id === "string" ? role_definition_id : undefined
    const plannedName =
      typeof role_definition_name === "string" ? role_definition_name : undefined
    const roleName = roleId === undefined ? plannedName : undefined
    if (typeof scope !== "string" || typeof principal_id !== "string") return
    if (roleId === undefined && roleName === undefined) return
    if (!scope.toLowerCase().startsWith(`/subscriptions/${subscriptionId.toLowerCase()}/`)) return
    if (
      !azureScope(scope) ||
      !guid.test(principal_id) ||
      (roleId === undefined ? !nonempty(roleName) : !roleDefinitionId(roleId)) ||
      (plannedName !== undefined && !nonempty(plannedName))
    )
      throw new Error("The planned role assignment has invalid identifying information.")
    const role = roleId ?? roleName
    if (role === undefined) throw new Error("The planned role assignment has no role.")
    const roleField = roleId === undefined ? "roleDefinitionName" : "roleDefinitionId"
    const filter = roleName === undefined ? [] : ["--role", roleName]
    const value: unknown = JSON.parse(
      await azure("role", "assignment", "list", "--scope", scope, ...filter),
    )
    if (!Array.isArray(value))
      throw new Error("Azure returned an incomplete role-assignment list.")
    const assignments: unknown[] = value
    const matches: string[] = []
    for (const item of assignments) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("Azure returned incomplete role-assignment data.")
      const assignment = item as Record<string, unknown>
      const actualRole = assignment[roleField]
      if (
        !azureScope(assignment.scope) ||
        !assignmentId(assignment.id, assignment.scope) ||
        !nonempty(assignment.principalId) ||
        !guid.test(assignment.principalId) ||
        !nonempty(actualRole) ||
        (roleField === "roleDefinitionId" && !roleDefinitionId(actualRole)) ||
        (roleId !== undefined &&
          plannedName !== undefined &&
          !nonempty(assignment.roleDefinitionName))
      )
        throw new Error("Azure returned incomplete role-assignment data.")
      if (!same(assignment.scope, scope) || !same(assignment.principalId, principal_id)) continue
      if (same(actualRole, role)) matches.push(assignment.id)
      else if (
        roleId !== undefined &&
        plannedName !== undefined &&
        nonempty(assignment.roleDefinitionName) &&
        same(assignment.roleDefinitionName, plannedName)
      )
        throw new Error("Azure returned an ambiguous role-assignment identity.")
    }
    if (matches.length > 1)
      throw new Error("Azure returned multiple matching role assignments.")
    return matches[0]
  }
}
