import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { loadDependencies } from "."

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(files: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "replica-age-test-"))
  directories.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content))
  }
  return root
}

describe("loadDependencies()", () => {
  it("loads nested and aliased npm packages, excluding Starter and installed dependencies", () => {
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
    expect(
      loaded
        .map(({ name, version }) => ({ name, version }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "@scope/actual", version: "2.0.0" },
      { name: "nested", version: "3.0.0" },
    ])
    for (const item of loaded) {
      expect(item.source).toContain("hub/package-lock.json")
      expect(item.source).toContain("packages/learning/package-lock.json")
      expect(item.source).not.toMatch(/starter|installed/)
    }
  })

  it("reads quoted, inline, and subdirectory Action references while ignoring local actions", () => {
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
    expect(
      loadDependencies(root)
        .map(({ name, version }) => ({ name, version }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "owner/other", version: sha },
      { name: "owner/repo/subaction", version: sha },
    ])
  })

  it("rejects unpinned Actions and lockfiles without verifiable package metadata", () => {
    for (const files of [
      { ".github/workflows/check.yml": "jobs:\n  check:\n    uses: owner/repo@v1\n" },
      { "hub/package-lock.json": '{"lockfileVersion":1,"dependencies":{}}' },
    ]) {
      expect(() => loadDependencies(fixture(files))).toThrow(/full commit SHA|package metadata/)
    }
  })
})
