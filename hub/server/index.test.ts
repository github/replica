import { beforeEach, describe, expect, it, vi } from "vitest"

import { runApi } from "./run-api"
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
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`Unexpected process exit: ${code}`)
    })
  })

  it("starts without importing Prisma-backed authentication composition when auth is disabled", async () => {
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "")

    await expect(import("./index.ts")).resolves.toBeDefined()

    expect(runApi).toHaveBeenCalledWith(expect.objectContaining({ authentication: undefined }))
  })

  it("loads route-owned authentication composition when auth is configured", async () => {
    const createAuthenticationRouteDependencies = vi.fn()
    const authentication = {
      signIn: {},
      administratorEnrollment: {},
      callback: {},
      currentSession: {},
      signOut: {},
    }
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example.test")
    createAuthenticationRouteDependencies.mockReturnValue(authentication)
    vi.doMock("./routes/api/auth/create-authentication-route-dependencies/index.ts", () => ({
      createAuthenticationRouteDependencies,
    }))

    await expect(import("./index.ts")).resolves.toBeDefined()

    expect(createAuthenticationRouteDependencies).toHaveBeenCalledWith(process.env)
    expect(runApi).toHaveBeenCalledWith(expect.objectContaining({ authentication }))
  })
})
