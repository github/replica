import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import type { provisionDatabaseAccess } from "../../provision-database-access"
import type { loadAzureSecretEnvironment } from "../load-secret-environment"

const mocks = vi.hoisted(() => ({
  loadSecrets: vi.fn<typeof loadAzureSecretEnvironment>(),
  runtimeImported: vi.fn(),
  setupImported: vi.fn(),
  provisionImported: vi.fn(),
  loggerImported: vi.fn(),
  setup: vi.fn<() => Promise<void>>(),
  provision: vi.fn<typeof provisionDatabaseAccess>(),
  info: vi.fn(),
}))
vi.mock("../load-secret-environment", () => ({
  loadAzureSecretEnvironment: mocks.loadSecrets,
}))

import { runAzureEntrypoint } from "."

describe("runAzureEntrypoint()", () => {
  beforeEach(() => {
    vi.doMock("../../..", () => {
      mocks.runtimeImported({
        DATABASE_URL: process.env.DATABASE_URL,
        SERVICE_API_KEY: process.env.SERVICE_API_KEY,
      })
      return {}
    })
    vi.doMock("../../setup", () => {
      mocks.setupImported(process.env.DATABASE_URL)
      return { setup: mocks.setup }
    })
    vi.doMock("../../provision-database-access", () => {
      mocks.provisionImported()
      return { provisionDatabaseAccess: mocks.provision }
    })
    vi.doMock("../../../integrations/pino", () => {
      mocks.loggerImported()
      return { logger: { info: mocks.info } }
    })
  })

  it.each(["runtime", "setup", "provision"] as const)(
    "loads all secrets before importing only the selected %s entrypoint",
    async (target) => {
      const secrets: NodeJS.ProcessEnv =
        target === "runtime"
          ? {
              DATABASE_URL: "postgresql://synthetic-runtime:fixture@database.invalid/replica",
              SERVICE_API_KEY: "synthetic-runtime-api-key",
            }
          : target === "setup"
            ? { DATABASE_URL: "postgresql://synthetic-migration:fixture@database.invalid/replica" }
            : {
                DATABASE_URL: "postgresql://synthetic-admin:fixture@database.invalid/replica",
                HUB_MIGRATION_PASSWORD: "synthetic-migration-password",
                HUB_RUNTIME_PASSWORD: "synthetic-runtime-password",
              }
      const environment: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        ...(target !== "provision"
          ? { RUNTIME_MODE: target === "setup" ? "setup" : "combined" }
          : {}),
        AZURE_CLIENT_ID:
          target === "runtime"
            ? "00000000-0000-0000-0000-000000000001"
            : target === "setup"
              ? "00000000-0000-0000-0000-000000000003"
              : "00000000-0000-0000-0000-000000000005",
        AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(
          Object.fromEntries(
            Object.keys(secrets).map((name) => [
              name,
              `https://fixture.vault.azure.net/secrets/${name.toLowerCase().replaceAll("_", "-")}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
            ]),
          ),
        ),
      }
      const originalEnvironment = process.env
      process.env = environment
      let finishLoading!: () => void
      const pendingSecrets = new Promise<void>((resolve) => {
        finishLoading = resolve
      })
      mocks.loadSecrets.mockImplementation(async (destination) => {
        await pendingSecrets
        Object.assign(destination, secrets)
      })
      mocks.setup.mockResolvedValue(undefined)
      mocks.provision.mockResolvedValue(undefined)

      const startup = runAzureEntrypoint(target)
      onTestFinished(async () => {
        finishLoading()
        try {
          await startup.catch(() => {})
        } finally {
          process.env = originalEnvironment
        }
      })

      expect(mocks.loadSecrets).toHaveBeenCalledExactlyOnceWith(environment, target)
      expect(mocks.runtimeImported).not.toHaveBeenCalled()
      expect(mocks.setupImported).not.toHaveBeenCalled()
      expect(mocks.provisionImported).not.toHaveBeenCalled()
      expect(mocks.loggerImported).not.toHaveBeenCalled()
      expect(mocks.setup).not.toHaveBeenCalled()
      expect(mocks.provision).not.toHaveBeenCalled()
      expect(environment).not.toHaveProperty("DATABASE_URL")

      finishLoading()
      await expect(startup).resolves.toBeUndefined()

      expect(mocks.runtimeImported).toHaveBeenCalledTimes(target === "runtime" ? 1 : 0)
      expect(mocks.setupImported).toHaveBeenCalledTimes(target === "setup" ? 1 : 0)
      expect(mocks.provisionImported).toHaveBeenCalledTimes(target === "provision" ? 1 : 0)
      if (target === "runtime") {
        expect(mocks.runtimeImported).toHaveBeenCalledWith(secrets)
      }
      if (target === "setup") {
        expect(mocks.setupImported).toHaveBeenCalledWith(secrets.DATABASE_URL)
        expect(mocks.setup).toHaveBeenCalledExactlyOnceWith()
      } else {
        expect(mocks.setup).not.toHaveBeenCalled()
      }
      if (target === "provision") {
        expect(mocks.provision).toHaveBeenCalledExactlyOnceWith({
          databaseUrl: secrets.DATABASE_URL,
          migrationPassword: secrets.HUB_MIGRATION_PASSWORD,
          runtimePassword: secrets.HUB_RUNTIME_PASSWORD,
        })
        expect(mocks.info).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(mocks.info.mock.calls)).not.toMatch(/synthetic-|postgresql:/)
      } else {
        expect(mocks.provision).not.toHaveBeenCalled()
        expect(mocks.info).not.toHaveBeenCalled()
      }
    },
  )

  it.each(["runtime", "setup", "provision"] as const)(
    "does not import any workload or begin database work after %s secret loading fails",
    async (target) => {
      const originalEnvironment = process.env
      process.env = {
        NODE_ENV: "production",
        ...(target !== "provision"
          ? { RUNTIME_MODE: target === "setup" ? "setup" : "combined" }
          : {}),
      }
      onTestFinished(() => {
        process.env = originalEnvironment
      })
      mocks.loadSecrets.mockRejectedValue(
        Object.assign(new Error("Synthetic startup failure"), { name: "AzureSecretStartupError" }),
      )

      await expect(runAzureEntrypoint(target)).rejects.toBeInstanceOf(Error)

      expect(mocks.loadSecrets).toHaveBeenCalledExactlyOnceWith(process.env, target)
      expect(mocks.runtimeImported).not.toHaveBeenCalled()
      expect(mocks.setupImported).not.toHaveBeenCalled()
      expect(mocks.provisionImported).not.toHaveBeenCalled()
      expect(mocks.loggerImported).not.toHaveBeenCalled()
      expect(mocks.setup).not.toHaveBeenCalled()
      expect(mocks.provision).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, "", "../setup/index.ts", " runtime", "constructor"])(
    "rejects an unknown target without loading secrets or importing a path",
    async (target) => {
      const originalEnvironment = process.env
      process.env = {}
      onTestFinished(() => {
        process.env = originalEnvironment
      })
      await expect(runAzureEntrypoint(target)).rejects.toBeInstanceOf(Error)

      expect(mocks.loadSecrets).not.toHaveBeenCalled()
      expect(mocks.runtimeImported).not.toHaveBeenCalled()
      expect(mocks.setupImported).not.toHaveBeenCalled()
      expect(mocks.provisionImported).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["runtime", "setup"],
    ["setup", "combined"],
    ["setup", undefined],
  ])(
    "rejects the %s target with runtime mode %s before secret or database work",
    async (target, mode) => {
      const originalEnvironment = process.env
      process.env = { RUNTIME_MODE: mode }
      onTestFinished(() => {
        process.env = originalEnvironment
      })

      await expect(runAzureEntrypoint(target)).rejects.toBeInstanceOf(Error)

      expect(mocks.loadSecrets).not.toHaveBeenCalled()
      expect(mocks.runtimeImported).not.toHaveBeenCalled()
      expect(mocks.setupImported).not.toHaveBeenCalled()
      expect(mocks.provisionImported).not.toHaveBeenCalled()
      expect(mocks.setup).not.toHaveBeenCalled()
      expect(mocks.provision).not.toHaveBeenCalled()
    },
  )

  it.each(["setup", "provision"] as const)(
    "waits for the selected %s database operation to finish",
    async (target) => {
      const originalEnvironment = process.env
      process.env = {
        NODE_ENV: "production",
        ...(target === "setup" ? { RUNTIME_MODE: "setup" } : {}),
        DATABASE_URL: "postgresql://synthetic-role:fixture@database.invalid/replica",
        ...(target === "provision"
          ? {
              HUB_MIGRATION_PASSWORD: "synthetic-migration-password",
              HUB_RUNTIME_PASSWORD: "synthetic-runtime-password",
            }
          : {}),
      }
      mocks.loadSecrets.mockResolvedValue(undefined)
      let finishWork!: () => void
      const pendingWork = new Promise<void>((resolve) => {
        finishWork = resolve
      })
      const work = target === "setup" ? mocks.setup : mocks.provision
      work.mockReturnValue(pendingWork)
      let settled = false

      const startup = runAzureEntrypoint(target)
      const outcome = startup.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      onTestFinished(async () => {
        finishWork()
        try {
          await outcome
        } finally {
          process.env = originalEnvironment
        }
      })
      await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(1))
      expect(settled).toBe(false)
      expect(mocks.info).not.toHaveBeenCalled()

      finishWork()
      await expect(startup).resolves.toBeUndefined()

      expect(settled).toBe(true)
      expect(work).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["setup", "provision"] as const)(
    "does not retry a failed %s database operation or report provisioning completion",
    async (target) => {
      const originalEnvironment = process.env
      process.env = {
        NODE_ENV: "production",
        ...(target === "setup" ? { RUNTIME_MODE: "setup" } : {}),
        DATABASE_URL: "postgresql://synthetic-role:fixture@database.invalid/replica",
        ...(target === "provision"
          ? {
              HUB_MIGRATION_PASSWORD: "synthetic-migration-password",
              HUB_RUNTIME_PASSWORD: "synthetic-runtime-password",
            }
          : {}),
      }
      onTestFinished(() => {
        process.env = originalEnvironment
      })
      mocks.loadSecrets.mockResolvedValue(undefined)
      const work = target === "setup" ? mocks.setup : mocks.provision
      work.mockRejectedValue(new Error("Synthetic database operation failure"))

      await expect(runAzureEntrypoint(target)).rejects.toBeInstanceOf(Error)

      expect(work).toHaveBeenCalledTimes(1)
      expect(mocks.loadSecrets).toHaveBeenCalledTimes(1)
      expect(mocks.info).not.toHaveBeenCalled()
    },
  )
})
