import { expect, it, vi } from "vitest"
import type { RemovalContext } from "../types.ts"
import { verifyRemovalActivity } from "./index.ts"

function removal(jobs: unknown, executions: unknown = []) {
  const azure = vi.fn(async (...args: string[]) =>
    JSON.stringify(args.includes("execution") ? executions : jobs),
  )
  const context = {
    azure,
    config: { name: "sample", azure: { resourceGroup: "sample-rg" } },
  } as unknown as RemovalContext
  return { context, azure }
}

it("passes when held locks verify and setup jobs are terminal", async () => {
  const { context, azure } = removal(
    [{ name: "sample-setup" }, { name: "other-job" }],
    [{ name: "run-1", status: "Succeeded" }],
  )
  const verify = vi.fn(async () => {})
  await verifyRemovalActivity(context, [{ held: true, verify }])
  expect(verify).toHaveBeenCalledOnce()
  expect(azure.mock.calls.filter((call) => call.includes("execution"))).toEqual([
    expect.arrayContaining(["--name", "sample-setup", "--resource-group", "sample-rg"]),
  ])
})

it("blocks when the deployment lock is no longer held", async () => {
  const { context, azure } = removal([])
  await expect(
    verifyRemovalActivity(context, [{ held: false, verify: async () => {} }]),
  ).rejects.toThrow("no longer holds its deployment lock")
  expect(azure).not.toHaveBeenCalled()
})

it.each([[[{ name: "run-1", status: "Running" }]], [[{ name: "run-1" }]], [{}]])(
  "blocks when a setup execution is running or unverifiable: %j",
  async (executions) => {
    const { context } = removal([{ name: "sample-provision" }], executions)
    await expect(verifyRemovalActivity(context)).rejects.toThrow(
      "a setup or provisioning job is running or unverifiable",
    )
  },
)

it("blocks when the job list cannot be verified", async () => {
  await expect(verifyRemovalActivity(removal({}).context)).rejects.toThrow(
    "could not verify setup job activity",
  )
  await expect(verifyRemovalActivity(removal([{}]).context)).rejects.toThrow(
    "could not verify setup job identity",
  )
})
