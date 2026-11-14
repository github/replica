import { describe, expect, it, onTestFinished, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  fatal: vi.fn(),
}))
vi.mock("./run", () => ({ runAzureEntrypoint: mocks.run }))
vi.mock("../../integrations/pino/create-logger", () => ({
  createLogger: () => ({ fatal: mocks.fatal }),
}))

describe("Azure executable entrypoint", () => {
  it.each(["Error", "non-Error"] as const)(
    "reports a safe fatal record and exit status for a secret-bearing %s rejection",
    async (kind) => {
      const originalArguments = process.argv
      const originalExitCode = process.exitCode
      process.argv = ["node", "synthetic-azure-entrypoint", "runtime"]
      process.exitCode = undefined
      onTestFinished(() => {
        process.argv = originalArguments
        process.exitCode = originalExitCode
      })
      const cause = { token: "synthetic-private-cause-token" }
      const rejection =
        kind === "Error"
          ? Object.assign(
              new Error("synthetic-private-secret synthetic-provider-token", { cause }),
              {
                name: "AzureKeyVaultSecretError",
              },
            )
          : { message: "synthetic-private-secret", token: "synthetic-provider-token", cause }
      mocks.run.mockRejectedValue(rejection)

      await expect(import(".")).resolves.toBeDefined()

      expect(mocks.run).toHaveBeenCalledExactlyOnceWith("runtime")
      expect(process.exitCode).toBe(1)
      expect(mocks.fatal).toHaveBeenCalledExactlyOnceWith(
        { errorType: kind === "Error" ? "AzureKeyVaultSecretError" : "UnknownError" },
        expect.any(String),
      )
      expect(JSON.stringify(mocks.fatal.mock.calls)).not.toMatch(
        /synthetic-private-secret|synthetic-provider-token|synthetic-private-cause-token/,
      )
    },
  )
})
