import type { PlannedCreate } from "../../../terraform/index.ts"

import { keyVaultSecretsUser } from "../../role-identities.ts"

const normalized = (value: string) => value.replace(/\/+$/, "").toLowerCase()

const same = (left: string, right: string) => normalized(left) === normalized(right)

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

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

const conditionText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.replace(/\s+/g, "") : undefined

export class ConflictingRoleAssignment extends Error {
  constructor(id: string) {
    super(
      `Azure already has ${id} for the same role, principal, and scope, but with a different condition. It is not the planned grant and was not imported. Review the existing grant before retrying; do not import it.`,
    )
    this.name = "ConflictingRoleAssignment"
  }
}

export function existingRoleAssignment(
  azure: (...args: string[]) => Promise<string>,
  subscriptionId: string,
) {
  const builtInRolePath = `/providers/microsoft.authorization/roledefinitions/${keyVaultSecretsUser.id}`
  const matchesBuiltInRole = (id: string) =>
    same(id, builtInRolePath) ||
    same(id, `/subscriptions/${subscriptionId}${builtInRolePath}`)

  return async ({ type, after }: PlannedCreate): Promise<string | undefined> => {
    if (type !== "azurerm_role_assignment" || !after || typeof after !== "object") return
    const { scope, principal_id, role_definition_id, role_definition_name, condition, condition_version } =
      after as Record<string, unknown>
    const roleId = typeof role_definition_id === "string" ? role_definition_id : undefined
    const plannedName =
      typeof role_definition_name === "string" ? role_definition_name : undefined
    if (typeof scope !== "string" || typeof principal_id !== "string") return
    if (roleId === undefined && plannedName === undefined) return
    if (!scope.toLowerCase().startsWith(`/subscriptions/${subscriptionId.toLowerCase()}/`)) return
    const knownName =
      plannedName !== undefined && sameName(plannedName, keyVaultSecretsUser.name)
    const knownId = roleId !== undefined && matchesBuiltInRole(roleId)
    const knownRole = knownName || knownId
    if (
      !azureScope(scope) ||
      !guid.test(principal_id) ||
      (roleId !== undefined && !roleDefinitionId(roleId)) ||
      (plannedName !== undefined && !nonempty(plannedName)) ||
      (knownName && roleId !== undefined && !knownId) ||
      (knownId && plannedName !== undefined && !knownName)
    )
      throw new Error("The planned role assignment has invalid identifying information.")

    // Azure CLI's role and exact-scope filters can omit matching case or trailing-slash variants.
    const value: unknown = JSON.parse(
      await azure("role", "assignment", "list", "--scope", scope, "--include-inherited"),
    )
    if (!Array.isArray(value))
      throw new Error("Azure returned an incomplete role-assignment list.")
    const assignments: unknown[] = value
    const matches: string[] = []
    for (const item of assignments) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("Azure returned incomplete role-assignment data.")
      const assignment = item as Record<string, unknown>
      if (
        !azureScope(assignment.scope) ||
        !assignmentId(assignment.id, assignment.scope)
      )
        throw new Error("Azure returned incomplete role-assignment data.")
      if (!same(assignment.scope, scope)) continue
      if (!nonempty(assignment.principalId) || !guid.test(assignment.principalId))
        throw new Error("Azure returned incomplete role-assignment data.")
      if (!same(assignment.principalId, principal_id)) continue
      if (!roleDefinitionId(assignment.roleDefinitionId))
        throw new Error("Azure returned incomplete role-assignment data.")

      const actualName = assignment.roleDefinitionName
      if (plannedName !== undefined && !nonempty(actualName))
        throw new Error("Azure returned incomplete role-assignment data.")
      const matchingId = knownRole
        ? matchesBuiltInRole(assignment.roleDefinitionId)
        : roleId === undefined
          ? undefined
          : same(assignment.roleDefinitionId, roleId)
      const expectedName = plannedName ?? (knownId ? keyVaultSecretsUser.name : undefined)
      const matchingName =
        expectedName !== undefined && nonempty(actualName)
          ? sameName(actualName, expectedName)
          : undefined
      if (
        (knownRole &&
          normalized(assignment.roleDefinitionId).endsWith(builtInRolePath) &&
          !matchingId) ||
        (matchingId !== undefined && matchingName !== undefined && matchingId !== matchingName)
      )
        throw new Error("Azure returned an ambiguous role-assignment identity.")
      if (!(matchingId ?? matchingName)) continue
      // A grant is the planned one only if its ABAC condition and version match too.
      if (
        conditionText(assignment.condition) !== conditionText(condition) ||
        (conditionText(condition) !== undefined && assignment.conditionVersion !== condition_version)
      )
        throw new ConflictingRoleAssignment(assignment.id)
      matches.push(assignment.id)
    }
    if (matches.length > 1)
      throw new Error("Azure returned multiple matching role assignments.")
    return matches[0]
  }
}
