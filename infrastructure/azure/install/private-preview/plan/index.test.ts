import { expect, it } from "vitest"

import { validatePrivatePreviewPlan } from "./index.ts"

const readerAddresses = [
  "azurerm_resource_group.reader",
  "azurerm_container_app_environment.reader",
  "azurerm_user_assigned_identity.reader",
  "azurerm_role_assignment.image_pull",
  "azurerm_storage_container.reader",
  "azurerm_role_assignment.reader_artifacts",
  "azurerm_container_app.reader",
]

function resourceChange(address: string, ...actions: string[]) {
  const [type, name] = address.split(".")
  return { address, mode: "managed", type, name, change: { actions } }
}

it.each(["create", "no-op"])("allows a single %s for each disabled reader resource", (action) => {
  const plan = {
    resource_changes: readerAddresses.map((address) => resourceChange(address, action)),
  }

  expect(() => validatePrivatePreviewPlan(plan)).not.toThrow()
})

const reader = (action = "create") => resourceChange("azurerm_container_app.reader", action)

it.each([
  {
    reason: "a create for an extra resource",
    extra: resourceChange("azurerm_storage_blob.seed", "create"),
  },
  {
    reason: "even a no-op on the existing Hub",
    extra: resourceChange("azurerm_container_app.hub[0]", "no-op"),
  },
  {
    reason: "a move into an approved address",
    extra: { ...reader("no-op"), previous_address: "azurerm_container_app.hub[0]" },
  },
  {
    reason: "an import into an approved address",
    extra: { ...reader("no-op"), change: { actions: ["no-op"], importing: { id: "/existing/app" } } },
  },
])("blocks $reason alongside a permitted create", ({ extra }) => {
  const plan = {
    resource_changes: [resourceChange("azurerm_user_assigned_identity.reader", "create"), extra],
  }

  expect(() => validatePrivatePreviewPlan(plan)).toThrow()
})

it.each([
  { reason: "an in-place change", actions: ["update"] },
  { reason: "a read", actions: ["read"] },
  { reason: "a delete", actions: ["delete"] },
  { reason: "a replacement", actions: ["create", "delete"] },
  { reason: "an empty action list", actions: [] },
])("blocks $reason on the reader", ({ actions }) => {
  const plan = { resource_changes: [resourceChange("azurerm_container_app.reader", ...actions)] }

  expect(() => validatePrivatePreviewPlan(plan)).toThrow()
})

it.each([
  { reason: "no resource changes list", plan: {} },
  { reason: "a non-object resource change", plan: { resource_changes: [null] } },
  { reason: "a duplicate reader address", plan: { resource_changes: [reader(), reader("no-op")] } },
  {
    reason: "an action that is not an array",
    plan: { resource_changes: [{ ...reader(), change: { actions: "create" } }] },
  },
  {
    reason: "deferred changes outside the shown plan",
    plan: { complete: false, resource_changes: [reader()] },
  },
])("blocks a malformed plan with $reason", ({ plan }) => {
  expect(() => validatePrivatePreviewPlan(plan)).toThrow()
})
