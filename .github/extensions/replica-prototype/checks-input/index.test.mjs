import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { promisify } from "node:util"

import { captureChecksInput } from "./index.mjs"

const execute = promisify(execFile)

async function fixture(test) {
  const root = await mkdtemp(path.join(os.tmpdir(), "replica-checks-input-"))
  test.after(() => rm(root, { recursive: true, force: true }))
  async function git(...args) {
    return (
      await execute(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "user.name=Checks test",
          "-c",
          "user.email=checks@example.com",
          ...args,
        ],
        { cwd: root },
      )
    ).stdout.trim()
  }
  await git("init", "--initial-branch=main")
  await mkdir(path.join(root, "src"))
  for (const file of ["a.tsx", "b.tsx", "shared.ts"])
    await writeFile(path.join(root, "src", file), "existing source")
  await git("add", ".")
  await git("commit", "--no-gpg-sign", "-m", "base")
  const base = await git("rev-parse", "HEAD")
  await git("switch", "-c", "prototype")
  await mkdir(path.join(root, ".replica"))
  await writeFile(
    path.join(root, ".replica/checks.json"),
    JSON.stringify({
      version: 2,
      base: "main",
      pages: [
        {
          id: "a",
          name: "A",
          route: "/a",
          inputs: ["src/a.tsx", "src/shared.ts"],
        },
        {
          id: "b",
          name: "B",
          route: "/b",
          inputs: ["src/b.tsx", "src/shared.ts"],
        },
      ],
      checks: [
        {
          id: "lint",
          name: "Lint",
          targets: ["a", "b"],
          runner: { type: "command", image: "node:24", command: ["node", "lint.mjs"] },
          criteria: [{ id: "clean", name: "Clean" }],
        },
      ],
    }),
  )
  return { root, git, base }
}

describe("captureChecksInput()", () => {
  it("runs repository-wide checks without requiring page-scope confirmation or fake pages", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, ".replica/checks.json")
    const config = JSON.parse(await readFile(filename, "utf8"))
    delete config.pages
    delete config.checks[0].targets
    await writeFile(filename, JSON.stringify(config))
    await writeFile(path.join(root, "unknown.ts"), "repository-wide source")
    const input = await captureChecksInput(root)
    assert.equal(input.state, "ready")
    assert.deepEqual(input.pages, [])
    assert.ok(input.files.has("unknown.ts"))
  })
  it("retains page-scope confirmation for mixed targeted and repository-wide checks", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, ".replica/checks.json")
    const config = JSON.parse(await readFile(filename, "utf8"))
    config.checks.push({
      id: "global",
      name: "Repository check",
      runner: { type: "command", image: "node:24", command: ["node", "lint.mjs"] },
    })
    await writeFile(filename, JSON.stringify(config))
    await writeFile(path.join(root, "unknown.ts"), "not mapped to a page")
    assert.equal((await captureChecksInput(root)).state, "scope_required")
  })
  it("requires readable bounded UTF-8 guidance and captures it without marking pages affected", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, ".replica/checks.json")
    const config = JSON.parse(await readFile(filename, "utf8"))
    config.checks[0].context = ["guidance.md"]
    await writeFile(filename, JSON.stringify(config))
    await assert.rejects(captureChecksInput(root), /context|guidance|missing|read/i)
    await writeFile(path.join(root, "guidance.md"), Buffer.from([0xff]))
    await assert.rejects(captureChecksInput(root), /UTF|text|context|guidance/i)
    await writeFile(path.join(root, "guidance.md"), "x".repeat(100001))
    await assert.rejects(captureChecksInput(root), /limit|text|context|guidance|bytes/i)
    await writeFile(path.join(root, "guidance.md"), "Review guidance")
    const snapshot = await captureChecksInput(root)
    assert.equal(snapshot.files.get("guidance.md").toString(), "Review guidance")
    assert.deepEqual(snapshot.pages, [])
    await rm(path.join(root, "guidance.md"))
    await symlink("/etc/hosts", path.join(root, "guidance.md"))
    await assert.rejects(captureChecksInput(root), /symbolic|symlink/i)
  })
  it("does not require page impact confirmation for files used only as guidance", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, ".replica/checks.json")
    const config = JSON.parse(await readFile(filename, "utf8"))
    config.checks[0].context = ["guidance.md"]
    await writeFile(filename, JSON.stringify(config))
    await writeFile(path.join(root, "guidance.md"), "Review guidance")
    const snapshot = await captureChecksInput(root)
    assert.deepEqual(snapshot.unknown, [])
    assert.notEqual(snapshot.state, "scope_required")
  })
  it("replaces a pinned baseline removed from the branch by a history rewrite", async (test) => {
    const { root, git } = await fixture(test)
    await git("add", ".")
    await git("commit", "--no-gpg-sign", "-m", "prototype configuration")
    const tree = await git("rev-parse", "HEAD^{tree}")
    const newRoot = await git("commit-tree", tree, "-m", "new public history")
    await git("update-ref", "refs/heads/main", newRoot)
    await writeFile(path.join(root, "src/a.tsx"), "old branch source")
    await git("add", ".")
    await git("commit", "--no-gpg-sign", "-m", "old branch change")
    const removedBase = await git("rev-parse", "HEAD")
    await git("rebase", "--onto", "main", "HEAD")
    await writeFile(path.join(root, "src/a.tsx"), "new branch source")
    const input = await captureChecksInput(root, {
      "prototype:main": { branch: "prototype", ref: "main", sha: removedBase },
    })
    assert.equal(input.base, newRoot)
    assert.deepEqual(input.unknown, [])
    assert.deepEqual(
      input.pages.map((page) => page.id),
      ["a"],
    )
  })
  it("includes a changed page's complete contents but excludes an untouched page from scope", async (test) => {
    const { root } = await fixture(test)
    await writeFile(path.join(root, "src/a.tsx"), "existing problem\nnew change")
    const input = await captureChecksInput(root)
    assert.equal(input.state, "ready")
    assert.deepEqual(
      input.pages.map((page) => page.id),
      ["a"],
    )
    assert.ok(input.files.get("src/a.tsx").toString().includes("existing problem"))
    assert.deepEqual(input.pageFiles.a, ["src/a.tsx", "src/shared.ts"])
  })
  it("includes every declared dependent page when shared source changes", async (test) => {
    const { root } = await fixture(test)
    await writeFile(path.join(root, "src/shared.ts"), "shared change")
    const input = await captureChecksInput(root)
    assert.deepEqual(
      input.pages.map((page) => page.id),
      ["a", "b"],
    )
  })
  it("requires explicit impact resolution for unknown and deleted inputs", async (test) => {
    const { root } = await fixture(test)
    await writeFile(path.join(root, "unknown.ts"), "dynamic dependency")
    const first = await captureChecksInput(root)
    assert.equal(first.state, "scope_required")
    const resolved = await captureChecksInput(root, undefined, {
      key: first.selectionKey,
      pageIds: ["b"],
    })
    assert.deepEqual(
      resolved.pages.map((page) => page.id),
      ["b"],
    )
    await writeFile(path.join(root, "unknown.ts"), "different dynamic dependency")
    assert.equal(
      (
        await captureChecksInput(root, undefined, {
          key: first.selectionKey,
          pageIds: ["b"],
        })
      ).state,
      "scope_required",
    )
    await rm(path.join(root, "src/a.tsx"))
    assert.ok((await captureChecksInput(root)).pages.some((page) => page.id === "a"))
  })
  it("pins the explicit branch base and excludes credential-like files", async (test) => {
    const { root, git, base } = await fixture(test)
    const first = await captureChecksInput(root)
    await writeFile(path.join(root, ".env.local"), "SECRET=never copied")
    await git("add", ".")
    await git("commit", "--no-gpg-sign", "-m", "prototype files")
    await git("branch", "--force", "main", "HEAD")
    const next = await captureChecksInput(root, {
      "prototype:main": first.baseline,
    })
    assert.equal(next.base, base)
    assert.equal(next.files.has(".env.local"), false)
  })
  it("rejects symbolic links instead of following them outside the checkout", async (test) => {
    const { root } = await fixture(test)
    await symlink("/etc/hosts", path.join(root, "outside"))
    await assert.rejects(captureChecksInput(root), /symbolic links/)
  })
  it("rejects nonregular tracked inputs before opening a blocking FIFO", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, "src/a.tsx")
    await rm(filename)
    await execute("mkfifo", [filename])
    await assert.rejects(captureChecksInput(root), /nonregular files/)
  })
  it("enforces the exact per-file byte limit", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, "src/a.tsx")
    await writeFile(filename, Buffer.alloc(8 * 1024 * 1024))
    assert.equal((await captureChecksInput(root)).files.get("src/a.tsx").length, 8 * 1024 * 1024)
    await writeFile(filename, Buffer.alloc(8 * 1024 * 1024 + 1))
    await assert.rejects(captureChecksInput(root), /byte limit/)
  })
  it("matches zero-depth and nested **/ dependencies and fingerprints ignored-impact source", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, ".replica/checks.json")
    const config = JSON.parse(await readFile(filename, "utf8"))
    config.pages[0].inputs = ["src/**/a.tsx"]
    config.ignore = ["notes.txt"]
    await writeFile(filename, JSON.stringify(config))
    await writeFile(path.join(root, "src/a.tsx"), "top-level change")
    const first = await captureChecksInput(path.join(root, "src"))
    assert.equal(first.state, "ready")
    assert.deepEqual(
      first.pages.map((page) => page.id),
      ["a"],
    )
    await mkdir(path.join(root, "src/nested"))
    await writeFile(path.join(root, "src/nested/a.tsx"), "nested change")
    const next = await captureChecksInput(root)
    assert.ok(next.pageFiles.a.includes("src/nested/a.tsx"))
    await writeFile(path.join(root, "notes.txt"), "Ignored for impact, not identity.")
    const edited = await captureChecksInput(root)
    assert.equal(edited.state, "ready")
    assert.notEqual(edited.fingerprint, next.fingerprint)
  })
})
