import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  auditDependencies,
  loadDependencies,
  registryClient,
  type Dependency,
} from "./check-dependency-age.ts"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture(files: Record<string, unknown>) {
  const root = mkdtempSync(join(import.meta.dirname, ".age-test-"))
  directories.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content))
  }
  return root
}
const dependency = (name: string): Dependency => ({
  ecosystem: "npm",
  name,
  version: "1.0.0",
  source: "package-lock.json",
})

test("loads nested and aliased npm packages, excluding Starter and installed dependencies", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root", version: "1.0.0" },
      "node_modules/@scope/alias": { name: "@scope/actual", version: "2.0.0" },
      "node_modules/a/node_modules/nested": { version: "3.0.0" },
      "node_modules/local": { link: true, resolved: "../local" },
    },
  }
  const root = fixture({
    "hub/package-lock.json": lock,
    "packages/learning/package-lock.json": lock,
    "starter/package-lock.json": lock,
    "hub/node_modules/installed/package-lock.json": lock,
  })
  const loaded = loadDependencies(root)
  assert.deepEqual(
    loaded
      .map(({ name, version }) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "@scope/actual", version: "2.0.0" },
      { name: "nested", version: "3.0.0" },
    ],
  )
  for (const item of loaded) {
    assert(item.source.includes("hub/package-lock.json"))
    assert(item.source.includes("packages/learning/package-lock.json"))
    assert(!item.source.includes("starter") && !item.source.includes("installed"))
  }
})

test("reads quoted, inline, and subdirectory Action references while ignoring local actions", () => {
  const sha = "a".repeat(40)
  const root = fixture({
    ".github/workflows/check.yml": `jobs:
  check:
    steps:
      - uses: 'owner/repo/subaction@${sha}'
      - { uses: "owner/repo/subaction@${sha}" }
      - uses: ./actions/local
`,
    "actions/local/action.yml": `runs:\n  steps:\n    - uses: owner/other@${sha}\n`,
  })
  assert.deepEqual(
    loadDependencies(root)
      .map(({ name, version }) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "owner/other", version: sha },
      { name: "owner/repo/subaction", version: sha },
    ],
  )
})

test("rejects unpinned Actions and lockfiles without verifiable package metadata", () => {
  for (const files of [
    { ".github/workflows/check.yml": "jobs:\n  check:\n    uses: owner/repo@v1\n" },
    { "hub/package-lock.json": '{"lockfileVersion":1,"dependencies":{}}' },
  ]) {
    assert.throws(() => loadDependencies(fixture(files)), /full commit SHA|package metadata/)
  }
})

test("accepts the seven-day boundary and reports newer and unverifiable dependencies together", async () => {
  const result = await auditDependencies(
    ["boundary", "new", "unavailable", "invalid"].map(dependency),
    {
      now: new Date("2026-10-23T12:00:00Z"),
      publishedAt: async ({ name }) => {
        if (name === "unavailable") throw new Error("registry unavailable")
        if (name === "invalid") return "unknown"
        return name === "boundary" ? "2026-10-16T12:00:00Z" : "2026-10-16T12:00:00.001Z"
      },
    },
  )
  assert.equal(result.checkedCount, 4)
  assert.equal(result.cutoff.toISOString(), "2026-10-16T12:00:00.000Z")
  assert.equal(result.failures.length, 3)
  assert(
    result.failures.some(
      (failure) => failure.includes("npm:new@1.0.0") && failure.includes("published at"),
    ),
  )
  assert(result.failures.some((failure) => failure.includes("registry unavailable")))
  assert(result.failures.some((failure) => failure.includes("publication time is invalid")))
})

test("uses registry version publication and Action commit time with shared metadata requests", async () => {
  const requests: { url: string; authorization: string | null }[] = []
  const client = registryClient(
    (async (url, options) => {
      requests.push({
        url: String(url),
        authorization: new Headers(options?.headers).get("Authorization"),
      })
      return new Response(
        JSON.stringify(
          String(url).includes("registry.npmjs.org")
            ? { time: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-01-02T00:00:00Z" } }
            : {
                commit: {
                  author: { date: "2025-01-01T00:00:00Z" },
                  committer: { date: "2026-01-03T00:00:00Z" },
                },
              },
        ),
      )
    }) as typeof fetch,
    "test-token",
  )
  assert.deepEqual(
    await Promise.all([
      client(dependency("@scope/pkg")),
      client({ ...dependency("@scope/pkg"), version: "2.0.0" }),
      client({
        ecosystem: "github-actions",
        name: "owner/repo/path",
        version: "a".repeat(40),
        source: "action.yml",
      }),
    ]),
    ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z"],
  )
  assert.deepEqual(requests, [
    { url: "https://registry.npmjs.org/%40scope%2Fpkg", authorization: null },
    {
      url: `https://api.github.com/repos/owner/repo/commits/${"a".repeat(40)}`,
      authorization: "Bearer test-token",
    },
  ])
})

test("fails closed for registry errors, missing timestamps, and invalid timestamps", async () => {
  for (const response of [
    new Response("unavailable", { status: 503 }),
    new Response(JSON.stringify({ time: {} })),
    new Response(JSON.stringify({ time: { "1.0.0": "not a date" } })),
  ]) {
    const client = registryClient((async () => response) as typeof fetch)
    await assert.rejects(client(dependency("example")), /returned 503|publication time/)
  }
})
