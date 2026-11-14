import { expect, it } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import { retryableProvisioningFailure } from "./index.ts"

function databaseFailure(address = "azurerm_postgresql_flexible_server.database") {
  return `Error: creating Flexible Server: Status: "SkuNotAvailable"
  with ${address},
  on database.tf line 1, in resource "azurerm_postgresql_flexible_server" "database":
The specified SKU is not supported in this region.`
}

function blobFailure(address = "azurerm_storage_blob.release_lock") {
  return `Error: checking for existing Blob: unexpected status 403 (403 This request is not authorized to perform this operation using this permission.)
  with ${address},
  on storage.tf line 1, in resource "azurerm_storage_blob" "release_lock":`
}

it.each(["plain", "boxed"])(
  "recognizes the reported simultaneous database and Blob failures in %s diagnostics",
  (format) => {
    const details = [databaseFailure(), blobFailure()].join("\n\n")
    const formatted =
      format === "boxed"
        ? details.split("\n").map((line) => `│ ${line}`).join("\n")
        : details

    expect(
      retryableProvisioningFailure(
        new CommandExecutionError("Terraform apply failed (exit code 1).", false, 1, formatted),
      ),
    ).toBe(true)
  },
)

it.each(["setup", "provision"])(
  "recognizes the managed-identity image-pull failure for the %s job",
  (job) => {
    const details = `Error: creating Job: unable to pull image using Managed identity
  with azurerm_container_app_job.${job},
  on jobs.tf line 1, in resource "azurerm_container_app_job" "${job}":`

    expect(
      retryableProvisioningFailure(new CommandExecutionError("Apply failed", false, 1, details)),
    ).toBe(true)
  },
)

it("refuses a known failure accompanied by an unrelated second diagnostic", () => {
  const details = `${databaseFailure()}
│ Error: creating virtual network: RequestDisallowedByPolicy
│   with azurerm_virtual_network.hub,
│   on network.tf line 1:`

  expect(
    retryableProvisioningFailure(new CommandExecutionError("Apply failed", false, 1, details)),
  ).toBe(false)
})

it.each([
  { reason: "a different database", details: databaseFailure("azurerm_postgresql_flexible_server.other") },
  { reason: "a nested module", details: databaseFailure("module.other.azurerm_postgresql_flexible_server.database") },
  { reason: "an indexed release lock", details: blobFailure("azurerm_storage_blob.release_lock[0]") },
  { reason: "a similarly named release lock", details: blobFailure("azurerm_storage_blob.release_lock_backup") },
  {
    reason: "a similarly named job instead of the approved job",
    details: "Error: unable to pull image using Managed identity\n  with azurerm_container_app_job.setup_extra,",
  },
  {
    reason: "an unrecognized Blob 403",
    details: blobFailure().replace(
      "This request is not authorized to perform this operation using this permission.",
      "The request was blocked by a network rule.",
    ),
  },
])("refuses $reason", ({ details }) => {
  expect(
    retryableProvisioningFailure(new CommandExecutionError("Apply failed", false, 1, details)),
  ).toBe(false)
})

it.each([
  { reason: "aborted execution", aborted: true, code: 1, details: databaseFailure() },
  { reason: "a different exit code", aborted: false, code: 2, details: databaseFailure() },
  { reason: "an unknown exit code", aborted: false, code: undefined, details: databaseFailure() },
  { reason: "missing details", aborted: false, code: 1, details: undefined },
  { reason: "a summary without diagnostics", aborted: false, code: 1, details: "SkuNotAvailable" },
  {
    reason: "truncated details",
    aborted: false,
    code: 1,
    details: `${databaseFailure()}\nError details truncated after 64 KiB.`,
  },
])("refuses $reason even when the summary names a known error", ({ aborted, code, details }) => {
  expect(
    retryableProvisioningFailure(
      new CommandExecutionError(databaseFailure(), aborted, code, details),
    ),
  ).toBe(false)
})
