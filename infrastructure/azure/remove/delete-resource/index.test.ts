import { expect, it, vi } from "vitest"
import { CommandExecutionError } from "../../../installer/command/index.ts"
import { deleteRemovalResource } from "./index.ts"

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => {}) }))

it("checks actual absence after a transient deletion response instead of replaying a completed deletion", async () => {
  const azure = vi.fn(async () => {
    throw new CommandExecutionError("Failed", false, 1, "ServiceUnavailable")
  })
  const verify = vi.fn(async () => {})
  const context = { azure, ui: { status: vi.fn() } }
  await deleteRemovalResource(context, ["group", "delete"], async () => true, verify)
  expect(azure).toHaveBeenCalledOnce()
  expect(verify).toHaveBeenCalledOnce()
})

it("rechecks the guard before bounded transient retries", async () => {
  const azure = vi.fn(async () => {
    throw new CommandExecutionError("Failed", false, 1, "ServiceUnavailable")
  })
  const verify = vi.fn(async () => {})
  const context = { azure, ui: { status: vi.fn() } }
  await expect(
    deleteRemovalResource(context, ["group", "delete"], async () => false, verify),
  ).rejects.toThrow("Failed")
  expect(azure).toHaveBeenCalledTimes(3)
  expect(verify).toHaveBeenCalledTimes(3)
})

it.each([
  "AuthorizationFailed: 403",
  "LeaseIdMismatch",
  "Error acquiring the state lock",
  "Failed to persist state",
])("never retries %s even when a transport error is also reported", async (failure) => {
  const error = new CommandExecutionError(
    "Deletion stopped",
    false,
    1,
    `${failure}\nServiceUnavailable`,
  )
  const azure = vi.fn(async () => {
    throw error
  })
  const absent = vi.fn(async () => false)
  const verify = vi.fn(async () => {})

  await expect(
    deleteRemovalResource({ azure, ui: { status: vi.fn() } }, ["group", "delete"], absent, verify),
  ).rejects.toBe(error)

  expect(azure).toHaveBeenCalledOnce()
  expect(absent).not.toHaveBeenCalled()
  expect(verify).toHaveBeenCalledOnce()
})

it("returns without rechecking the guard when deletion finishes during the retry delay", async () => {
  const azure = vi.fn(async () => {
    throw new CommandExecutionError("Failed", false, 1, "ServiceUnavailable")
  })
  const absent = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  const verify = vi.fn(async () => {})

  await deleteRemovalResource({ azure, ui: { status: vi.fn() } }, ["group", "delete"], absent, verify)

  expect(azure).toHaveBeenCalledOnce()
  expect(verify).toHaveBeenCalledOnce()
  expect(absent).toHaveBeenCalledTimes(2)
})

it("stops a retry when ownership changes after the first failed deletion", async () => {
  const error = new Error("Synthetic ownership changed")
  const azure = vi.fn(async () => {
    throw new CommandExecutionError("Failed", false, 1, "ServiceUnavailable")
  })
  const absent = vi.fn(async () => false)
  const verify = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(error)

  await expect(
    deleteRemovalResource({ azure, ui: { status: vi.fn() } }, ["group", "delete"], absent, verify),
  ).rejects.toBe(error)

  expect(azure).toHaveBeenCalledOnce()
  expect(absent).toHaveBeenCalledTimes(2)
  expect(verify).toHaveBeenCalledTimes(2)
})
