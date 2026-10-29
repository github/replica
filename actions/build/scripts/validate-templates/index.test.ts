import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateTemplates } from "./index.ts"

const template = {
  id: "settings",
  name: "Settings",
  category: "Configuration",
  description: "Edit account settings.",
  path: "/templates/settings?tab=profile#details",
}

describe("validateTemplates()", () => {
  it("preserves local paths, query strings and fragments but removes Hub metadata", () => {
    assert.deepEqual(
      validateTemplates({
        version: 1,
        hub: { origin: "https://replica.example.com" },
        templates: [template],
      }),
      { version: 1, templates: [template] },
    )
    assert.equal(
      validateTemplates({ version: 1, hub: { origin: "https://replica.example.com" } }),
      null,
    )
    assert.deepEqual(validateTemplates({ version: 1, templates: [] }), {
      version: 1,
      templates: [],
    })
  })

  it("rejects unsupported configuration, duplicate and reserved IDs, and more than twelve templates", () => {
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
      assert.throws(() => validateTemplates(value))
    }
    for (const id of [
      "UPPER",
      "../escape",
      "with space",
      "a".repeat(65),
      "-leading",
      "double--dash",
    ]) {
      assert.throws(() => validateTemplates({ version: 1, templates: [{ ...template, id }] }))
    }
  })

  it("requires bounded text and the exact template fields", () => {
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
      assert.throws(() =>
        validateTemplates({ version: 1, templates: [{ ...template, ...change }] }),
      )
    }
    assert.ok(
      validateTemplates({
        version: 1,
        templates: [{ ...template, name: "a".repeat(120), description: "a".repeat(500) }],
      }),
    )
  })

  it("accepts twelve unique templates and counts text limits by characters rather than UTF-16 units", () => {
    const templates = Array.from({ length: 12 }, (_, index) => ({
      ...template,
      id: `template-${index}`,
      name: "\u{1f680}".repeat(120),
    }))
    assert.equal(validateTemplates({ version: 1, templates })?.templates.length, 12)
    assert.throws(() =>
      validateTemplates({
        version: 1,
        templates: [{ ...template, name: "\u{1f680}".repeat(121) }],
      }),
    )
  })

  it("rejects unpaired UTF-16 surrogates in every text field", () => {
    for (const field of ["name", "category", "description"]) {
      for (const text of ["\ud800", "\udfff", "a\ud800b", "a\udfffb", "\ud800\ud800"]) {
        const value = JSON.parse(
          JSON.stringify({ version: 1, templates: [{ ...template, [field]: text }] }),
        )
        assert.throws(() => validateTemplates(value), /well-formed Unicode/, `${field}: ${text}`)
      }
    }
  })

  it("rejects unpaired UTF-16 surrogates in pathname, query, and fragment", () => {
    for (const path of ["/\ud800", "/settings?q=\udfff", "/settings#\ud800"]) {
      assert.throws(
        () => validateTemplates({ version: 1, templates: [{ ...template, path }] }),
        /local browser route/,
      )
    }
  })

  it("rejects external, reserved, encoded and traversing destinations", () => {
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
      assert.throws(() => validateTemplates({ version: 1, templates: [{ ...template, path }] }))
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
      assert.ok(validateTemplates({ version: 1, templates: [{ ...template, path }] }))
    }
  })
})
