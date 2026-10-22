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

  it("checks preview health repeatedly and returns to setup when the server stops", async () => {
    const html = renderCanvasHtml(
      { name: "Demo", normalizedUrl: "http://localhost:5173/" },
      "canvas-token",
      "http://127.0.0.1:12345/?document=setup-document",
    )
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)].at(-1)[1]
    let nextCheck
    let destination
    let available = true
    let failed = false
    const error = { textContent: "" }
    await runInNewContext(script, {
      window: {
        __REPLICA_CANVAS__: { token: "canvas-token" },
        location: {
          replace(url) {
            destination = url
          },
        },
      },
      document: { querySelector: () => error },
      fetch: async (url, options) => {
        assert.equal(url, "/api/prototype/status")
        assert.equal(options.headers["X-Replica-Canvas-Token"], "canvas-token")
        if (failed) throw new Error("Canvas connection interrupted")
        return new Response(JSON.stringify({ available }))
      },
      setTimeout(callback, delay) {
        assert.equal(delay, 5000)
        nextCheck = callback
      },
    })
    assert.equal(destination, undefined)
    assert.equal(error.textContent, "")
    failed = true
    await nextCheck()
    assert.match(error.textContent, /Canvas connection interrupted/)
    failed = false
    available = false
    await nextCheck()
    assert.equal(destination, "http://127.0.0.1:12345/?document=setup-document")
  })
})
