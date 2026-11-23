import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

import { closeServer } from "../close-server/index.mjs"
import { listenOnLoopback } from "../listen-on-loopback/index.mjs"

import { createStaticServer } from "./index.mjs"

describe("createStaticServer()", () => {
  it("serves a declared route only under the configured Build mount", async () => {
    const dist = await temporaryDirectory()
    const html = "<!doctype html><h1>App</h1>"
    const base = "/previews/github/2001/4001/"
    await writeFile(path.join(dist, "index.html"), html)
    const server = createStaticServer(dist, ["/settings/v2.0"], base)
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    const headers = { Accept: "text/html" }
    try {
      const response = await fetch(`${origin}${base}settings/v2.0`, { headers })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), html)
      for (const route of ["/settings/v2.0", "/previews/github/2001/4002/settings/v2.0"]) {
        assert.equal((await fetch(`${origin}${route}`, { headers })).status, 404, route)
      }
    } finally {
      await closeServer(server)
    }
  })

  it("serves client-side browser routes but never replaces missing assets with HTML", async () => {
    const dist = await temporaryDirectory()
    await writeFile(path.join(dist, "index.html"), "<!doctype html><h1>App</h1>")
    const server = createStaticServer(dist)
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    try {
      const page = await fetch(`${origin}/issues?state=open`, {
        headers: { Accept: "text/html" },
      })
      assert.equal(page.status, 200)
      assert.equal(await page.text(), "<!doctype html><h1>App</h1>")
      for (const url of ["/missing.js", "/missing.png", "/missing.json"]) {
        const response = await fetch(`${origin}${url}`, { headers: { Accept: "text/html" } })
        assert.equal(response.status, 404)
      }
      assert.equal((await fetch(`${origin}/issues`)).status, 404)
    } finally {
      await closeServer(server)
    }
  })

  it("falls back for declared dotted and directory routes without hiding missing assets", async () => {
    const dist = await temporaryDirectory()
    const html = "<!doctype html><h1>App</h1>"
    await writeFile(path.join(dist, "index.html"), html)
    await mkdir(path.join(dist, "assets"))
    await mkdir(path.join(dist, "other"))
    await writeFile(path.join(dist, "assets/app.js"), "console.log('App')")
    const longRoute = `/${"a".repeat(2047)}`
    const server = createStaticServer(dist, [
      "/release/v2.0?tab=notes#details",
      "/assets",
      "/assets/",
      "/caf\u00e9/v2.0",
      "/favicon.ico",
      longRoute,
    ])
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    try {
      for (const route of [
        "/release/v2.0?tab=notes",
        "/assets",
        "/assets/",
        "/caf%C3%A9/v2.0",
        "/favicon.ico",
        longRoute,
      ]) {
        const response = await fetch(`${origin}${route}`, { headers: { Accept: "text/html" } })
        assert.equal(response.status, 200, route)
        assert.equal(await response.text(), html, route)
      }
      for (const route of ["/release/v3.0", "/other", "/assets/missing.js", "/missing.png"]) {
        const response = await fetch(`${origin}${route}`, { headers: { Accept: "text/html" } })
        assert.equal(response.status, 404, route)
      }
      for (const route of ["/release/v2.0", "/assets"]) {
        assert.equal((await fetch(`${origin}${route}`)).status, 404, route)
      }
      const asset = await fetch(`${origin}/assets/app.js`, {
        headers: { Accept: "text/html" },
      })
      assert.equal(asset.status, 200)
      assert.equal(await asset.text(), "console.log('App')")
    } finally {
      await closeServer(server)
    }
  })
})
