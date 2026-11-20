import { describe, expect, it } from "vitest"

import { readDecisionRuntimeConfiguration } from "."

describe("readDecisionRuntimeConfiguration()", () => {
  it("requires an explicit fixture or production environment with the runtime connection", () => {
    const connection = {
      REPLICA_DECISION_RUNTIME_URL: "https://runtime.example.test",
      REPLICA_DECISION_RUNTIME_AUTHENTICATION: "environment-token",
      REPLICA_DECISION_RUNTIME_TOKEN: "x".repeat(32),
    }

    expect(() => readDecisionRuntimeConfiguration(connection)).toThrow(
      /REPLICA_DECISION_RUNTIME_ENVIRONMENT/,
    )
    expect(
      readDecisionRuntimeConfiguration({
        ...connection,
        REPLICA_DECISION_RUNTIME_ENVIRONMENT: "fixture",
      }),
    ).toMatchObject({ environment: "fixture" })
    expect(
      readDecisionRuntimeConfiguration({
        ...connection,
        REPLICA_DECISION_RUNTIME_ENVIRONMENT: "production",
      }),
    ).toMatchObject({ environment: "production" })
  })
})
