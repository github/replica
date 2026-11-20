import { describe, expect, it } from "vitest"

import { readDecisionRuntimeConfiguration } from "."

const token = "decision-runtime-token-with-32-characters"

function environment(url: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    REPLICA_DECISION_RUNTIME_AUTHENTICATION: "environment-token",
    REPLICA_DECISION_RUNTIME_TOKEN: token,
    REPLICA_DECISION_RUNTIME_URL: url,
    REPLICA_DECISION_RUNTIME_ENVIRONMENT: "fixture",
    ...extra,
  }
}

describe("readDecisionRuntimeConfiguration()", () => {
  it("requires an explicit fixture or production environment with the runtime connection", () => {
    const connection = environment("https://runtime.example.test")
    delete connection.REPLICA_DECISION_RUNTIME_ENVIRONMENT

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

  it("keeps HTTPS as the default decision-runtime transport", () => {
    expect(
      readDecisionRuntimeConfiguration(environment("https://decision-runtime.example")),
    ).toMatchObject({
      baseUrl: "https://decision-runtime.example/",
    })
  })

  it("allows explicit plaintext only for a development loopback runtime", () => {
    expect(
      readDecisionRuntimeConfiguration(
        environment("http://127.0.0.1:8000", {
          REPLICA_DECISION_RUNTIME_ALLOW_INSECURE_LOOPBACK: "true",
        }),
      ),
    ).toMatchObject({
      baseUrl: "http://127.0.0.1:8000/",
    })
  })

  it.each([
    {
      label: "without the explicit opt-in",
      environment: environment("http://127.0.0.1:8000"),
    },
    {
      label: "for a non-loopback host",
      environment: environment("http://decision-runtime.example", {
        REPLICA_DECISION_RUNTIME_ALLOW_INSECURE_LOOPBACK: "true",
      }),
    },
    {
      label: "in production",
      environment: environment("http://127.0.0.1:8000", {
        NODE_ENV: "production",
        REPLICA_DECISION_RUNTIME_ALLOW_INSECURE_LOOPBACK: "true",
      }),
    },
  ])("rejects plaintext $label", ({ environment }) => {
    expect(() => readDecisionRuntimeConfiguration(environment)).toThrow()
  })

  it.each([
    "https://user:password@decision-runtime.example",
    "https://decision-runtime.example?token=secret",
    "https://decision-runtime.example#credential",
  ])("rejects decision-runtime URL data outside the origin: %s", (url) => {
    expect(() => readDecisionRuntimeConfiguration(environment(url))).toThrow()
  })
})
