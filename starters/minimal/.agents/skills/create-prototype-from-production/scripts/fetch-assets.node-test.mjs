import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { fetchAssets } from "./fetch-assets.mjs"

const script = fileURLToPath(new URL("./fetch-assets.mjs", import.meta.url))
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
const defaults = {
  maxBytes: 64 * 1024 ** 2,
  timeoutMs: 60_000,
  maxTotalBytes: 1024 ** 3,
  maxRedirects: 5,
}

function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), "fetch-assets-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function fixture(t, limits = {}) {
  const outDir = directory(t)
  const server = createServer((req, res) => {
    if (req.url === "/private") {
      res.writeHead(302, { location: `http://private.example.com:${server.address().port}/a.png` })
    } else if (req.url.startsWith("/redirect/")) {
      const step = Number(req.url.split("/").pop())
      res.writeHead(302, {
        location: `http://cdn.example.com:${server.address().port}/redirect/${step + 1}`,
      })
    } else if (req.url === "/stall") {
      res.writeHead(200)
      res.flushHeaders()
      return
    } else if (req.url === "/large") {
      res.write(Buffer.alloc(2048))
      res.end(Buffer.alloc(2048))
      return
    } else {
      res.end(png)
      return
    }
    res.end()
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  t.after(() => {
    server.closeAllConnections()
    return new Promise((resolve) => server.close(resolve))
  })
  const base = `http://cdn.example.com:${server.address().port}`
  const options = {
    outDir,
    limits: { ...defaults, ...limits },
    lookup: async (host) => [
      { address: host === "private.example.com" ? "10.0.0.5" : "93.184.216.34", family: 4 },
    ],
    fetch: (value, init) => {
      const url = new URL(value)
      url.hostname = "127.0.0.1"
      return globalThis.fetch(url, init)
    },
  }
  return { outDir, base, run: (url) => fetchAssets([{ url, page: "/home" }], options) }
}

test("fetches a PNG with content-addressed metadata", async (t) => {
  const { outDir, base, run } = await fixture(t)
  const { results, entries } = await run(`${base}/a.png`)
  const sha256 = createHash("sha256").update(png).digest("hex")
  assert.equal(results[0].status, "fetched")
  assert.equal(entries[0].type, "png")
  assert.equal(entries[0].size, png.length)
  assert.equal(entries[0].sha256, sha256)
  assert.deepEqual(readdirSync(outDir), [`${sha256}.png`])
  assert.deepEqual(readFileSync(join(outDir, `${sha256}.png`)), png)
})

test("rejects hosts resolving to private addresses", async (t) => {
  const { outDir, base, run } = await fixture(t)
  const { results } = await run(`${base.replace("cdn.", "private.")}/a.png`)
  assert.equal(results[0].status, "rejected")
  assert.equal(results[0].reason, "host resolves to a nonpublic address")
  assert.deepEqual(readdirSync(outDir), [])
})

test("rechecks DNS after redirects", async (t) => {
  const { outDir, base, run } = await fixture(t)
  const { results } = await run(`${base}/private`)
  assert.equal(results[0].status, "rejected")
  assert.deepEqual(readdirSync(outDir), [])
})

test("rejects six chained redirects", async (t) => {
  const { base, run } = await fixture(t)
  const { results } = await run(`${base}/redirect/0`)
  assert.equal(results[0].status, "rejected")
  assert.equal(results[0].reason, "too many redirects")
})

test("removes partial files when the transfer exceeds its byte limit", async (t) => {
  const { outDir, base, run } = await fixture(t, { maxBytes: 1024 })
  const { results } = await run(`${base}/large`)
  assert.equal(results[0].status, "failed")
  assert.equal(results[0].reason, "exceeds per-transfer limit")
  assert.deepEqual(readdirSync(outDir), [])
})

test("times out stalled bodies and removes partial files", async (t) => {
  const { outDir, base, run } = await fixture(t, { timeoutMs: 200 })
  const { results } = await run(`${base}/stall`)
  assert.equal(results[0].status, "failed")
  assert.equal(results[0].reason, "timed out")
  assert.deepEqual(readdirSync(outDir), [])
})

test("fetches signed URLs but redacts their metadata", async (t) => {
  const { base, run } = await fixture(t)
  const { results, entries } = await run(`${base}/a.png?X-Amz-Signature=secret123&token=tok`)
  assert.equal(results[0].status, "fetched")
  const source = new URL(entries[0].source)
  assert.equal(source.searchParams.get("X-Amz-Signature"), "REDACTED")
  assert.equal(source.searchParams.get("token"), "REDACTED")
  assert.doesNotMatch(source.searchParams.toString(), /secret123|=tok(?:&|$)/)
})

test("treats shell syntax as URL data", async (t) => {
  const { outDir, base, run } = await fixture(t)
  const { results } = await run(`${base}/a/$(touch%20pwned)/b.png`)
  assert.equal(results[0].status, "fetched")
  assert.equal(existsSync(join(process.cwd(), "pwned")), false)
  assert.equal(existsSync(join(outDir, "pwned")), false)
})

test("CLI reports rejections without URLs and rejects usage errors", (t) => {
  const dir = directory(t)
  const manifest = join(dir, "manifest.json")
  writeFileSync(manifest, JSON.stringify([{ url: "http://127.0.0.1/x.png", page: "/home" }]))
  const result = spawnSync(process.execPath, [script, manifest, "--out", join(dir, "assets")], {
    cwd: dir,
    encoding: "utf8",
  })
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).rejected, 1)
  assert.doesNotMatch(result.stdout + result.stderr, /127\.0\.0\.1\/x\.png/)
  assert.equal(spawnSync(process.execPath, [script, manifest], { cwd: dir }).status, 2)
})
