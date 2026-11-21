import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { request } from "node:http"
import path from "node:path"
import { describe, it } from "node:test"

import { closeServer } from "../close-server/index.mjs"
import { listenOnLoopback } from "../listen-on-loopback/index.mjs"

import { createStaticServer } from "./index.mjs"

async function createDirectory(context) {
  const directory = path.resolve(`.static-server-test-${randomUUID()}`)
  await mkdir(directory)
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

describe("createStaticServer()", () => {
  it("serves only the compiled base with nested documents and logical template routes", async (context) => {
    const dist = await createDirectory(context)
    const base = "/previews/github/123/456/"
    await mkdir(path.join(dist, "docs"))
    await writeFile(
      path.join(dist, "index.html"),
      '<script src="/previews/github/123/456/app.js"></script>',
    )
    await writeFile(path.join(dist, "docs/index.html"), "<h1>Nested document</h1>")
    await writeFile(path.join(dist, "app.js"), "export const app = true")
    const server = createStaticServer(dist, ["/release/v2.0?tab=notes#details"], base)
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    try {
      const redirect = await fetch(`${origin}${base.slice(0, -1)}?tab=all`, { redirect: "manual" })
      assert.equal(redirect.status, 308)
      assert.equal(redirect.headers.get("location"), `${base}?tab=all`)
      const nested = await fetch(`${origin}${base}docs/`)
      assert.equal(await nested.text(), "<h1>Nested document</h1>")
      const route = await fetch(`${origin}${base}release/v2.0?tab=notes`, {
        headers: { Accept: "text/html" },
      })
      assert.equal(route.status, 200)
      assert.match(await route.text(), /src="\/previews\/github\/123\/456\/app.js"/)
      assert.equal((await fetch(`${origin}${base}app.js`)).status, 200)
      for (const path of ["/", "/app.js", `${base}missing.js`, "/previews/github/123/4567/app.js"])
        assert.equal(
          (await fetch(`${origin}${path}`, { headers: { Accept: "text/html" } })).status,
          404,
          path,
        )
    } finally {
      await closeServer(server)
    }
  })

  it("serves client-side browser routes but never replaces missing assets with HTML", async (context) => {
    const dist = await createDirectory(context)
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

  it("falls back for declared dotted and directory routes without hiding missing assets", async (context) => {
    const dist = await createDirectory(context)
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

  for (const base of ["/", "/previews/github/123/456/"]) {
    it(`decodes percent filenames once under ${base}`, async (context) => {
      const dist = await createDirectory(context)
      await mkdir(path.join(dist, "assets"))
      await writeFile(path.join(dist, "assets/100%complete.bin"), "literal percent bytes")
      await writeFile(path.join(dist, "assets/%2f.bin"), "literal encoded separator bytes")
      const server = createStaticServer(dist, [], base)
      const port = await listenOnLoopback(server)
      try {
        for (const [file, expected] of [
          ["100%25complete.bin", "literal percent bytes"],
          ["%252f.bin", "literal encoded separator bytes"],
        ]) {
          const response = await fetch(`http://127.0.0.1:${port}${base}assets/${file}`)
          assert.equal(response.status, 200)
          assert.equal(await response.text(), expected)
        }
        for (const unsafe of [
          "assets%2fprivate.bin",
          "assets%5cprivate.bin",
          "%2e%2e/private.bin",
        ]) {
          const status = await new Promise((resolve, reject) => {
            const outgoing = request(
              { hostname: "127.0.0.1", port, path: `${base}${unsafe}` },
              (response) => {
                response.resume()
                response.on("end", () => resolve(response.statusCode))
              },
            )
            outgoing.on("error", reject)
            outgoing.end()
          })
          assert.equal(status, 400, unsafe)
        }
      } finally {
        await closeServer(server)
      }
    })
  }

  it("uses a nested index only for a trailing slash, not its declared logical route", async (context) => {
    const dist = await createDirectory(context)
    const base = "/previews/github/123/456/"
    const rootHtml = "<h1>Root SPA</h1>"
    const nestedHtml = '<h1>Nested document</h1><script src="./app.js"></script>'
    await mkdir(path.join(dist, "docs"))
    await writeFile(path.join(dist, "index.html"), rootHtml)
    await writeFile(path.join(dist, "docs/index.html"), nestedHtml)
    await writeFile(path.join(dist, "docs/app.js"), "nested asset")
    const server = createStaticServer(dist, ["/docs"], base)
    const port = await listenOnLoopback(server)
    const origin = `http://127.0.0.1:${port}`
    try {
      const logical = await fetch(`${origin}${base}docs`, { headers: { Accept: "text/html" } })
      assert.equal(logical.status, 200)
      assert.equal(await logical.text(), rootHtml)
      const nestedUrl = `${origin}${base}docs/`
      const nested = await fetch(nestedUrl, { headers: { Accept: "text/html" } })
      assert.equal(nested.status, 200)
      assert.equal(await nested.text(), nestedHtml)
      const asset = await fetch(new URL("./app.js", nestedUrl))
      assert.equal(await asset.text(), "nested asset")
    } finally {
      await closeServer(server)
    }
  })
})
