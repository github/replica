import { describe, expect, it } from "vitest"

import { isLocalDevelopmentDatabase } from "."

describe("isLocalDevelopmentDatabase()", () => {
  it("allows a loopback PostgreSQL URL only in development", () => {
    expect(
      isLocalDevelopmentDatabase({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://replica:replica@127.0.0.1:5432/replica",
      }),
    ).toBe(true)
    expect(
      isLocalDevelopmentDatabase({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://replica:replica@127.0.0.1:5432/replica",
      }),
    ).toBe(false)
  })

  it("allows the devcontainer database only with its marker and exact endpoint", () => {
    const databaseUrl = "postgresql://replica:replica@db:5432/replica"
    expect(isLocalDevelopmentDatabase({ NODE_ENV: "development", DATABASE_URL: databaseUrl })).toBe(
      false,
    )
    expect(
      isLocalDevelopmentDatabase({
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        REPLICA_DEVCONTAINER: "true",
      }),
    ).toBe(true)
    expect(
      isLocalDevelopmentDatabase({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://replica:replica@db:5432/production",
        REPLICA_DEVCONTAINER: "true",
      }),
    ).toBe(false)
  })

  it("rejects non-loopback hosts and non-PostgreSQL URLs", () => {
    expect(
      isLocalDevelopmentDatabase({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://replica:replica@database.example.test/replica",
      }),
    ).toBe(false)
    expect(
      isLocalDevelopmentDatabase({
        NODE_ENV: "development",
        DATABASE_URL: "https://127.0.0.1/replica",
      }),
    ).toBe(false)
  })
})
