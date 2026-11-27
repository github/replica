import assert from "node:assert/strict"
import { createServer } from "node:http"
import { describe, it } from "node:test"

import { MAX_BROWSER_PREVIEW_URL_LENGTH } from "../agent-commands/index.mjs"
import { startCanvasServer } from "./index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"

function config(html) {
  return JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
}

describe("browser prototype preview", () => {
  it("opens the requested route and settings in a wrapper without granting canvas authority", async () => {
    await withContext(async (context) => {
      const launched = []
      const canvas = await startCanvasServer(
        context,
        { send: assert.fail },
        {
          openBrowser: async (url) => {
            launched.push(url)
            return { ok: true }
          },
        },
      )
      try {
        const canvasConfig = config(await (await fetch(canvas.url)).text())
        const target = new URL("/settings?view=compact#details", context.normalizedUrl)
        target.searchParams.set("rc.page.title", JSON.stringify("A & B"))
        const response = await fetch(new URL("/api/prototype/open", canvas.url), {
          method: "POST",
          headers: { "X-Replica-Canvas-Token": canvasConfig.token },
          body: JSON.stringify({ url: target.href }),
        })
        assert.equal(response.status, 200)
        assert.equal(launched.length, 1)
        const wrapper = new URL(launched[0])
        assert.equal(wrapper.origin, new URL(canvas.url).origin)
        assert.equal(wrapper.pathname, "/browser")
        assert.equal(wrapper.searchParams.get("url"), target.href)
        const document = wrapper.searchParams.get("document")
        assert.ok(document)
        assert.notEqual(document, canvasConfig.token)
        assert.notEqual(document, new URL(canvas.url).searchParams.get("document"))
        const page = await fetch(wrapper)
        assert.equal(page.status, 200)
        const html = await page.text()
        const browserConfig = config(html)
        assert.equal(browserConfig.surface, "browser")
        assert.equal(browserConfig.prototypeUrl, target.href)
        assert.equal(browserConfig.name, context.name)
        assert.equal("token" in browserConfig, false)
        assert.equal(html.includes(canvasConfig.token), false)
        const preview = new URL(browserConfig.previewUrl)
        assert.notEqual(preview.origin, target.origin)

        const canvasDocument = new URL("/", canvas.url)
        canvasDocument.searchParams.set("document", document)
        assert.equal((await fetch(canvasDocument)).status, 403)
        for (const [route, method] of [
          ["/api/prototype/open", "POST"],
          ["/api/publish/prepare", "POST"],
          ["/api/improvement-notes", "GET"],
          ["/api/agent/next", "GET"],
        ]) {
          for (const headers of [{}, { "X-Replica-Canvas-Token": document }]) {
            const denied = await fetch(new URL(route, wrapper), {
              method,
              headers,
              ...(method === "POST" ? { body: JSON.stringify({ url: target.href }) } : {}),
            })
            assert.equal(denied.status, 403, `${method} ${route} requires canvas authority`)
          }
        }
        assert.equal(launched.length, 1)
        assert.equal((await fetch(canvas.url)).status, 200)
      } finally {
        await canvas.close()
      }
    })
  })

  it("rejects missing or wrong browser capabilities and targets outside the original origin", async () => {
    await withContext(async (context) => {
      let launched
      const canvas = await startCanvasServer(
        context,
        { send: assert.fail },
        {
          openBrowser: async (url) => {
            launched = url
            return { ok: true }
          },
        },
      )
      try {
        const { token } = config(await (await fetch(canvas.url)).text())
        await fetch(new URL("/api/prototype/open", canvas.url), {
          method: "POST",
          headers: { "X-Replica-Canvas-Token": token },
          body: JSON.stringify({ url: context.normalizedUrl }),
        })
        const wrapper = new URL(launched)
        for (const document of [
          null,
          "wrong",
          token,
          new URL(canvas.url).searchParams.get("document"),
        ]) {
          const request = new URL(wrapper)
          if (document === null) request.searchParams.delete("document")
          else request.searchParams.set("document", document)
          assert.equal((await fetch(request)).status, 403)
        }
        const duplicateDocument = new URL(wrapper)
        duplicateDocument.searchParams.append("document", wrapper.searchParams.get("document"))
        assert.equal((await fetch(duplicateDocument)).status, 403)
        const duplicateTarget = new URL(wrapper)
        duplicateTarget.searchParams.append("url", context.normalizedUrl)
        assert.equal((await fetch(duplicateTarget)).status, 422)
        for (const target of [
          "https://elsewhere.example/settings",
          new URL("/settings", config(await (await fetch(canvas.url)).text()).previewUrl).href,
          "http://someone:password@localhost:3000/settings",
          "javascript:alert(1)",
        ]) {
          const request = new URL(wrapper)
          request.searchParams.set("url", target)
          assert.equal((await fetch(request)).status, 422, target)
        }
        const missingTarget = new URL(wrapper)
        missingTarget.searchParams.delete("url")
        assert.equal((await fetch(missingTarget)).status, 422)
      } finally {
        await canvas.close()
      }
    })
  })

  it("opens and reloads a long saved-options target through the real HTTP request boundary", async () => {
    await withContext(async (context) => {
      const launched = []
      const prototype = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        response.end("<!doctype html><title>Prototype</title>")
      })
      await new Promise((resolve) => prototype.listen(0, "127.0.0.1", resolve))
      const prototypeUrl = `http://127.0.0.1:${prototype.address().port}/`
      const canvas = await startCanvasServer(
        context,
        { send: assert.fail },
        {
          openBrowser: async (url) => {
            launched.push(url)
            return { ok: true }
          },
        },
      )
      try {
        await canvas.setContext({ ...context, normalizedUrl: prototypeUrl })
        const { token } = config(await (await fetch(canvas.url)).text())
        function open(url) {
          return fetch(new URL("/api/prototype/open", canvas.url), {
            method: "POST",
            headers: { "X-Replica-Canvas-Token": token },
            body: JSON.stringify({ url }),
          })
        }
        assert.equal((await open(prototypeUrl)).status, 200)
        const target = new URL("/items#selected", prototypeUrl)
        target.searchParams.set("search", "x".repeat(7000))
        const controls = new URLSearchParams({
          "rc.page.title": JSON.stringify("&".repeat(2000)),
        })
        target.searchParams.set("rc.page.title", controls.get("rc.page.title"))
        target.searchParams.set("padding", "")
        target.searchParams.set(
          "padding",
          "x".repeat(MAX_BROWSER_PREVIEW_URL_LENGTH - target.href.length),
        )
        assert.equal(target.href.length, MAX_BROWSER_PREVIEW_URL_LENGTH)
        const oversizedTarget = new URL(prototypeUrl)
        oversizedTarget.searchParams.set("padding", "")
        oversizedTarget.searchParams.set(
          "padding",
          "x".repeat(MAX_BROWSER_PREVIEW_URL_LENGTH - oversizedTarget.href.length + 1),
        )
        assert.equal(oversizedTarget.href.length, MAX_BROWSER_PREVIEW_URL_LENGTH + 1)
        assert.equal((await open(oversizedTarget.href)).status, 422)
        const currentWrapper = new URL(launched[0])
        currentWrapper.searchParams.set("url", target.href)
        assert.ok(Buffer.byteLength(currentWrapper.pathname + currentWrapper.search) > 16384)

        const launch = await open(target.href)
        const reload = await fetch(currentWrapper)
        assert.deepEqual(
          { launch: launch.status, reload: reload.status },
          { launch: 200, reload: 200 },
        )
        const launchedWrapper = new URL(launched.at(-1))
        assert.equal(launchedWrapper.searchParams.get("url"), target.href)
        const browserConfig = config(await reload.text())
        assert.equal(browserConfig.prototypeUrl, target.href)
        const iframeUrl = new URL(`${target.pathname}${target.search}`, browserConfig.previewUrl)
        const iframe = await fetch(iframeUrl)
        assert.equal(iframe.status, 200)
        assert.match(await iframe.text(), /<title>Prototype<\/title>/)
        const reopened = await fetch(launchedWrapper)
        assert.equal(reopened.status, 200)
        assert.equal(config(await reopened.text()).prototypeUrl, target.href)
      } finally {
        await canvas.close()
        await new Promise((resolve) => prototype.close(resolve))
      }
    })
  })

  it("restores settings from the current wrapper target and invalidates it when upstream changes", async () => {
    await withContext(async (context) => {
      let launched
      let closed = false
      const canvas = await startCanvasServer(
        context,
        { send: assert.fail },
        {
          openBrowser: async (url) => {
            launched = url
            return { ok: true }
          },
        },
      )
      try {
        const { token } = config(await (await fetch(canvas.url)).text())
        await fetch(new URL("/api/prototype/open", canvas.url), {
          method: "POST",
          headers: { "X-Replica-Canvas-Token": token },
          body: JSON.stringify({ url: context.normalizedUrl }),
        })
        const wrapper = new URL(launched)
        const updated = new URL("/next?view=list#item", context.normalizedUrl)
        updated.searchParams.set("rc.page.title", JSON.stringify("Edited"))
        wrapper.searchParams.set("url", updated.href)
        for (let reload = 0; reload < 2; reload++) {
          const response = await fetch(wrapper)
          assert.equal(response.status, 200)
          assert.equal(config(await response.text()).prototypeUrl, updated.href)
        }
        await canvas.setContext({ ...context, normalizedUrl: "http://localhost:3001/" })
        assert.equal((await fetch(wrapper)).status, 422)
        await canvas.close()
        closed = true
        await assert.rejects(fetch(wrapper))
      } finally {
        if (!closed) await canvas.close()
      }
    })
  })
})
