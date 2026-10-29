import { describe, expect, it } from "vitest"

import { validateTemplates } from "./index.ts"

describe("validateTemplates()", () => {
  it("preserves local paths, query strings and fragments but removes Hub metadata", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/templates/settings?tab=profile#details",
    }

    expect(
      validateTemplates({
        version: 1,
        hub: { origin: "https://replica.example.com" },
        templates: [template],
      }),
    ).toStrictEqual({ version: 1, templates: [template] })
    expect(
      validateTemplates({ version: 1, hub: { origin: "https://replica.example.com" } }),
    ).toBeNull()
    expect(validateTemplates({ version: 1, templates: [] })).toStrictEqual({
      version: 1,
      templates: [],
    })
  })

  it("rejects unsupported configuration, duplicate and reserved IDs, and more than twelve templates", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/settings",
    }

    for (const value of [
      null,
      [],
      { version: 2, templates: [] },
      { version: 1, templates: [], extra: true },
      { version: 1, templates: {} },
      { version: 1, templates: [template, template] },
      { version: 1, templates: [{ ...template, id: "default" }] },
      { version: 1, templates: Array(13).fill(template) },
    ]) {
      expect(() => validateTemplates(value)).toThrow()
    }
    for (const id of [
      "UPPER",
      "../escape",
      "with space",
      "a".repeat(65),
      "-leading",
      "double--dash",
    ]) {
      expect(() => validateTemplates({ version: 1, templates: [{ ...template, id }] })).toThrow()
    }
  })

  it("requires bounded text and the exact template fields", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/settings",
    }

    for (const change of [
      { name: "" },
      { name: " " },
      { name: "a".repeat(121) },
      { category: "a".repeat(81) },
      { description: "a".repeat(501) },
      { description: "A\nB" },
      { name: 42 },
      { extra: true },
    ]) {
      expect(() =>
        validateTemplates({ version: 1, templates: [{ ...template, ...change }] }),
      ).toThrow()
    }
    expect(
      validateTemplates({
        version: 1,
        templates: [{ ...template, name: "a".repeat(120), description: "a".repeat(500) }],
      }),
    ).toBeTruthy()
  })

  it("accepts twelve unique templates and counts text limits by characters rather than UTF-16 units", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/settings",
    }

    const templates = Array.from({ length: 12 }, (_, index) => ({
      ...template,
      id: `template-${index}`,
      name: "\u{1f680}".repeat(120),
    }))
    expect(validateTemplates({ version: 1, templates })?.templates).toHaveLength(12)
    expect(() =>
      validateTemplates({
        version: 1,
        templates: [{ ...template, name: "\u{1f680}".repeat(121) }],
      }),
    ).toThrow()
  })

  it("rejects unpaired UTF-16 surrogates in every text field", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/settings",
    }

    for (const field of ["name", "category", "description"]) {
      for (const text of ["\ud800", "\udfff", "a\ud800b", "a\udfffb", "\ud800\ud800"]) {
        const value = JSON.parse(
          JSON.stringify({ version: 1, templates: [{ ...template, [field]: text }] }),
        )
        expect(() => validateTemplates(value), `${field}: ${text}`).toThrow(/well-formed Unicode/)
      }
    }
  })

  it("rejects unpaired UTF-16 surrogates in pathname, query, and fragment", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/settings",
    }

    for (const path of ["/\ud800", "/settings?q=\udfff", "/settings#\ud800"]) {
      expect(() => validateTemplates({ version: 1, templates: [{ ...template, path }] })).toThrow(
        /local browser route/,
      )
    }
  })

  it("rejects external, reserved, encoded and traversing destinations", () => {
    const template = {
      id: "settings",
      name: "Settings",
      category: "Configuration",
      description: "Edit account settings.",
      path: "/settings",
    }

    for (const path of [
      "https://example.com",
      "//example.com/path",
      "/\\example.com",
      "/a/../settings",
      "/a/./settings",
      "/%2e%2e/settings",
      "/%252e%252e/settings",
      "/%2fexample.com",
      "/__replica",
      "/__replica/preview/authorize",
      "/%5f%5freplica/preview",
      "/bad%encoding",
      "/a%00",
      "/with space",
      "/with\u00a0space",
      "/a\u0085b",
      "/a%C2%85b",
      "/a\nb",
      `/${"a".repeat(2048)}`,
      `/${"\u00e9".repeat(1024)}`,
      `/${"\u00e9".repeat(341)}aa`,
      `/?q=${"\u00e9".repeat(340)}aaaaa`,
      `/?q=${"\u00e9".repeat(400)}`,
      `/?q=${"'".repeat(682)}`,
      "/a|b",
      "/.replica-internal/page",
      "/%2ereplica-internal/page",
      "/#/x[1]",
      "/#/issues?filter[state]=open",
      "/#a^b",
      "/#%invalid",
    ]) {
      expect(() => validateTemplates({ version: 1, templates: [{ ...template, path }] })).toThrow()
    }
    for (const path of [
      "/",
      "/#/settings",
      "/templates/caf%C3%A9?mode=edit#section",
      "/__replica-like",
      `/${"\u00e9".repeat(341)}a`,
      `/?q=${"\u00e9".repeat(340)}aaaa`,
      `/?q=${"`".repeat(2044)}`,
      "/?filter[state]=open",
      "/a%7Cb",
      "/#/x%5B1%5D",
      "/a^b",
    ]) {
      expect(validateTemplates({ version: 1, templates: [{ ...template, path }] })).toBeTruthy()
    }
  })
})
