import type { PlannedCreate } from "../../../terraform/index.ts"

type Assignment = {
  id?: string
  scope?: string
  principalId?: string
  roleDefinitionId?: string
  roleDefinitionName?: string
}

const same = (left: string | undefined, right: string) =>
  left?.toLowerCase() === right.toLowerCase()

// Read-only: finds an existing role assignment with the exact planned scope, principal, and role.
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
    const role =
      typeof role_definition_id === "string"
        ? role_definition_id.split("/").pop()
        : typeof role_definition_name === "string"
          ? role_definition_name
          : undefined
    if (typeof scope !== "string" || typeof principal_id !== "string" || !role) return
    if (!scope.toLowerCase().startsWith(`/subscriptions/${subscriptionId.toLowerCase()}/`)) return
    const assignments = JSON.parse(
      await azure("role", "assignment", "list", "--scope", scope, "--role", role),
    ) as Assignment[]
    return assignments.find(
      (assignment) =>
        same(assignment.scope, scope) &&
        same(assignment.principalId, principal_id) &&
        (same(assignment.roleDefinitionId?.split("/").pop(), role) ||
          same(assignment.roleDefinitionName, role)),
    )?.id
  }
}
