import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { normalizeBasePath } from "./index.mjs"

describe("normalizeBasePath()", () => {
  it("requires the canonical Build mount or the legacy root", () => {
    assert.equal(normalizeBasePath(), "/")
    assert.equal(normalizeBasePath("/previews/github/2001/4001/"), "/previews/github/2001/4001/")
    for (const route of [
      "/previews/github/2001/4001",
      "/previews/github/02001/4001/",
      "/previews/github/2001/0/",
      "/previews/github/2001/4001/settings/",
      "/previews/github/2001/4001/?tab=1",
    ]) {
      assert.throws(() => normalizeBasePath(route), /canonical private preview path/)
    }
  })
})
