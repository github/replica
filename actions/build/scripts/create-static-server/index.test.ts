import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { describe, expect, it, onTestFinished } from "vitest"

import { temporaryDirectory } from "../../test/temporary-directory/index.ts"

import { closeServer } from "../close-server/index.ts"
import { listenOnLoopback } from "../listen-on-loopback/index.ts"

import { createStaticServer } from "./index.ts"

describe("createStaticServer()", () => {
  it("serves client-side browser routes but never replaces missing assets with HTML", async () => {
    const dist = await temporaryDirectory()
    await writeFile(path.join(dist, "index.html"), "<!doctype html><h1>App</h1>")
    const server = createStaticServer(dist)
    onTestFinished(() => closeServer(server))
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    const page = await fetch(`${origin}/issues?state=open`, {
      headers: { Accept: "text/html" },
    })
    expect(page.status).toBe(200)
    expect(await page.text()).toBe("<!doctype html><h1>App</h1>")
    for (const url of ["/missing.js", "/missing.png", "/missing.json"]) {
      const response = await fetch(`${origin}${url}`, { headers: { Accept: "text/html" } })
      expect(response.status).toBe(404)
    }
    expect((await fetch(`${origin}/issues`)).status).toBe(404)
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
    onTestFinished(() => closeServer(server))
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    for (const route of [
      "/release/v2.0?tab=notes",
      "/assets",
      "/assets/",
      "/caf%C3%A9/v2.0",
      "/favicon.ico",
      longRoute,
    ]) {
      const response = await fetch(`${origin}${route}`, { headers: { Accept: "text/html" } })
      expect(response.status, route).toBe(200)
      expect(await response.text(), route).toBe(html)
    }
    for (const route of ["/release/v3.0", "/other", "/assets/missing.js", "/missing.png"]) {
      const response = await fetch(`${origin}${route}`, { headers: { Accept: "text/html" } })
      expect(response.status, route).toBe(404)
    }
    for (const route of ["/release/v2.0", "/assets"]) {
      expect((await fetch(`${origin}${route}`)).status, route).toBe(404)
    }
    const asset = await fetch(`${origin}/assets/app.js`, {
      headers: { Accept: "text/html" },
    })
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe("console.log('App')")
  })
})
