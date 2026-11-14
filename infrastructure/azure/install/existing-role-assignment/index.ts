import type { PlannedCreate } from "../../../terraform/index.ts"

type Assignment = {
  id?: string
  scope?: string
  principalId?: string
  roleDefinitionId?: string
  roleDefinitionName?: string
}

const normalized = (value: string) => value.replace(/\/+$/, "").toLowerCase()

const same = (left: string | undefined, right: string) =>
  left !== undefined && normalized(left) === normalized(right)

// Read-only: finds an existing role assignment with the exact planned scope, principal, and role.
// A planned role definition ID must match the full returned ID; names are used only when no ID is planned.
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
    const roleName =
      roleId === undefined && typeof role_definition_name === "string"
        ? role_definition_name
        : undefined
    if (typeof scope !== "string" || typeof principal_id !== "string") return
    if (roleId === undefined && roleName === undefined) return
    if (!scope.toLowerCase().startsWith(`/subscriptions/${subscriptionId.toLowerCase()}/`)) return
    const matchesRole = (assignment: Assignment) =>
      roleId === undefined
        ? same(assignment.roleDefinitionName, roleName as string)
        : same(assignment.roleDefinitionId, roleId)
    const filter = roleName === undefined ? [] : ["--role", roleName]
    const assignments = JSON.parse(
      await azure("role", "assignment", "list", "--scope", scope, ...filter),
    ) as Assignment[]
    return assignments.find(
      (assignment) =>
        same(assignment.scope, scope) &&
        same(assignment.principalId, principal_id) &&
        matchesRole(assignment),
    )?.id
  }
}
