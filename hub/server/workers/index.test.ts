import { beforeEach, describe, expect, it, vi } from "vitest"

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
vi.mock("./configuration", () => ({ jobProcessors: { "on-demand": [], scheduled: [] } }))
vi.mock("./run-job-worker", () => ({ runJobWorker: vi.fn() }))
vi.mock("../utils/parse-runtime-config", () => ({ parseRuntimeConfig: vi.fn() }))
vi.mock("../domains/decision-model/read-decision-runtime-configuration", () => ({
  readDecisionRuntimeConfiguration: vi.fn(),
}))

describe("worker startup", () => {
  beforeEach(() => {
    vi.resetModules()
    process.argv[2] = "on-demand"
    vi.mocked(parseRuntimeConfig).mockReturnValue({
      mode: "on-demand",
      databaseUrl: "postgresql://test",
      hasArtifactStorage: false,
      onDemandConcurrency: 1,
      scheduledConcurrency: 1,
      shutdownTimeoutMs: 1_000,
      host: "127.0.0.1",
      port: 3001,
      clientDirectory: undefined,
    })
    vi.mocked(readDecisionRuntimeConfiguration).mockReturnValue({
      baseUrl: "https://runtime.example.test",
      credentialProvider: {} as never,
      environment: "fixture",
    })
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`)
    })
  })

  it("rejects decision runtime configuration without artifact storage", async () => {
    await expect(import("./index.ts")).rejects.toThrow("exit 1")

    expect(runJobWorker).not.toHaveBeenCalled()
    expect(logger.fatal).toHaveBeenCalledWith(
      { errorType: "Error" },
      "Job worker failed; check database access, worker configuration, telemetry, and shutdown time",
    )
  })
})
