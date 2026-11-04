import { describe, expect, it } from "vitest"

import { parseRuntimeConfig } from "."

describe("parseRuntimeConfig()", () => {
  it("reads combined runtime configuration without requiring a database for API-only development", () => {
    expect(parseRuntimeConfig({})).toMatchObject({
      mode: "api",
      host: "127.0.0.1",
      port: 3001,
      hasArtifactStorage: false,
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

  it("detects explicit or incomplete storage configuration without choosing a provider", () => {
    for (const env of [
      { ARTIFACT_STORAGE_PROVIDER: "azure" },
      { ARTIFACT_STORAGE_PROVIDER: "" },
      { ARTIFACT_STORAGE_DIRECTORY: "/srv/artifacts" },
      { AZURE_STORAGE_ACCOUNT: "example" },
      { AZURE_STORAGE_CONTAINER: "artifacts" },
    ]) {
      expect(parseRuntimeConfig(env).hasArtifactStorage).toBe(true)
    }
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
