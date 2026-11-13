import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { checkLedger } from "./check-ledger.mjs"

const checker = fileURLToPath(new URL("./check-ledger.mjs", import.meta.url))
const hub = {
  url: "https://example.com/cards",
  foundIn: ["header"],
  family: "cards",
  representative: true,
  decision: "build",
  route: "/cards",
  status: "verified",
  note: "The cards heading and grid render.",
}
const other = { ...hub, url: "https://example.com/other", route: "/other", representative: false }
const outbound = { url: "https://example.org/", foundIn: ["footer"], decision: "stub-external" }
const ledger = (pages = [hub]) => ({
  source: hub.url,
  browser: { cookies: 0, pages: 1 },
  access: { "https://example.com": "browser" },
  pages,
})
const problems = (value, options) => checkLedger(value, options).join("\n")

test("accepts a complete final ledger", () => {
  assert.deepEqual(checkLedger(ledger([hub, other, outbound]), { final: true }), [])
})

test("permits planned discovery but not final handoff", () => {
  const value = ledger([{ ...hub, status: "planned", note: undefined }])
  assert.deepEqual(checkLedger(value), [])
  assert.match(problems(value, { final: true }), /status is not final/)
})

test("requires zero cookies and exactly one browser page", () => {
  for (const browser of [
    undefined,
    { cookies: 1, pages: 1 },
    { cookies: 0, pages: 0 },
    { cookies: 0, pages: 2 },
  ]) {
    assert.match(problems({ ...ledger(), browser }), /zero cookies and exactly one page/)
  }
})

test("requires absolute URLs on every row", () => {
  for (const url of [undefined, "/relative", "not a url", 42]) {
    assert.match(problems(ledger([hub, { ...outbound, url }])), /absolute destination URL/)
  }
})

test("rejects duplicate URLs", () => {
  assert.match(problems(ledger([hub, { ...other, url: hub.url }])), /listed more than once/)
})

test("rejects source credentials without echoing them", () => {
  for (const source of [
    "https://u:private-password@example.com/cards",
    `${hub.url}?token=private-token`,
  ]) {
    const text = problems({ ...ledger([{ ...hub, url: source }]), source })
    assert.match(text, /source:.*credential/)
    assert.equal(text.includes(source), false)
    assert.doesNotMatch(text, /private-password|private-token/)
  }
})

test("rejects a nonpublic source", () => {
  assert.match(problems({ ...ledger(), source: "http://127.1/" }), /source: nonpublic IP/)
})

test("requires a row representing the source", () => {
  assert.match(problems(ledger([other])), /source: no row represents the source URL/)
})

test("requires a note for a deferred source", () => {
  const value = ledger([{ ...hub, decision: "deferred", status: "planned", note: " " }])
  assert.match(problems(value), /source: deferred without a scope-exclusion reason/)
})

test("rejects nonpublic HTTP destinations", () => {
  assert.match(
    problems(ledger([hub, { ...outbound, url: "http://169.254.169.254/" }])),
    /pages\[1\]: nonpublic IP/,
  )
})

test("requires HTTP builds on the source origin", () => {
  for (const url of [
    "https://example.org/other",
    "http://example.com/other",
    "blob:https://example.com/other",
  ]) {
    assert.match(
      problems(ledger([hub, { ...other, url }])),
      /build target must be an HTTP\(S\) URL on the source origin/,
    )
  }
})

test("allows only off-origin HTTP, mail and telephone outbound stubs", () => {
  for (const url of ["https://example.org/", "mailto:help@example.com", "tel:+15555550123"]) {
    assert.deepEqual(checkLedger(ledger([hub, { ...outbound, url }])), [])
  }
  for (const url of ["https://example.com/other", "javascript:alert(1)"]) {
    assert.match(problems(ledger([hub, { ...outbound, url }])), /external target must be off-origin/)
  }
})

test("requires HTTP originals for local boundaries", () => {
  for (const decision of ["stub-auth", "stub-download", "deferred"]) {
    assert.match(
      problems(ledger([hub, { ...other, decision, url: "mailto:help@example.com" }])),
      /local boundary target must be HTTP\(S\)/,
    )
  }
})

test("requires a local route", () => {
  assert.match(problems(ledger([{ ...hub, route: undefined }])), /has no local route/)
})

test("rejects routes that are not local paths", () => {
  for (const route of ["https://example.com/cards", "//example.com/cards", "/a\\b"]) {
    assert.match(problems(ledger([{ ...hub, route }])), /has no local route/)
  }
})

test("requires unique local routes", () => {
  assert.match(
    problems(ledger([hub, { ...other, route: hub.route }])),
    /local route also used by pages\[0\]/,
  )
})

test("requires nonblank notes on blocked and verified rows", () => {
  for (const status of ["blocked", "verified"]) {
    assert.match(problems(ledger([{ ...hub, status, note: " " }])), new RegExp(`${status} without`))
  }
})

test("requires exactly one representative per named family and labels the second representative", () => {
  assert.match(
    problems(ledger([{ ...hub, representative: false }])),
    /pages\[0\]: family "cards" needs exactly one representative, found 0/,
  )
  assert.match(
    problems(ledger([hub, { ...other, representative: true }])),
    /pages\[1\]: family "cards" needs exactly one representative, found 2/,
  )
})

test("rejects non-boolean representative values", () => {
  for (const representative of ["yes", 1, null]) {
    assert.match(
      problems(ledger([{ ...hub, representative }])),
      /representative must be true or omitted/,
    )
  }
})

test("requires a verified source even when its only row is blocked", () => {
  assert.match(
    problems(ledger([{ ...hub, status: "blocked" }]), { final: true }),
    /source: final ledger requires a verified source row/,
  )
})

test("diagnostics do not echo supplied URLs or routes", () => {
  const source = "https://user:secret@example.com/private-source"
  const url = "http://127.1/private-target"
  const route = "//private-route"
  const text = problems({
    ...ledger([{ ...hub, url: source, route }, { ...other, url, route }]),
    source,
  })
  assert.ok(text.length > 0)
  for (const value of [source, url, route, "private-source", "private-target", "private-route"]) {
    assert.equal(text.includes(value), false)
  }
})

test("CLI prints summary JSON and handles validation, usage and JSON errors from a path with spaces", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "check-ledger space-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, "coverage data.json")
  const run = (...args) =>
    spawnSync(process.execPath, [checker, path, ...args], { cwd: dir, encoding: "utf8" })
  writeFileSync(path, JSON.stringify(ledger()))
  const good = run("--final")
  assert.equal(good.status, 0)
  assert.deepEqual(JSON.parse(good.stdout), { "build/verified": 1 })
  writeFileSync(path, JSON.stringify(ledger([{ ...hub, status: "planned" }])))
  const bad = run("--final")
  assert.equal(bad.status, 1)
  assert.deepEqual(JSON.parse(bad.stdout), { "build/planned": 1 })
  assert.match(bad.stderr, /status is not final/)
  assert.equal(run("--unknown").status, 2)
  assert.equal(run("extra.json").status, 2)
  writeFileSync(path, '{"private-malformed-content":')
  const malformed = run()
  assert.equal(malformed.status, 2)
  assert.doesNotMatch(malformed.stdout + malformed.stderr, /private-malformed-content/)
})

test("malformed shapes produce diagnostics without throwing", () => {
  for (const value of [
    null,
    [],
    { ...ledger(), pages: {} },
    ledger([null, [], 42, "page"]),
    ledger([{ ...hub, url: 42 }]),
  ]) {
    assert.doesNotThrow(() => assert.ok(checkLedger(value).length > 0))
  }
})
