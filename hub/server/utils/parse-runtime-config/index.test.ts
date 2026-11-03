import { describe, expect, it } from "vitest"

import { parseRuntimeConfig } from "."

describe("parseRuntimeConfig()", () => {
  it("reads combined runtime configuration without requiring a database for API-only development", () => {
    expect(parseRuntimeConfig({})).toMatchObject({
      mode: "api",
      host: "127.0.0.1",
      port: 3001,
    })
    expect(
      parseRuntimeConfig({
        RUNTIME_MODE: "combined",
        HOST: "0.0.0.0",
        PORT: "8080",
        DATABASE_URL: "postgresql://test:test@localhost/hub",
        CLIENT_DIRECTORY: "/app/client",
        SHUTDOWN_TIMEOUT_MS: "10000",
        ON_DEMAND_JOB_CONCURRENCY: "4",
        SCHEDULED_JOB_CONCURRENCY: "2",
      }),
    ).toMatchObject({
      mode: "combined",
      host: "0.0.0.0",
      port: 8080,
      databaseUrl: "postgresql://test:test@localhost/hub",
      clientDirectory: "/app/client",
      shutdownTimeoutMs: 10000,
      onDemandConcurrency: 4,
      scheduledConcurrency: 2,
    })
  })

  it.each([
    { RUNTIME_MODE: "private-config-marker" },
    { PORT: "3001private-config-marker" },
    { PORT: "" },
    { HOST: " " },
    { CLIENT_DIRECTORY: " " },
    { SHUTDOWN_TIMEOUT_MS: "0" },
    { ON_DEMAND_JOB_CONCURRENCY: "1.5" },
    { SCHEDULED_JOB_CONCURRENCY: "-1" },
    { RUNTIME_MODE: "combined" },
    { RUNTIME_MODE: "setup" },
    { DATABASE_URL: "https://test:private-config-marker@localhost/hub" },
  ])("rejects invalid configuration without exposing its values: %j", (env) => {
    expect(() => parseRuntimeConfig(env)).toThrow()
    try {
      parseRuntimeConfig(env)
    } catch (error) {
      expect(String(error)).not.toContain("private-config-marker")
    }
  })
})
