import { describe, expect, it } from "vitest"

import { resolveLocalSignInEnvironment } from "."

const localEnvironment = {
  DATABASE_URL: "postgresql://replica:replica@127.0.0.1:5432/replica",
  HUB_LOCAL_SIGN_IN: "true",
  NODE_ENV: "development",
}

describe("resolveLocalSignInEnvironment()", () => {
  it("refuses a database that is not on this machine", () => {
    expect(() =>
      resolveLocalSignInEnvironment({
        ...localEnvironment,
        DATABASE_URL: "postgresql://replica:replica@hub.example.test:5432/replica",
      }),
    ).toThrow(
      "HUB_LOCAL_SIGN_IN requires NODE_ENV=development and a local development DATABASE_URL.",
    )
  })

  it("refuses to run outside development", () => {
    expect(() =>
      resolveLocalSignInEnvironment({ ...localEnvironment, NODE_ENV: "production" }),
    ).toThrow(
      "HUB_LOCAL_SIGN_IN requires NODE_ENV=development and a local development DATABASE_URL.",
    )
  })

  it("refuses to run alongside GitHub sign-in", () => {
    expect(() =>
      resolveLocalSignInEnvironment({ ...localEnvironment, GITHUB_CLIENT_ID: "github-client" }),
    ).toThrow("HUB_LOCAL_SIGN_IN cannot be combined with GitHub or Entra sign-in settings.")
  })

  it("refuses an application origin that other machines can reach", () => {
    expect(() =>
      resolveLocalSignInEnvironment({
        ...localEnvironment,
        HUB_APPLICATION_ORIGIN: "https://hub.example.test",
      }),
    ).toThrow("HUB_LOCAL_SIGN_IN requires a loopback HUB_APPLICATION_ORIGIN.")
  })

  it("refuses a listener that other machines can reach", () => {
    expect(() => resolveLocalSignInEnvironment({ ...localEnvironment, HOST: "0.0.0.0" })).toThrow(
      "HUB_LOCAL_SIGN_IN requires HOST to be 127.0.0.1, ::1, or localhost.",
    )
    expect(() => resolveLocalSignInEnvironment({ ...localEnvironment, HOST: "::" })).toThrow(
      "HUB_LOCAL_SIGN_IN requires HOST to be 127.0.0.1, ::1, or localhost.",
    )
  })

  it("allows an IPv6 loopback listener", () => {
    expect(() => resolveLocalSignInEnvironment({ ...localEnvironment, HOST: "::1" })).not.toThrow()
  })

  it("fills in missing sign-in settings while keeping configured ones", () => {
    const resolved = resolveLocalSignInEnvironment({
      ...localEnvironment,
      HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
    })

    expect(resolved.HUB_APPLICATION_ORIGIN).toBe("http://127.0.0.1:5173")
    expect(Buffer.from(resolved.HUB_AUTHENTICATION_ENCRYPTION_KEY!, "base64")).toHaveLength(32)
    expect(resolved.HUB_BOOTSTRAP_SECRET).toBe("bootstrap-secret-that-is-at-least-32-characters")
  })
})
