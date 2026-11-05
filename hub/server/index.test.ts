import { beforeEach, describe, expect, it, vi } from "vitest"

import { runApi } from "./run-api"
import { startServerProcesses } from "./start-server-processes"
import { parseRuntimeConfig } from "./utils/parse-runtime-config"

vi.mock("./domains/artifacts/create-configured-artifact-storage", () => ({
  createConfiguredArtifactStorage: vi.fn(),
}))
vi.mock("./integrations/opentelemetry/start-telemetry", () => ({
  startTelemetry: vi.fn(() => ({ shutdown: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock("./integrations/pino", () => ({
  logger: { fatal: vi.fn() },
}))
vi.mock("./integrations/prisma/index.ts", () => {
  throw new Error("Authentication composition imported Prisma")
})
vi.mock("./run-api", () => ({ runApi: vi.fn().mockResolvedValue(undefined) }))
vi.mock("./scripts/setup", () => ({ setup: vi.fn() }))
vi.mock("./start-server-processes", () => ({ startServerProcesses: vi.fn() }))
vi.mock("./utils/parse-runtime-config", () => ({ parseRuntimeConfig: vi.fn() }))
vi.mock("./workers/configuration", () => ({ jobProcessors: {} }))
vi.mock("./workers/run-job-worker", () => ({ runJobWorker: vi.fn() }))

const apiConfiguration = {
  mode: "api" as const,
  port: 3001,
  host: "127.0.0.1",
  shutdownTimeoutMs: 100,
  hasArtifactStorage: false,
  databaseUrl: undefined,
  clientDirectory: undefined,
  onDemandConcurrency: 2,
  scheduledConcurrency: 1,
}

describe("server runtime", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock("./routes/api/auth/create-authentication-route-dependencies/index.ts")
    vi.mocked(parseRuntimeConfig).mockReturnValue(apiConfiguration)
    vi.mocked(runApi).mockResolvedValue(undefined)
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Unexpected process exit: ${code}`)
    })
  })

  it("starts without importing Prisma-backed authentication composition when auth is disabled", async () => {
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "")

    await expect(import("./index.ts")).resolves.toBeDefined()

    expect(runApi).toHaveBeenCalledWith(expect.objectContaining({ authentication: undefined }))
  })

  it.each([
    ["provider", "GITHUB_CLIENT_ID"],
    ["shared", "HUB_BOOTSTRAP_SECRET"],
  ] as const)(
    "rejects partial authentication configuration when a %s setting is set without an application origin",
    async (_kind, key) => {
      vi.stubEnv(key, "configured")
      vi.mocked(parseRuntimeConfig).mockReturnValue({
        ...apiConfiguration,
        databaseUrl: "postgresql://hub.example.test/replica",
      })

      await expect(import("./index.ts")).rejects.toThrow("Unexpected process exit: 1")

      expect(runApi).not.toHaveBeenCalled()
    },
  )

  it("rejects an application origin without a configured provider", async () => {
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example.test")
    vi.mocked(parseRuntimeConfig).mockReturnValue({
      ...apiConfiguration,
      databaseUrl: "postgresql://hub.example.test/replica",
    })

    await expect(import("./index.ts")).rejects.toThrow("Unexpected process exit: 1")

    expect(runApi).not.toHaveBeenCalled()
  })

  it("requires a database when authentication is configured", async () => {
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example.test")
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client")

    await expect(import("./index.ts")).rejects.toThrow("Unexpected process exit: 1")

    expect(runApi).not.toHaveBeenCalled()
  })

  it.each(["api", "combined"] as const)(
    "disables durable providers without registering authentication routes in a database-backed %s runtime",
    async (mode) => {
      const createAuthenticationRouteDependencies = vi.fn()
      const disableAuthenticationProviders = vi.fn().mockResolvedValue(undefined)
      vi.mocked(parseRuntimeConfig).mockReturnValue({
        ...apiConfiguration,
        mode,
        databaseUrl: "postgresql://hub.example.test/replica",
      })
      vi.doMock("./routes/api/auth/create-authentication-route-dependencies/index.ts", () => ({
        createAuthenticationRouteDependencies,
        disableAuthenticationProviders,
      }))

      await expect(import("./index.ts")).resolves.toBeDefined()

      expect(disableAuthenticationProviders).toHaveBeenCalledOnce()
      expect(createAuthenticationRouteDependencies).not.toHaveBeenCalled()
      const runner = mode === "api" ? runApi : startServerProcesses
      expect(runner).toHaveBeenCalledWith(expect.objectContaining({ authentication: undefined }))
    },
  )

  it("loads route-owned authentication composition when auth is configured", async () => {
    const createAuthenticationRouteDependencies = vi.fn()
    const disableAuthenticationProviders = vi.fn()
    const authentication = {
      currentSession: {},
      github: {
        signIn: {},
        administratorEnrollment: {},
        callback: {},
      },
      signOut: {},
    }
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example.test")
    vi.stubEnv("GITHUB_CLIENT_ID", "github-client")
    vi.mocked(parseRuntimeConfig).mockReturnValue({
      ...apiConfiguration,
      databaseUrl: "postgresql://hub.example.test/replica",
    })
    createAuthenticationRouteDependencies.mockResolvedValue(authentication)
    vi.doMock("./routes/api/auth/create-authentication-route-dependencies/index.ts", () => ({
      createAuthenticationRouteDependencies,
      disableAuthenticationProviders,
    }))

    await expect(import("./index.ts")).resolves.toBeDefined()

    expect(createAuthenticationRouteDependencies).toHaveBeenCalledWith(process.env)
    expect(disableAuthenticationProviders).not.toHaveBeenCalled()
    expect(runApi).toHaveBeenCalledWith(expect.objectContaining({ authentication }))
  })
})
