import { expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import type { RunCommand } from "../../../installer/types.ts"
import { guidedPostgresProfile } from "../profile.ts"
import { createPostgresAvailability } from "./index.ts"

function catalogue() {
  return JSON.stringify([{
    status: null,
    reason: null,
    restricted: null,
    supportedServerVersions: [{ name: "17", status: null, reason: null }],
    supportedServerEditions: [{
      name: "Burstable",
      status: null,
      reason: null,
      supportedServerSkus: [{ name: "Standard_B1ms", status: null, reason: null }],
    }],
  }])
}

it("shares pending and completed catalogues across profiles while explicitly scoping the read-only command", async () => {
  const pending = Promise.withResolvers<string>()
  const run = vi.fn<RunCommand>(async () => pending.promise)
  const availability = createPostgresAvailability(run)
  const supported = availability("SYNTHETIC-SUBSCRIPTION", "EastUS2", guidedPostgresProfile)
  const unsupported = availability("synthetic-subscription", "eastus2", {
    postgres_sku: "B_Standard_B2s",
    postgres_version: "17",
  })

  expect(run).toHaveBeenCalledOnce()
  expect(run).toHaveBeenCalledWith("az", [
    "postgres", "flexible-server", "list-skus",
    "--subscription", "SYNTHETIC-SUBSCRIPTION", "--location", "EastUS2",
    "--query",
    "[].{status:status,restricted:restricted,supportedServerVersions:supportedServerVersions[].{name:name,status:status},supportedServerEditions:supportedServerEditions[].{name:name,status:status,supportedServerSkus:supportedServerSkus[].{name:name,status:status}}}",
    "--output", "json", "--only-show-errors",
  ], { label: "Check regional PostgreSQL SKUs and versions" })
  pending.resolve(catalogue())
  await expect(supported).resolves.toBe(true)
  await expect(unsupported).resolves.toBe(false)
  await expect(availability("synthetic-subscription", "eastus2", guidedPostgresProfile))
    .resolves.toBe(true)
  expect(run).toHaveBeenCalledOnce()
})

it("keeps subscriptions, regions, and separate run factories independent", async () => {
  const run = vi.fn<RunCommand>(async () => catalogue())
  const availability = createPostgresAvailability(run)

  await availability("subscription-a", "eastus2", guidedPostgresProfile)
  await availability("subscription-b", "eastus2", guidedPostgresProfile)
  await availability("subscription-a", "westus2", guidedPostgresProfile)
  await createPostgresAvailability(run)("subscription-a", "eastus2", guidedPostgresProfile)

  expect(run).toHaveBeenCalledTimes(4)
})

it("starts at most four distinct regional requests and releases every queued request", async () => {
  const requests = Array.from({ length: 7 }, () => Promise.withResolvers<string>())
  let active = 0
  let maximum = 0
  const run = vi.fn<RunCommand>(async (_executable, args) => {
    const index = Number(args[args.indexOf("--location") + 1]!.slice("region-".length))
    active++
    maximum = Math.max(maximum, active)
    try {
      return await requests[index]!.promise
    } finally {
      active--
    }
  })
  const availability = createPostgresAvailability(run)
  const results = requests.map((_, index) =>
    availability("subscription", `region-${index}`, guidedPostgresProfile),
  )

  expect(run).toHaveBeenCalledTimes(4)
  requests[0]!.resolve(catalogue())
  await results[0]
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(5))
  expect(active).toBe(4)
  for (const request of requests) request.resolve(catalogue())

  await expect(Promise.all(results)).resolves.toEqual(Array(7).fill(true))
  expect(run).toHaveBeenCalledTimes(7)
  expect(maximum).toBe(4)
  expect(active).toBe(0)
})

it.each(["command failure", "invalid JSON", "unknown schema"] as const)(
  "evicts a %s so a retry refetches instead of preserving an unknown result",
  async (kind) => {
    const failure = new CommandExecutionError("Synthetic read-only failure")
    let first = true
    const run = vi.fn<RunCommand>(async () => {
      if (!first) return catalogue()
      first = false
      if (kind === "command failure") throw failure
      return kind === "invalid JSON" ? "{" : JSON.stringify({ unexpected: [] })
    })
    const availability = createPostgresAvailability(run)

    await expect(availability("subscription", "eastus2", guidedPostgresProfile)).rejects.toThrow()
    await expect(availability("subscription", "eastus2", guidedPostgresProfile)).resolves.toBe(true)
    await expect(availability("subscription", "eastus2", guidedPostgresProfile)).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(2)
  },
)
