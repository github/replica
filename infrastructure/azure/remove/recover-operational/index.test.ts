import { beforeEach, expect, it, vi } from "vitest"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { RemovalLeaseError } from "../lease-error/index.ts"
import type { RemovalContext } from "../types.ts"
import { recoverRemovalOperational } from "./index.ts"

const ownership = vi.hoisted(() => ({
  lease: undefined as string | undefined,
}))
vi.mock("../../install/lease/ownership/index.ts", () => ({
  leaseOwnership: vi.fn(async () => ownership),
}))

const target = {
  installation: "sample",
  subscription: "00000000-0000-0000-0000-000000000000",
  kind: "installation" as const,
  account: "samplestate",
  container: "terraform",
  blob: "sample/installer.lock",
}
const observed = new RemovalLeaseError(target, {
  status: "locked",
  state: "leased",
  duration: "infinite",
})
const held = { status: "locked", state: "leased", duration: "infinite" }
const released = { status: "unlocked", state: "broken", duration: null }

function removal(leases: unknown[]) {
  const azure = vi.fn(async (...args: string[]) =>
    args[1] === "blob" && args[2] === "show" ? JSON.stringify(leases.shift()) : "",
  )
  return {
    context: {
      azure,
      config: {},
      directory: "/private",
    } as unknown as RemovalContext,
    azure,
  }
}
const broke = (azure: ReturnType<typeof vi.fn>) =>
  azure.mock.calls.some((call) => call.includes("break"))

beforeEach(() => {
  ownership.lease = undefined
})

it("renews a lease with valid private ownership proof instead of breaking it", async () => {
  ownership.lease = "11111111-2222-3333-4444-555555555555"
  const { context, azure } = removal([held])
  const verify = vi.fn(async () => {})
  await recoverRemovalOperational(context, observed, verify)
  expect(verify).not.toHaveBeenCalled()
  expect(azure).toHaveBeenCalledOnce()
  expect(azure.mock.calls[0]).toEqual(
    expect.arrayContaining(["renew", "--lease-id", "11111111-2222-3333-4444-555555555555"]),
  )
})

it("checks and breaks a lease whose saved ownership proof Azure rejects as stale", async () => {
  ownership.lease = "11111111-2222-3333-4444-555555555555"
  const { context, azure } = removal([held, released])
  azure.mockRejectedValueOnce(
    new CommandExecutionError("Failed", false, 1, "(LeaseIdMismatchWithLeaseOperation)"),
  )
  const verify = vi.fn(async () => {})
  await recoverRemovalOperational(context, observed, verify)
  expect(verify).toHaveBeenCalledOnce()
  expect(broke(azure)).toBe(true)
})

it("stops without breaking when saved ownership cannot be verified", async () => {
  ownership.lease = "11111111-2222-3333-4444-555555555555"
  const { context, azure } = removal([held, released])
  azure.mockRejectedValueOnce(new CommandExecutionError("Failed", false, 1, "AuthorizationFailed"))
  await expect(recoverRemovalOperational(context, observed, async () => {})).rejects.toThrow(
    "Failed",
  )
  expect(broke(azure)).toBe(false)
})

it("checks activity and fresh metadata before breaking an unproven known infinite lease", async () => {
  const { context, azure } = removal([held, released])
  const verify = vi.fn(async () => {})
  await recoverRemovalOperational(context, observed, verify)
  expect(verify).toHaveBeenCalledOnce()
  expect(broke(azure)).toBe(true)
})

it("does not break a lease when activity checks fail", async () => {
  const { context, azure } = removal([held])
  await expect(
    recoverRemovalOperational(context, observed, async () => {
      throw new Error("Removal blocked: a setup or provisioning job is running or unverifiable.")
    }),
  ).rejects.toThrow("setup or provisioning job")
  expect(azure).not.toHaveBeenCalled()
})

it("stops without breaking when the lease changed after preflight", async () => {
  const { context, azure } = removal([{ ...held, duration: "fixed" }])
  await expect(recoverRemovalOperational(context, observed, async () => {})).rejects.toThrow(
    "changed after removal preflight",
  )
  expect(broke(azure)).toBe(false)
})

it("skips the break when the lease was already released", async () => {
  const { context, azure } = removal([released])
  await recoverRemovalOperational(context, observed, async () => {})
  expect(broke(azure)).toBe(false)
})

it("reports an unverified break without retrying it", async () => {
  const { context, azure } = removal([held, held])
  await expect(recoverRemovalOperational(context, observed, async () => {})).rejects.toThrow(
    "was not verified",
  )
  expect(azure.mock.calls.filter((call) => call.includes("break"))).toHaveLength(1)
})
