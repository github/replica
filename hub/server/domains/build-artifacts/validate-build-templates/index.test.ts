import { describe, expect, it } from "vitest"

import { BuildPackageError } from "../errors.ts"
import { validateBuildTemplates } from "./index.ts"

const template = {
  id: "checkout",
  name: "Checkout",
  category: "Flows",
  description: "The checkout flow.",
  path: "/checkout?step=1#summary",
}

describe("validateBuildTemplates", () => {
  it("accepts a version 1 templates document", () => {
    expect(() => validateBuildTemplates({ version: 1, templates: [template] })).not.toThrow()
  })

  it.each([
    ["an unknown document key", { version: 1, templates: [], hub: {} }],
    ["another version", { version: 2, templates: [] }],
    ["too many templates", { version: 1, templates: Array(13).fill(template) }],
    ["an unknown template key", { version: 1, templates: [{ ...template, extra: 1 }] }],
    ["the default ID", { version: 1, templates: [{ ...template, id: "default" }] }],
    ["duplicate IDs", { version: 1, templates: [template, template] }],
    ["a blank name", { version: 1, templates: [{ ...template, name: " " }] }],
    ["control characters", { version: 1, templates: [{ ...template, category: "a\u0007" }] }],
    ["an external route", { version: 1, templates: [{ ...template, path: "//evil.test" }] }],
    ["a traversal route", { version: 1, templates: [{ ...template, path: "/a/%2e%2e/b" }] }],
    ["a reserved route", { version: 1, templates: [{ ...template, path: "/__replica/x" }] }],
    ["invalid encoding", { version: 1, templates: [{ ...template, path: "/%zz" }] }],
  ])("rejects %s", (_label, value) => {
    expect(() => validateBuildTemplates(value)).toThrow(BuildPackageError)
  })
})
