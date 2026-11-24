import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { readPrivatePreviewSettings } from "."

function enabledEnvironment(hubOrigin: string, readerOrigin: string) {
  return {
    HUB_PRIVATE_PREVIEW_ENABLED: "true",
    HUB_APPLICATION_ORIGIN: hubOrigin,
    HUB_PRIVATE_PREVIEW_ORIGIN: readerOrigin,
    HUB_PRIVATE_PREVIEW_READER_SECRET: randomBytes(32).toString("base64url"),
  }
}

describe("readPrivatePreviewSettings()", () => {
  it("accepts exact HTTPS origins on separate sites", () => {
    const hubOrigin = "https://hub.example.com"
    const readerOrigin = "https://preview.example.net"
    const environment = enabledEnvironment(hubOrigin, readerOrigin)

    expect(readPrivatePreviewSettings(environment)).toEqual({
      hubOrigin,
      readerOrigin,
      readerSecret: environment.HUB_PRIVATE_PREVIEW_READER_SECRET,
    })
  })

  it.each([
    ["https://hub.example.com", "https://hub.example.com"],
    ["https://hub.example.com", "https://preview.example.com"],
    [
      "https://sample-hub.eastus2.azurecontainerapps.io",
      "https://sample-reader.eastus2.azurecontainerapps.io",
    ],
  ])("rejects origins on the same site (%s, %s)", (hubOrigin, readerOrigin) => {
    expect(() => readPrivatePreviewSettings(enabledEnvironment(hubOrigin, readerOrigin))).toThrow(
      "separate site",
    )
  })

  it("is disabled by default and ignores reader settings when explicitly disabled", () => {
    expect(readPrivatePreviewSettings({})).toBeUndefined()
    expect(
      readPrivatePreviewSettings({
        HUB_PRIVATE_PREVIEW_ENABLED: "false",
        HUB_PRIVATE_PREVIEW_ORIGIN: "https://preview.example.net",
      }),
    ).toBeUndefined()
  })

  it("rejects reader settings without an explicit opt-in", () => {
    expect(() =>
      readPrivatePreviewSettings({ HUB_PRIVATE_PREVIEW_ORIGIN: "https://preview.example.net" }),
    ).toThrow("HUB_PRIVATE_PREVIEW_ENABLED")
  })

  it("rejects opt-in without the Reader credential", () => {
    expect(() =>
      readPrivatePreviewSettings({
        HUB_PRIVATE_PREVIEW_ENABLED: "true",
        HUB_APPLICATION_ORIGIN: "https://hub.example.com",
        HUB_PRIVATE_PREVIEW_ORIGIN: "https://preview.example.net",
      }),
    ).toThrow("HUB_PRIVATE_PREVIEW_READER_SECRET")
  })
})
