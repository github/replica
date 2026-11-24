import { describe, expect, it } from "vitest"

import { injectPreviewBridge } from "."

describe("injectPreviewBridge()", () => {
  it("preserves a leading doctype when the document omits an explicit head", () => {
    const source = "<!doctype html><body><h1>Preview</h1></body>"

    const output = new TextDecoder().decode(injectPreviewBridge(new TextEncoder().encode(source)))

    expect(output).toBe(`${source}<script src="/__replica/bridge/v3.js"></script>`)
  })
})
