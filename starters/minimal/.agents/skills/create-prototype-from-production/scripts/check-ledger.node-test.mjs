import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkLedger } from "./check-ledger.mjs"

function ledger(pages) {
  return {
    source: "https://example.com/",
    browser: { cookies: 0, pages: 1, checkedAt: "2026-01-01T00:00:00Z" },
    access: { "https://example.com": "browser" },
    pages,
  }
}

const hub = {
  url: "https://example.com/cards",
  foundIn: ["header"],
  family: "hub",
  representative: true,
  decision: "build",
  route: "/cards",
  status: "verified",
}

test("accepts a complete final ledger", () => {
  const pages = [
    hub,
    { ...hub, url: "https://example.com/loans", route: "/loans", representative: false },
    { url: "https://example.org/", foundIn: ["footer"], decision: "stub-external" },
    {
      url: "https://login.example.com/",
      foundIn: ["header"],
      decision: "stub-auth",
      route: "/login",
      status: "verified",
    },
  ]
  assert.deepEqual(checkLedger(ledger(pages), { final: true }), [])
})

test("rejects a ledger without runtime isolation proof", () => {
  const value = { ...ledger([hub]), browser: undefined }
  assert.match(checkLedger(value).join("\n"), /isolation proof/)
})

test("rejects planned pages at handoff but not during discovery", () => {
  const pages = [{ ...hub, status: "planned" }]
  assert.deepEqual(checkLedger(ledger(pages)), [])
  assert.match(checkLedger(ledger(pages), { final: true }).join("\n"), /not final/)
})

test("requires exactly one representative per family", () => {
  const pages = [hub, { ...hub, url: "https://example.com/loans", route: "/loans" }]
  assert.match(checkLedger(ledger(pages)).join("\n"), /exactly one representative/)
})

test("rejects a URL listed under two decisions", () => {
  const pages = [hub, { url: hub.url, foundIn: ["header"], decision: "stub-auth" }]
  assert.match(checkLedger(ledger(pages)).join("\n"), /listed more than once/)
})

test("rejects duplicate routes and unexplained blocks", () => {
  const pages = [
    hub,
    { ...hub, url: "https://example.com/x", representative: false, status: "blocked" },
  ]
  const problems = checkLedger(ledger(pages)).join("\n")
  assert.match(problems, /also used by/)
  assert.match(problems, /blocked without a note/)
})

test("requires a local route and final status for local boundaries", () => {
  const login = { url: "https://login.example.com/", foundIn: ["header"], decision: "stub-auth" }
  const missing = checkLedger(ledger([hub, login]), { final: true }).join("\n")
  assert.match(missing, /login\.example\.com\/: local boundary has no local route/)
  assert.match(missing, /login\.example\.com\/: unknown status/)

  const planned = { ...login, route: "/login", status: "planned" }
  assert.match(checkLedger(ledger([hub, planned]), { final: true }).join("\n"), /not final/)
})

test("rejects a route that is not a local path", () => {
  const pages = [{ ...hub, route: "https://example.com/cards" }]
  assert.match(checkLedger(ledger(pages)).join("\n"), /no local route/)
})

test("checks the ledger when run from a path with spaces", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "check ledger "))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const script = join(directory, "with space", "check-ledger.mjs")
  mkdirSync(join(directory, "with space"))
  copyFileSync(fileURLToPath(new URL("./check-ledger.mjs", import.meta.url)), script)
  const result = spawnSync(process.execPath, [script, join(directory, "missing.json")], {
    encoding: "utf8",
  })
  assert.equal(result.status, 2, result.stderr)
})
