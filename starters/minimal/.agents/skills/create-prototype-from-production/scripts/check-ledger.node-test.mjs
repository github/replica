import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { checkLedger } from "./check-ledger.mjs"

const checker = fileURLToPath(new URL("./check-ledger.mjs", import.meta.url))

function fixtureDirectory(t) {
  const directory = mkdtempSync(join(process.cwd(), ".check-ledger-test-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

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
    {
      ...hub,
      url: "http://EXAMPLE.com:80/loans?term=24#details",
      route: "/loans?term=24#details",
      representative: false,
    },
    { url: "mailto:support@example.com", foundIn: ["footer"], decision: "stub-external" },
    { url: "tel:+15555550123", foundIn: ["footer"], decision: "stub-external" },
    { url: "https://example.com/help", foundIn: ["footer"], decision: "stub-external" },
    { url: "http://example.com:8080/help", foundIn: ["footer"], decision: "stub-external" },
    {
      url: "https://example.org/help?topic=cards#contact",
      foundIn: ["footer"],
      decision: "stub-external",
    },
  ])
  value.source = "http://EXAMPLE.com:80/cards?term=12#details"
  assert.deepEqual(checkLedger(value, { final: true }), [])
})

test("requires build targets to be HTTP(S) URLs on the source origin", async (t) => {
  for (const [name, url] of [
    ["different host", "https://example.org/loans"],
    ["different scheme", "http://example.com/loans"],
    ["different port", "https://example.com:8443/loans"],
    ["non-HTTP URL with the source origin", "blob:https://example.com/loans"],
  ]) {
    await t.test(name, () => {
      const page = { ...hub, url, route: "/loans", representative: false }
      assert.notDeepEqual(checkLedger(ledger([hub, page]), { final: true }), [])
    })
  }
})

test("does not allow a same-origin destination to bypass a local route as an outbound stub", () => {
  const page = {
    url: "https://EXAMPLE.com:443/loans?term=12#details",
    foundIn: ["footer"],
    decision: "stub-external",
  }
  assert.notDeepEqual(checkLedger(ledger([hub, page]), { final: true }), [])
})

test("rejects unsafe and unsupported live outbound schemes", async (t) => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,untrusted",
    "ftp://example.org/download",
  ]) {
    await t.test(url, () => {
      const page = { url, foundIn: ["footer"], decision: "stub-external" }
      assert.notDeepEqual(checkLedger(ledger([hub, page]), { final: true }), [])
    })
  }
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

test("requires a nonblank string note on every blocked local decision", async (t) => {
  for (const [decision, note] of [
    ["build", " \t\n"],
    ["stub-auth", {}],
    ["stub-download", 42],
    ["deferred", " \t\n"],
  ]) {
    await t.test(decision, () => {
      const page = {
        ...hub,
        url: "https://example.com/blocked",
        route: "/blocked",
        representative: false,
        decision,
        status: "blocked",
        note,
      }
      assert.match(checkLedger(ledger([hub, page]), { final: true }).join("\n"), /blocked.*note/i)
    })
  }
})

test("accepts explained blocked local rows with off-origin HTTP(S) boundary originals", () => {
  const note = "Local route verification is blocked because the browser is unavailable."
  const pages = [
    { ...hub, status: "blocked", note },
    ...[
      ["stub-auth", "https://login.example.org/authorize"],
      ["stub-download", "http://downloads.example.org/guide.pdf"],
      ["deferred", "https://example.org/out-of-scope"],
    ].map(([decision, url]) => ({
      url,
      foundIn: ["footer"],
      decision,
      route: `/${decision}`,
      status: "blocked",
      note,
    })),
  ]
  assert.deepEqual(checkLedger(ledger(pages), { final: true }), [])
})

test("requires HTTP(S) originals for auth, download and deferred local boundaries", async (t) => {
  for (const [decision, url] of [
    ["stub-auth", "javascript:void(0)"],
    ["stub-auth", "mailto:support@example.com"],
    ["stub-download", "appstore://example-app"],
    ["stub-download", "file:///replica-reference/guide.pdf"],
    ["deferred", "data:text/plain,not-built"],
    ["deferred", "tel:+15555550123"],
  ]) {
    await t.test(`${decision}: ${url}`, () => {
      const page = {
        url,
        foundIn: ["footer"],
        decision,
        route: "/boundary",
        status: "verified",
      }
      assert.notDeepEqual(checkLedger(ledger([hub, page]), { final: true }), [])
    })
  }
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
  const directory = fixtureDirectory(t)
  const script = join(directory, "with space", "check-ledger.mjs")
  mkdirSync(join(directory, "with space"))
  copyFileSync(checker, script)
  const path = join(directory, "coverage ledger.json")
  writeFileSync(path, JSON.stringify(ledger([hub])))
  const result = spawnSync(process.execPath, [script, path], {
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { "build/verified": 1 })
})

test("reports every local decision by status in the CLI summary", (t) => {
  const directory = fixtureDirectory(t)
  const path = join(directory, "coverage.json")
  const pages = [
    hub,
    ...["stub-auth", "stub-download", "deferred"].map((decision) => ({
      url: `https://example.com/${decision}`,
      foundIn: ["footer"],
      decision,
      route: `/${decision}`,
      status: "blocked",
      note: "The local boundary still needs browser verification.",
    })),
    {
      url: "https://example.com/login",
      foundIn: ["header"],
      decision: "stub-auth",
      route: "/login",
      status: "verified",
    },
    { url: "https://example.org/", foundIn: ["footer"], decision: "stub-external" },
  ]
  writeFileSync(path, JSON.stringify(ledger(pages)))
  const result = spawnSync(process.execPath, [checker, "--final", path], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    "build/verified": 1,
    "stub-auth/blocked": 1,
    "stub-auth/verified": 1,
    "stub-download/blocked": 1,
    "deferred/blocked": 1,
    "stub-external": 1,
  })
})

test("returns CLI validation diagnostics and JSON for malformed ledger shapes", async (t) => {
  for (const [name, value, diagnostic] of [
    ["non-array pages", ledger({}), /pages.*(?:destinations|array)/i],
    ["null page", ledger([null]), /pages\[0\]/],
    ["null ledger", null, /ledger:/],
  ]) {
    await t.test(name, (t) => {
      const directory = fixtureDirectory(t)
      const path = join(directory, "coverage.json")
      writeFileSync(path, JSON.stringify(value))
      const result = spawnSync(process.execPath, [checker, path], { encoding: "utf8" })
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, diagnostic)
      assert.doesNotMatch(result.stderr, /TypeError/)
      assert.deepEqual(JSON.parse(result.stdout), {})
    })
  }
})

test("accepts planned discovery through the CLI but rejects it with --final", (t) => {
  const directory = fixtureDirectory(t)
  mkdirSync(join(directory, "reference"))
  writeFileSync(
    join(directory, "reference", "coverage.json"),
    JSON.stringify(ledger([{ ...hub, status: "planned" }])),
  )
  const discovery = spawnSync(process.execPath, [checker], {
    cwd: directory,
    encoding: "utf8",
  })
  assert.equal(discovery.status, 0, discovery.stderr)
  assert.deepEqual(JSON.parse(discovery.stdout), { "build/planned": 1 })

  const final = spawnSync(process.execPath, [checker, "--final"], {
    cwd: directory,
    encoding: "utf8",
  })
  assert.equal(final.status, 1, final.stderr)
  assert.match(final.stderr, /not final/)
  assert.deepEqual(JSON.parse(final.stdout), { "build/planned": 1 })
})

test("rejects unknown CLI options instead of accepting planned discovery", async (t) => {
  for (const option of ["--fianl", "--final=true"]) {
    await t.test(option, (t) => {
      const directory = fixtureDirectory(t)
      const path = join(directory, "coverage.json")
      writeFileSync(path, JSON.stringify(ledger([{ ...hub, status: "planned" }])))
      const result = spawnSync(process.execPath, [checker, option, path], { encoding: "utf8" })
      assert.equal(result.status, 2, result.stderr)
      assert.ok(result.stderr.includes(option), result.stderr)
    })
  }
})

test("rejects excess CLI ledger paths", (t) => {
  const directory = fixtureDirectory(t)
  const first = join(directory, "first.json")
  const second = join(directory, "second.json")
  for (const path of [first, second]) writeFileSync(path, JSON.stringify(ledger([hub])))
  const result = spawnSync(process.execPath, [checker, first, second], { encoding: "utf8" })
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /ledger|path|file|argument/i)
})
