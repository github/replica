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
    source: "https://example.com/cards",
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
    {
      ...hub,
      url: "https://example.com/loans",
      route: "/loans?term=12#details",
      representative: false,
    },
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

test("requires zero cookies and exactly one reported browser page", async (t) => {
  for (const [name, browser] of [
    ["missing page count", { cookies: 0 }],
    ["no browser page", { cookies: 0, pages: 0 }],
    ["extra browser page", { cookies: 0, pages: 2 }],
    ["cookies present", { cookies: 1, pages: 1 }],
  ]) {
    await t.test(name, () => {
      const value = { ...ledger([hub]), browser }
      assert.notDeepEqual(checkLedger(value), [])
    })
  }
})

test("requires an absolute URL on every destination row", async (t) => {
  for (const [name, decision, url] of [
    ["missing outbound URL", "stub-external", undefined],
    ["missing build URL", "build", undefined],
    ["non-string URL", "stub-external", 42],
    ["blank URL", "stub-external", " \t"],
    ["malformed URL", "stub-external", "https://[invalid"],
    ["relative URL", "stub-external", "/contact"],
  ]) {
    await t.test(name, () => {
      const page =
        decision === "build"
          ? { ...hub, url, representative: false, route: "/other" }
          : { url, foundIn: ["footer"], decision }
      assert.notDeepEqual(checkLedger(ledger([hub, page])), [])
    })
  }
})

test("accepts a normalized HTTP subpath source with query and fragment and nonnetwork outbound URLs", () => {
  const value = ledger([
    { ...hub, url: "http://example.com/cards?term=12#details" },
    { url: "mailto:support@example.com", foundIn: ["footer"], decision: "stub-external" },
    { url: "tel:+15555550123", foundIn: ["footer"], decision: "stub-external" },
    {
      url: "https://example.org/help?topic=cards#contact",
      foundIn: ["footer"],
      decision: "stub-external",
    },
  ])
  value.source = "http://EXAMPLE.com:80/cards?term=12#details"
  assert.deepEqual(checkLedger(value, { final: true }), [])
})

test("requires the source to be an absolute HTTP or HTTPS website URL", async (t) => {
  for (const [name, source] of [
    ["missing source", undefined],
    ["blank source", " "],
    ["relative source", "/cards"],
    ["malformed source", "https://[invalid"],
    ["nonwebsite source", "mailto:support@example.com"],
  ]) {
    await t.test(name, () => {
      const value = { ...ledger([hub]), source }
      for (const final of [false, true]) {
        assert.notDeepEqual(checkLedger(value, { final }), [], `final: ${final}`)
      }
    })
  }
})

test("requires a source row without dropping its query or fragment", async (t) => {
  for (const source of [
    "https://example.com/missing",
    "https://example.com/cards?term=12",
    "https://example.com/cards#details",
  ]) {
    await t.test(source, () => {
      const value = { ...ledger([hub]), source }
      for (const final of [false, true]) {
        assert.notDeepEqual(checkLedger(value, { final }), [], `final: ${final}`)
      }
    })
  }
})

test("does not accept an outbound-only stub as the source", () => {
  const value = ledger([
    {
      url: hub.url,
      foundIn: ["source"],
      decision: "stub-external",
      note: "The source still needs a local page or an explicit boundary.",
    },
  ])
  for (const final of [false, true]) {
    assert.notDeepEqual(checkLedger(value, { final }), [], `final: ${final}`)
  }
})

test("allows the source to remain an auth, download or explicitly deferred local boundary", async (t) => {
  for (const decision of ["stub-auth", "stub-download", "deferred"]) {
    await t.test(decision, () => {
      const page = {
        url: hub.url,
        foundIn: ["source"],
        decision,
        route: "/source-boundary",
        status: "verified",
      }
      if (decision === "deferred") page.note = "The agreed scope excludes the source page."
      for (const final of [false, true]) {
        assert.deepEqual(checkLedger(ledger([page]), { final }), [], `final: ${final}`)
      }
    })
  }
})

test("requires a nonblank reason when the source is explicitly deferred", async (t) => {
  for (const note of [undefined, "", " \t\n"]) {
    await t.test(`note: ${JSON.stringify(note)}`, () => {
      const value = ledger([
        {
          url: hub.url,
          foundIn: ["source"],
          decision: "deferred",
          route: "/source-boundary",
          status: "verified",
          note,
        },
      ])
      for (const final of [false, true]) {
        assert.notDeepEqual(checkLedger(value, { final }), [], `final: ${final}`)
      }
    })
  }
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
  for (const route of [
    "https://example.com/cards",
    "//external.example/cards",
    "/\\external.example/cards",
    "/\t/external.example/cards",
  ]) {
    const pages = [{ ...hub, route }]
    assert.match(checkLedger(ledger(pages)).join("\n"), /no local route/, JSON.stringify(route))
  }
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
