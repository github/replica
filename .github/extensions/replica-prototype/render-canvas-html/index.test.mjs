import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { runInNewContext } from "node:vm"

import { renderCanvasHtml } from "./index.mjs"

describe("renderCanvasHtml()", () => {
  it("only shows thread samples for an explicit sample context", () => {
    for (const enabled of [undefined, false, true]) {
      const html = renderCanvasHtml(
        {
          name: "Sample",
          normalizedUrl: "http://localhost:5173/",
          improvementThreadsSample: enabled,
        },
        "local-token",
      )
      const script = [...html.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)][0][1]
      const window = {}
      runInNewContext(script, { window })
      assert.equal(window.__REPLICA_CANVAS__.improvementThreadsSample, enabled ? true : undefined)
      assert.equal(window.__REPLICA_CANVAS__.pickAndPolish, true)
    }
  })

  it("bootstraps the full renderer without a prototype URL and enables its health monitor", () => {
    const html = renderCanvasHtml(
      { name: "New prototype", normalizedUrl: null, monitorPrototype: true },
      "canvas-token",
    )
    const window = {}
    const script = html.match(/<script>([\s\S]*?)<\/script\s*>/i)[1]
    runInNewContext(script, { window })

    assert.equal(window.__REPLICA_CANVAS__.prototypeUrl, null)
    assert.equal(window.__REPLICA_CANVAS__.name, "New prototype")
    assert.equal(window.__REPLICA_CANVAS__.token, "canvas-token")
    assert.equal(window.__REPLICA_CANVAS__.monitorPrototype, true)
    assert.match(html, /<div id="root"><\/div>/)
    assert.match(html, /src="\/assets\/renderer\.js"/)
  })

  it("preserves a connected preview and keeps health monitoring off unless requested", () => {
    const context = {
      name: "</script><script>untrusted()</script>",
      normalizedUrl: "http://localhost:5173/settings?q=1#details",
      previewUrl: "http://127.0.0.1:12345/preview/",
    }
    const html = renderCanvasHtml(context, "canvas-token")
    const window = {}
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)]
    assert.equal(scripts.length, 1)
    runInNewContext(scripts[0][1], { window })

    assert.equal(window.__REPLICA_CANVAS__.prototypeUrl, context.normalizedUrl)
    assert.equal(window.__REPLICA_CANVAS__.previewUrl, context.previewUrl)
    assert.equal(window.__REPLICA_CANVAS__.name, context.name)
    assert.equal(window.__REPLICA_CANVAS__.monitorPrototype, false)
    assert.doesNotMatch(html, /<script>untrusted\(\)/)
  })
})
