import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

import { logger } from "../integrations/pino"
import { runJobWorker } from "./run-job-worker"
import { parseRuntimeConfig } from "../utils/parse-runtime-config"
import { readDecisionRuntimeConfiguration } from "../domains/decision-model/read-decision-runtime-configuration"

vi.mock("../integrations/opentelemetry/start-telemetry", () => ({
  startTelemetry: vi.fn(() => ({ shutdown: vi.fn() })),
}))
vi.mock("../integrations/pino", () => ({
  logger: { fatal: vi.fn() },
}))
vi.mock("./run-job-worker", () => ({ runJobWorker: vi.fn() }))
vi.mock("../utils/parse-runtime-config", () => ({ parseRuntimeConfig: vi.fn() }))
vi.mock("../domains/decision-model/read-decision-runtime-configuration", () => ({
  readDecisionRuntimeConfiguration: vi.fn(),
}))

describe("worker startup", () => {
  beforeEach(() => {
    vi.resetModules()
    const argv = process.argv
    process.argv = [...argv.slice(0, 2), "on-demand"]
    onTestFinished(() => {
      process.argv = argv
    })
    vi.mocked(parseRuntimeConfig).mockImplementation(({ RUNTIME_MODE }) => ({
      mode: RUNTIME_MODE === "scheduled" ? "scheduled" : "on-demand",
      databaseUrl: "postgresql://test",
      hasArtifactStorage: false,
      onDemandConcurrency: 1,
      scheduledConcurrency: 1,
      shutdownTimeoutMs: 1_000,
      host: "127.0.0.1",
      port: 3001,
      clientDirectory: undefined,
    }))
    vi.mocked(readDecisionRuntimeConfiguration).mockReturnValue(null)
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
  })

  it("rejects decision runtime configuration without artifact storage", async () => {
    vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_ENABLED", "false")
    vi.mocked(readDecisionRuntimeConfiguration).mockReturnValue({
      allowInsecureLoopback: false,
      baseUrl: "https://runtime.example.test",
      credentialProvider: {} as never,
      environment: "fixture",
    })
    await expect(import("./index.ts")).rejects.toThrow("exit 1")

    expect(runJobWorker).not.toHaveBeenCalled()
    expect(logger.fatal).toHaveBeenCalledWith(
      { errorType: "Error" },
      "Job worker failed; check database access, worker configuration, telemetry, and shutdown time",
    )
  })

  it("refuses to start the on-demand worker with an invalid preview writer", async () => {
    vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_ENABLED", "true")
    vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID", "not-a-repository-id")

    await expect(import(".")).rejects.toThrow("exit 1")

    expect(runJobWorker).not.toHaveBeenCalled()
    expect(logger.fatal).toHaveBeenCalledWith(
      expect.stringContaining("HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID"),
    )
  })

  it("still starts the scheduled worker with an invalid preview writer", async () => {
    vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_ENABLED", "true")
    vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID", "not-a-repository-id")
    process.argv[2] = "scheduled"

    await import(".")

    expect(runJobWorker).toHaveBeenCalledOnce()
    const [{ name, processors }] = vi.mocked(runJobWorker).mock.calls[0]!
    expect(name).toBe("scheduled")
    expect(processors.map((processor) => processor.name)).toContain(
      "retry-github-builds-awaiting-import",
    )
  })
})
