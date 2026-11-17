import { generateKeyPairSync } from "node:crypto"
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
    ).toThrow(
      "HUB_LOCAL_SIGN_IN cannot be combined with GitHub or Entra settings. Remove those settings to use local sign-in, or run npm run dev:api:live to use a configured provider.",
    )
  })

  it("allows local sign-in alongside a Copilot-only App", () => {
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString()
    for (const key of [
      { GITHUB_APP_PRIVATE_KEY: pem },
      { GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(pem).toString("base64") },
    ]) {
      const resolved = resolveLocalSignInEnvironment({
        ...localEnvironment,
        REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        GITHUB_APP_ID: "123",
        REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "456",
        REPLICA_COPILOT_GITHUB_ORGANIZATION: "github",
        ...key,
      })

      expect(resolved.HUB_APPLICATION_ORIGIN).toBe("http://localhost:5173")
      expect(resolved.GITHUB_APP_ID).toBe("123")
    }
  })

  it("still refuses actual GitHub repository setup alongside Copilot", () => {
    expect(() =>
      resolveLocalSignInEnvironment({
        ...localEnvironment,
        REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
        GITHUB_APP_ID: "123",
        GITHUB_APP_INSTALLATION_ID: "456",
      }),
    ).toThrow(/cannot be combined with GitHub or Entra settings/)
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

    expect(resolved.HUB_APPLICATION_ORIGIN).toBe("http://localhost:5173")
    expect(Buffer.from(resolved.HUB_AUTHENTICATION_ENCRYPTION_KEY!, "base64")).toHaveLength(32)
    expect(resolved.HUB_BOOTSTRAP_SECRET).toBe("bootstrap-secret-that-is-at-least-32-characters")
  })
})
