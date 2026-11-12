import type { RemovalResource } from "../types.ts"

export function validateRemovalPlan(value: unknown, resources: readonly RemovalResource[]): void {
  function invalid(): never {
    throw new Error(
      "Removal plan changed resource identity or contains actions outside the approved destroy scope. No removal plan was applied.",
    )
  }
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
  if (!record(value)) invalid()
  if (typeof value.format_version !== "string" || !/^1\.\d+$/.test(value.format_version)) invalid()
  const changes = value.resource_changes ?? []
  if (!Array.isArray(changes)) invalid()
  const known = new Map(resources.map((resource) => [resource.address, resource.id.toLowerCase()]))
  for (const change of changes) {
    if (!record(change) || !record(change.change) || !Array.isArray(change.change.actions))
      invalid()
    const actions = change.change.actions
    if (!actions.length) invalid()
    if (actions.every((action) => ["no-op", "read"].includes(action))) continue
    if (
      actions.length !== 1 ||
      actions[0] !== "delete" ||
      typeof change.address !== "string" ||
      !record(change.change.before) ||
      typeof change.change.before.id !== "string" ||
      known.get(change.address) !== change.change.before.id.toLowerCase()
    )
      invalid()
  }
}
