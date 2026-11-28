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
  it.each([
    ["https://replica.example.com", "https://preview.replica.example.com"],
    [
      "https://sample-hub.eastus2.azurecontainerapps.io",
      "https://sample-reader.westus2.azurecontainerapps.io",
    ],
  ])("accepts a different HTTPS hostname on the same site (%s, %s)", (hubOrigin, readerOrigin) => {
    const environment = enabledEnvironment(hubOrigin, readerOrigin)

    expect(readPrivatePreviewSettings(environment)).toEqual({
      hubOrigin,
      readerOrigin,
      readerSecret: environment.HUB_PRIVATE_PREVIEW_READER_SECRET,
      inline: false,
    })
  })

  it.each([
    ["https://hub.example.com", "https://hub.example.com"],
    ["https://hub.example.com", "https://hub.example.com:8443"],
    ["https://hub.example.com", "https://preview.example.net"],
    ["https://sample.github.io", "https://preview.github.io"],
  ])("rejects the same hostname or another site (%s, %s)", (hubOrigin, readerOrigin) => {
    expect(() => readPrivatePreviewSettings(enabledEnvironment(hubOrigin, readerOrigin))).toThrow(
      "same site",
    )
  })

  it("enables inline playback only when explicitly configured", () => {
    const environment = enabledEnvironment(
      "https://replica.example.com",
      "https://preview.replica.example.com",
    )

    expect(
      readPrivatePreviewSettings({ ...environment, HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true" }),
    ).toMatchObject({ inline: true })
    expect(() =>
      readPrivatePreviewSettings({ ...environment, HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "yes" }),
    ).toThrow("HUB_PRIVATE_PREVIEW_INLINE_ENABLED")
    expect(() =>
      readPrivatePreviewSettings({ HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true" }),
    ).toThrow("HUB_PRIVATE_PREVIEW_ENABLED")
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
        HUB_APPLICATION_ORIGIN: "https://replica.example.com",
        HUB_PRIVATE_PREVIEW_ORIGIN: "https://preview.replica.example.com",
      }),
    ).toThrow("HUB_PRIVATE_PREVIEW_READER_SECRET")
  })
})
