import { describe, expect, it } from "vitest"

import { createSharedAuthenticationContext } from "."

const bootstrapSecret = "bootstrap-secret-that-is-at-least-32-characters"
const encryptionKey = Buffer.alloc(32, 1).toString("base64")

describe("createSharedAuthenticationContext()", () => {
  it.each([
    ["https://hub.example.test", true],
    ["http://127.0.0.1:5173", false],
    ["http://localhost:5173", false],
    ["http://[::1]:5173", false],
  ] as const)("accepts exact application origin %s", (applicationOrigin, secureCookie) => {
    expect(
      createSharedAuthenticationContext({
        HUB_APPLICATION_ORIGIN: applicationOrigin,
        HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
        HUB_BOOTSTRAP_SECRET: bootstrapSecret,
      }),
    ).toEqual({
      applicationOrigin,
      bootstrapSecret,
      encryptionKey: Buffer.alloc(32, 1),
      secureCookie,
    })
  })

  it.each([
    "https://hub.example.test/",
    "https://hub.example.test/path",
    "https://hub.example.test?query=1",
    "http://hub.example.test",
  ])("rejects unsafe or non-origin application URL %s", (applicationOrigin) => {
    expect(() =>
      createSharedAuthenticationContext({
        HUB_APPLICATION_ORIGIN: applicationOrigin,
        HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
        HUB_BOOTSTRAP_SECRET: bootstrapSecret,
      }),
    ).toThrow()
  })

  it("requires an exact 32-byte encryption key and bounded bootstrap secret", () => {
    expect(() =>
      createSharedAuthenticationContext({
        HUB_APPLICATION_ORIGIN: "https://hub.example.test",
        HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64"),
        HUB_BOOTSTRAP_SECRET: bootstrapSecret,
      }),
    ).toThrow("exactly 32 bytes")
    expect(() =>
      createSharedAuthenticationContext({
        HUB_APPLICATION_ORIGIN: "https://hub.example.test",
        HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
        HUB_BOOTSTRAP_SECRET: "too-short",
      }),
    ).toThrow()
  })
})
