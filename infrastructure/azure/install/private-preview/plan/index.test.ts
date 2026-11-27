import { describe, expect, it } from "vitest"

import { allowedPreviewDeletion, listingDeniedCondition, validatePrivatePreviewPlan } from "./index.ts"

const scope =
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/sample/providers/Microsoft.Storage/storageAccounts/samplehub/blobServices/default/containers/private-preview-artifacts"
const principal = "11111111-1111-4111-8111-111111111111"
const grant = "azurerm_role_assignment.reader_artifacts[0]"
const reader = (condition: string | null, condition_version: string | null) => ({
  scope,
  principal_id: principal,
  role_definition_name: "Storage Blob Data Reader",
  condition,
  condition_version,
})
const conditioned = reader(listingDeniedCondition, "2.0")

function change(address: string, actions: string[], extra: Record<string, unknown> = {}) {
  return { address, change: { actions, ...extra } }
}

const plan = (...resource_changes: unknown[]) => ({ resource_changes })

describe("validatePrivatePreviewPlan", () => {
  it("accepts replacing an earlier unconditioned reader grant with the listing-denied grant", () => {
    const replacement = {
      ...change(grant, ["delete", "create"], { before: reader("", ""), after: conditioned }),
      previous_address: "azurerm_role_assignment.reader_artifacts",
    }

    expect(() => validatePrivatePreviewPlan(plan(replacement))).not.toThrow()
    expect(allowedPreviewDeletion(replacement)).toBe(true)
  })

  it.each([
    ["an already conditioned grant", { before: conditioned, after: conditioned }],
    ["a grant for another principal", {
      before: reader(null, null),
      after: { ...conditioned, principal_id: "22222222-2222-4222-8222-222222222222" },
    }],
    ["a grant that stays unconditioned", { before: reader(null, null), after: reader(null, null) }],
    ["a grant with another condition version", { before: reader(null, null), after: reader(listingDeniedCondition, "1.0") }],
  ])("blocks replacing %s", (_, values) => {
    const replacement = change(grant, ["delete", "create"], values)

    expect(() => validatePrivatePreviewPlan(plan(replacement))).toThrow(/blocked/)
    expect(allowedPreviewDeletion(replacement)).toBe(false)
  })

  it.each([
    "azurerm_role_assignment.writer[0]",
    "azurerm_role_assignment.image_pull[0]",
    "azurerm_container_app.reader[0]",
  ])("blocks replacing %s", (address) => {
    const replacement = change(address, ["delete", "create"], {
      before: reader(null, null),
      after: conditioned,
    })

    expect(() => validatePrivatePreviewPlan(plan(replacement))).toThrow(/blocked/)
  })

  it.each([
    "azurerm_storage_container.reader",
    "azurerm_user_assigned_identity.reader",
    "azurerm_container_app_environment.reader",
    "azurerm_resource_group.reader",
  ])("blocks deleting %s", (address) => {
    const deletion = change(address, ["delete"])

    expect(() => validatePrivatePreviewPlan(plan(deletion))).toThrow(/blocked/)
    expect(allowedPreviewDeletion(deletion)).toBe(false)
  })

  it("accepts a rollback that deletes the reader app, its grants, the hostname, and the writer", () => {
    const deletions = [
      "azurerm_container_app.reader[0]",
      "azurerm_role_assignment.image_pull[0]",
      "azurerm_role_assignment.reader_artifacts[0]",
      "azurerm_role_assignment.reader_secret[0]",
      "azurerm_container_app_custom_domain.reader[0]",
      "azurerm_role_definition.writer[0]",
      "azurerm_role_assignment.writer[0]",
    ].map((address) => change(address, ["delete"]))
    const kept = ["azurerm_storage_container.reader", "azurerm_user_assigned_identity.reader"].map(
      (address) => change(address, ["no-op"]),
    )

    expect(() => validatePrivatePreviewPlan(plan(...deletions, ...kept))).not.toThrow()
    expect(deletions.every(allowedPreviewDeletion)).toBe(true)
  })

  it("accepts moving an earlier wizard's uncounted reader into its counted address", () => {
    const moved = {
      ...change("azurerm_container_app.reader[0]", ["update"]),
      previous_address: "azurerm_container_app.reader",
    }

    expect(() => validatePrivatePreviewPlan(plan(moved))).not.toThrow()
  })

  it.each([
    ["a move from an unexpected address", {
      ...change("azurerm_container_app.reader[0]", ["no-op"]),
      previous_address: "azurerm_container_app.hub[0]",
    }],
    ["an import", change("azurerm_role_assignment.writer[0]", ["no-op"], { importing: { id: "/existing" } })],
    ["a resource outside the service", change("azurerm_storage_blob.seed", ["create"])],
    ["an update to a grant", change("azurerm_role_assignment.writer[0]", ["update"])],
  ])("blocks %s", (_, resource) => {
    expect(() => validatePrivatePreviewPlan(plan(resource))).toThrow(/blocked/)
  })

  it.each([
    ["no resource changes list", {}],
    ["deferred changes", { complete: false, resource_changes: [] }],
    ["a duplicate address", plan(change("azurerm_container_app.reader[0]", ["create"]), change("azurerm_container_app.reader[0]", ["no-op"]))],
  ])("blocks a plan with %s", (_, value) => {
    expect(() => validatePrivatePreviewPlan(value)).toThrow(/blocked/)
  })
})
