import { expect, it, vi } from "vitest"

import type { RunCommand } from "../../types.ts"
import { CommandExecutionError } from "../index.ts"
import { retryReadOnly } from "./index.ts"

function failure(details?: string, aborted = false) {
  return new CommandExecutionError("Command failed.", aborted, 1, details)
}

it("retries a read-only command after a transient error and returns the later result", async () => {
  const run = vi
    .fn<RunCommand>()
    .mockRejectedValueOnce(failure("connect ETIMEDOUT 203.0.113.10:443"))
    .mockResolvedValueOnce("{}")
  const options = { label: "Read resource group" }

  await expect(
    retryReadOnly(run, { delays: [0, 0] })("az", ["group", "show", "--name", "sample-rg"], options),
  ).resolves.toBe("{}")

  expect(run).toHaveBeenCalledTimes(2)
  expect(run).toHaveBeenLastCalledWith("az", ["group", "show", "--name", "sample-rg"], options)
})

it("retries a GET Azure REST request", async () => {
  const run = vi
    .fn<RunCommand>()
    .mockRejectedValueOnce(failure("(TooManyRequests) Rate limit exceeded."))
    .mockResolvedValueOnce("{}")

  await expect(
    retryReadOnly(run, { delays: [0] })("az", [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://example.test",
    ]),
  ).resolves.toBe("{}")
  expect(run).toHaveBeenCalledTimes(2)
})

it("retries Terraform show without changing its state path or command options", async () => {
  const run = vi
    .fn<RunCommand>()
    .mockRejectedValueOnce(failure("Service Unavailable"))
    .mockResolvedValueOnce('{"values":{}}')
  const args = ["-chdir=module", "show", "-json"]
  const options = { env: { TF_DATA_DIR: "private-installation-data" } }

  await expect(retryReadOnly(run, { delays: [0] })("terraform", args, options)).resolves.toBe(
    '{"values":{}}',
  )

  expect(run).toHaveBeenCalledTimes(2)
  expect(run).toHaveBeenLastCalledWith("terraform", args, options)
})

it.each([
  ["plan"],
  ["apply", "approved.tfplan"],
  ["destroy"],
  ["state", "rm", "azurerm_resource_group.hub"],
])("never retries Terraform %s after a transient error", async (...operation) => {
  const error = failure("ECONNRESET")
  const run = vi.fn<RunCommand>().mockRejectedValueOnce(error).mockResolvedValueOnce("")

  await expect(
    retryReadOnly(run, { delays: [0] })("terraform", ["-chdir=module", ...operation]),
  ).rejects.toBe(error)

  expect(run).toHaveBeenCalledOnce()
})

it.each([
  ["a write command", ["group", "create", "--name", "sample-rg", "--location", "eastus"], failure("ETIMEDOUT")],
  [
    "an Azure REST request without a method",
    ["rest", "--url", "https://example.test"],
    failure("ETIMEDOUT"),
  ],
  [
    "a non-GET Azure REST request",
    ["rest", "--method", "put", "--url", "https://example.test"],
    failure("ETIMEDOUT"),
  ],
  [
    "a non-transient error",
    ["group", "show", "--name", "sample-rg"],
    failure("(ResourceGroupNotFound) Not found."),
  ],
  ["an error without details", ["group", "show", "--name", "sample-rg"], failure()],
  [
    "truncated error details",
    ["group", "show", "--name", "sample-rg"],
    failure("ETIMEDOUT\nError details truncated after 64 KiB."),
  ],
  ["a cancelled command", ["group", "show", "--name", "sample-rg"], failure("ETIMEDOUT", true)],
  [
    "an error that did not come from a command",
    ["group", "show", "--name", "sample-rg"],
    new Error("ETIMEDOUT"),
  ],
  [
    "mixed transient and permanent diagnostics",
    ["group", "show", "--name", "sample-rg"],
    failure("Error: Service Unavailable\nError: Invalid configuration."),
  ],
])("does not retry %s", async (_case, args, error) => {
  const run = vi.fn<RunCommand>().mockRejectedValueOnce(error).mockResolvedValueOnce("{}")

  await expect(retryReadOnly(run, { delays: [0, 0] })("az", args)).rejects.toBe(error)
  expect(run).toHaveBeenCalledOnce()
})

it("does not retry after the caller's signal is aborted", async () => {
  const controller = new AbortController()
  const error = failure("socket hang up")
  const run = vi.fn<RunCommand>(async () => {
    controller.abort()
    throw error
  })

  await expect(
    retryReadOnly(run, { delays: [0, 0] })("az", ["group", "show"], {
      signal: controller.signal,
    }),
  ).rejects.toBe(error)
  expect(run).toHaveBeenCalledOnce()
})

it("stops waiting for a retry when the caller's signal is aborted", async () => {
  const controller = new AbortController()
  const run = vi.fn<RunCommand>().mockRejectedValue(failure("Service Unavailable"))
  const result = retryReadOnly(run, { delays: [60_000] })("az", ["group", "show"], {
    signal: controller.signal,
  })
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

  controller.abort()

  await expect(result).rejects.toMatchObject({ name: "AbortError" })
  expect(run).toHaveBeenCalledOnce()
})

it("rethrows the last transient error after using every retry delay", async () => {
  const last = failure("status code 503")
  const run = vi
    .fn<RunCommand>()
    .mockRejectedValueOnce(failure("ECONNRESET"))
    .mockRejectedValueOnce(failure("Gateway Timeout"))
    .mockRejectedValueOnce(last)
    .mockResolvedValueOnce("{}")

  await expect(
    retryReadOnly(run, { delays: [0, 0] })("terraform", ["-chdir=module", "state", "list"]),
  ).rejects.toBe(last)
  expect(run).toHaveBeenCalledTimes(3)
})
