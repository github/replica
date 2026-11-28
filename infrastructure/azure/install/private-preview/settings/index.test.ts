import { describe, expect, it } from "vitest"

import type { PrivatePreviewChoice } from "../../../../installer/types.ts"
import {
  expandVariables,
  needsPreviewRoot,
  noPreviewState,
  offChoice,
  readPreviewState,
  sameVariables,
  targetVariables,
  type PreviewState,
} from "./index.ts"

const on = (overrides: Partial<PrivatePreviewChoice> = {}): PrivatePreviewChoice => ({
  reader: "on",
  inline: false,
  writerRepositoryIds: [],
  ...overrides,
})
const enabledState: PreviewState = {
  reader: "enabled",
  inline: true,
  writer: true,
  boundHostname: "preview.replica.example.com",
  hubOrigin: "https://replica.example.com",
  hops: 2,
}

describe("private preview settings", () => {
  it("needs no preview root or reader on a first install with the defaults", () => {
    expect(needsPreviewRoot(offChoice, false)).toBe(false)
    expect(targetVariables(offChoice, noPreviewState, { dnsReady: false })).toEqual({
      reader: "absent",
      inline_enabled: false,
      custom_hostname: null,
      bind_custom_hostname: false,
      writer: false,
    })
  })

  it.each([
    ["the reader", on()],
    ["only the writer", { ...offChoice, writerRepositoryIds: ["123"] }],
  ])("needs the preview root when an operator opts in to %s", (_, choice) => {
    expect(needsPreviewRoot(choice, false)).toBe(true)
  })

  it("keeps an upgraded install's disabled reader disabled rather than deleting it", () => {
    const current: PreviewState = { reader: "disabled", inline: false, writer: false }

    expect(needsPreviewRoot(offChoice, true)).toBe(true)
    expect(targetVariables(offChoice, current, { dnsReady: false }).reader).toBe("disabled")
  })

  it("turns on the reader with inline playback and binds a hostname only after DNS is ready", () => {
    const choice = on({ inline: true, hostname: "preview.replica.example.com" })
    const current: PreviewState = { reader: "disabled", inline: false, writer: false }

    expect(targetVariables(choice, current, { dnsReady: false })).toEqual({
      reader: "enabled",
      inline_enabled: true,
      custom_hostname: "preview.replica.example.com",
      bind_custom_hostname: false,
      writer: false,
    })
    expect(targetVariables(choice, current, { dnsReady: true }).bind_custom_hostname).toBe(true)
  })

  it("keeps an existing binding when DNS cannot be rechecked", () => {
    const choice = on({ hostname: "preview.replica.example.com" })

    expect(targetVariables(choice, enabledState, { dnsReady: false }).bind_custom_hostname).toBe(true)
  })

  it.each([
    ["another hostname", "other.replica.example.com"],
    ["no hostname", undefined],
  ])("blocks changing a bound hostname to %s while the reader stays on", (_, hostname) => {
    expect(() =>
      targetVariables(on(hostname ? { hostname } : {}), enabledState, { dnsReady: true }),
    ).toThrow(/already bound/)
  })

  it("removes the reader and writer on rollback", () => {
    const removed: PrivatePreviewChoice = { reader: "removed", inline: false, writerRepositoryIds: [] }

    expect(targetVariables(removed, enabledState, { dnsReady: true })).toEqual({
      reader: "absent",
      inline_enabled: false,
      custom_hostname: null,
      bind_custom_hostname: false,
      writer: false,
    })
  })

  it.each([
    ["turning the reader off", offChoice],
    ["removing the reader", { reader: "removed", inline: false, writerRepositoryIds: [] } as PrivatePreviewChoice],
  ])("keeps everything Hub may still use before %s, then applies the target", (_, choice) => {
    const target = targetVariables(choice, enabledState, { dnsReady: false })
    const expand = expandVariables(enabledState, target, { hubUsesReader: true })

    expect(expand).toEqual({
      reader: "enabled",
      inline_enabled: true,
      custom_hostname: "preview.replica.example.com",
      bind_custom_hostname: true,
      writer: true,
    })
    expect(sameVariables(expand, target)).toBe(false)
    expect(target.reader).not.toBe("enabled")
    expect(target.writer).toBe(false)
  })

  it.each([
    { hubUsesReader: true, current: enabledState, choice: on({ inline: true, hostname: "preview.replica.example.com", writerRepositoryIds: ["123"] }) },
    { hubUsesReader: false, current: { reader: "disabled", inline: false, writer: false } as PreviewState, choice: offChoice },
    { hubUsesReader: false, current: noPreviewState, choice: offChoice },
  ])("re-running unchanged needs no contract step for a $current.reader reader", ({ hubUsesReader, current, choice }) => {
    const target = targetVariables(choice, current, { dnsReady: false })

    expect(sameVariables(expandVariables(current, target, { hubUsesReader }), target)).toBe(true)
  })

  it.each([
    { hubUsesReader: true, expected: { custom_hostname: null, bind_custom_hostname: false } },
    { hubUsesReader: false, expected: { custom_hostname: "preview.replica.example.com", bind_custom_hostname: true } },
  ])("binds a new hostname before the release only if Hub does not use the reader yet ($hubUsesReader)", ({ hubUsesReader, expected }) => {
    const current: PreviewState = { reader: "enabled", inline: false, writer: false }
    const target = targetVariables(on({ hostname: "preview.replica.example.com" }), current, { dnsReady: true })

    expect(target).toMatchObject({ custom_hostname: "preview.replica.example.com", bind_custom_hostname: true })
    expect(expandVariables(current, target, { hubUsesReader })).toMatchObject(expected)
  })
})

describe("readPreviewState", () => {
  const app = (address: string, { ingress = [] as unknown[], env = [] as { name: string; value: string }[] } = {}) => ({
    address,
    values: { name: "sample-preview", ingress, template: [{ container: [{ env }] }] },
  })
  const snapshot = (resources: unknown[]) => ({
    format_version: "1.0",
    values: { root_module: { resources } },
  })

  it("reads an earlier wizard's uncounted reader without ingress as disabled", () => {
    expect(readPreviewState(snapshot([app("azurerm_container_app.reader")]))).toEqual({
      reader: "disabled",
      inline: false,
      writer: false,
    })
  })

  it("reads an enabled reader's Hub settings, inline playback, writer, and bound hostname", () => {
    const env = [
      { name: "HUB_PRIVATE_PREVIEW_INLINE_ENABLED", value: "true" },
      { name: "HUB_APPLICATION_ORIGIN", value: "https://replica.example.com" },
      { name: "PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS", value: "2" },
    ]
    const state = snapshot([
      app("azurerm_container_app.reader[0]", { ingress: [{ external_enabled: true }], env }),
      { address: "azurerm_container_app_custom_domain.reader[0]", values: { name: "preview.replica.example.com" } },
      { address: "azurerm_role_assignment.writer[0]", values: {} },
    ])

    expect(readPreviewState(state)).toEqual(enabledState)
  })

  it("reads an empty state as no reader", () => {
    expect(readPreviewState({ format_version: "1.0" })).toEqual(noPreviewState)
  })

  it.each([
    ["an unknown format", { format_version: "2.0", values: { root_module: { resources: [] } } }],
    ["child modules", { format_version: "1.0", values: { root_module: { child_modules: [{}] } } }],
    ["a non-list of resources", { format_version: "1.0", values: { root_module: { resources: {} } } }],
  ])("rejects a state with %s", (_, state) => {
    expect(() => readPreviewState(state)).toThrow(/unexpected shape/)
  })
})
