import { createHash, randomUUID } from "node:crypto"
import dns from "node:dns"
import { once } from "node:events"
import fs from "node:fs"
import { isIP } from "node:net"
import { dirname, join, relative, resolve, sep } from "node:path"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"
import { checkPublicUrl, isPublicAddress, redactUrl } from "./check-public-url.mjs"

const DEFAULT_LIMITS = {
  maxBytes: 64 * 1024 ** 2,
  timeoutMs: 60_000,
  maxTotalBytes: 1024 ** 3,
  maxRedirects: 5,
}
const signatures = [
  ["png", /^89504e47/],
  ["jpg", /^ffd8ff/],
  ["gif", /^47494638/],
  ["webp", /^52494646.{8}57454250/],
  ["avif", /^.{8}6674797061766966/],
  ["mp4", /^.{8}66747970(?:69736f|6d7034)/],
  ["woff", /^774f4646/],
  ["woff2", /^774f4632/],
  ["ico", /^00000100/],
]

function fail(reason, policy = false) {
  throw Object.assign(new Error(reason), { reason, policy })
}

export async function fetchAssets(
  manifest,
  { outDir, lookup = dns.promises.lookup, fetch = globalThis.fetch, limits = DEFAULT_LIMITS } = {},
) {
  fs.mkdirSync(outDir, { recursive: true })
  const results = []
  const entries = []
  let total = 0
  for (const [index, entry] of manifest.entries()) {
    const result = { index, page: entry.page }
    let partial, signal
    try {
      if (total >= limits.maxTotalBytes) fail("exceeds run limit")
      let current = entry.url
      let response
      for (let hop = 0; hop <= limits.maxRedirects; hop++) {
        signal = undefined
        const reason = checkPublicUrl(current)
        if (reason) fail(reason, true)
        const hostname = new URL(current).hostname.replace(/^\[|\]$/g, "")
        if (!isIP(hostname)) {
          let addresses
          try {
            addresses = await lookup(hostname, { all: true })
          } catch {
            fail("DNS lookup failed")
          }
          if (addresses.some(({ address }) => !isPublicAddress(address)))
            fail("host resolves to a nonpublic address", true)
        }
        signal = AbortSignal.timeout(limits.timeoutMs)
        response = await fetch(current, { redirect: "manual", signal })
        const location = response.headers.get("location")
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) break
        await response.body?.cancel()
        if (hop === limits.maxRedirects) fail("too many redirects", true)
        current = new URL(location, current).href
      }
      if (!response.ok) {
        await response.body?.cancel()
        fail(`HTTP ${response.status}`)
      }
      partial = join(outDir, `.partial-${randomUUID()}`)
      const output = fs.createWriteStream(partial)
      await once(output, "open")
      const hash = createHash("sha256")
      let size = 0
      let head = Buffer.alloc(0)
      await pipeline(
        response.body,
        async function* (chunks) {
          for await (const chunk of chunks) {
            size += chunk.length
            total += chunk.length
            if (size > limits.maxBytes) fail("exceeds per-transfer limit")
            if (total > limits.maxTotalBytes) fail("exceeds run limit")
            if (head.length < 512)
              head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)])
            hash.update(chunk)
            yield chunk
          }
        },
        output,
      )
      const sha256 = hash.digest("hex")
      const type =
        signatures.find(([, pattern]) => pattern.test(head.toString("hex")))?.[0] ??
        (/^(?:\uFEFF|\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->)*<svg\b/i.test(head.toString("utf8"))
          ? "svg"
          : "bin")
      const destination = join(outDir, `${sha256}.${type}`)
      fs.renameSync(partial, destination)
      const path = relative(process.cwd(), destination).split(sep).join("/")
      entries.push({ source: redactUrl(entry.url), page: entry.page, path, size, sha256, type })
      Object.assign(result, { status: "fetched", path })
    } catch (error) {
      if (partial) fs.rmSync(partial, { force: true })
      Object.assign(result, {
        status: error.policy ? "rejected" : "failed",
        reason: signal?.aborted ? "timed out" : (error.reason ?? "transfer failed"),
      })
    }
    results.push(result)
  }
  return { results, entries }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  let manifestPath, outDir
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && !outDir && args[i + 1] && !args[i + 1].startsWith("-"))
      outDir = args[++i]
    else if (!args[i].startsWith("-") && !manifestPath) manifestPath = args[i]
    else {
      console.error("Usage: node fetch-assets.mjs <manifest.json> --out <dir>")
      process.exit(2)
    }
  }
  if (!manifestPath || !outDir) {
    console.error("Usage: node fetch-assets.mjs <manifest.json> --out <dir>")
    process.exit(2)
  }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    if (
      !Array.isArray(manifest) ||
      manifest.some(
        (entry) => !entry || typeof entry.url !== "string" || typeof entry.page !== "string",
      )
    )
      throw new Error()
  } catch {
    console.error("Cannot read manifest: expected an array of URL and page strings.")
    process.exit(2)
  }
  const metadata = resolve("reference/assets.json")
  let existing = []
  try {
    if (fs.existsSync(metadata)) existing = JSON.parse(fs.readFileSync(metadata, "utf8"))
    if (!Array.isArray(existing)) throw new Error()
  } catch {
    console.error("Cannot read asset metadata: expected a JSON array.")
    process.exit(2)
  }
  const { results, entries } = await fetchAssets(manifest, { outDir })
  const merged = new Map([...existing, ...entries].map((entry) => [entry.sha256, entry]))
  fs.mkdirSync(dirname(metadata), { recursive: true })
  fs.writeFileSync(metadata, JSON.stringify([...merged.values()], null, 2) + "\n")
  const counts = { fetched: 0, rejected: 0, failed: 0 }
  for (const { status } of results) counts[status]++
  console.log(JSON.stringify({ ...counts, results }))
  process.exitCode = counts.rejected || counts.failed ? 1 : 0
}
