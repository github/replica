import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { captureChecksInput } from "./index.mjs"
import { createCheckAssessment } from "../checks-assessment/index.mjs"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL(".", import.meta.url))

async function fixture(test) {
  const root = await mkdtemp(path.join(directory, ".input-test-"))
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
  await git("init", "--initial-branch=prototype")
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src/a.tsx"), "existing source")
  await git("add", ".")
  await git("commit", "--no-gpg-sign", "-m", "source")
  await mkdir(path.join(root, ".replica"))
  await writeFile(
    path.join(root, ".replica/checks.json"),
    JSON.stringify({
      version: 2,
      checks: [
        {
          id: "lint",
          name: "Lint",
          inputs: { include: ["src/**/*.tsx"] },
          runner: { type: "command", command: ["node", "lint.mjs"] },
          criteria: [{ id: "clean", name: "Clean" }],
        },
      ],
    }),
  )
  return { root, git }
}

describe("captureChecksInput()", () => {
  it("captures immutable current files and branch provenance without a base reference or impact selection", async (test) => {
    const { root, git } = await fixture(test)
    await assert.rejects(git("rev-parse", "--verify", "main"))
    await writeFile(path.join(root, "unknown.ts"), "unmapped source")
    const captured = await captureChecksInput(path.join(root, "src"))
    assert.equal(captured.state, "ready")
    assert.equal(captured.branch, "prototype")
    assert.equal(captured.head, await git("rev-parse", "HEAD"))
    assert.equal(captured.files.get("unknown.ts").toString(), "unmapped source")
    for (const field of [
      "base",
      "baseline",
      "pages",
      "pageFiles",
      "unknown",
      "selectionKey",
      "fingerprint",
    ])
      assert.equal(Object.hasOwn(captured, field), false, `${field} is not capture metadata`)
    await writeFile(path.join(root, "src/a.tsx"), "new saved source")
    assert.equal(captured.files.get("src/a.tsx").toString(), "existing source")
    assert.equal(
      (await captureChecksInput(root)).files.get("src/a.tsx").toString(),
      "new saved source",
    )
  })

  it("keeps per-check identity across unrelated commits but invalidates relevant saved edits", async (test) => {
    const { root, git } = await fixture(test)
    const original = await captureChecksInput(root)
    const identity = createCheckAssessment(original.config.checks[0], original).fingerprint
    await writeFile(path.join(root, "README.md"), "Unrelated documentation")
    await git("add", ".")
    await git("commit", "--no-gpg-sign", "-m", "unrelated commit")
    const unrelated = await captureChecksInput(root)
    assert.notEqual(unrelated.head, original.head)
    assert.equal(createCheckAssessment(unrelated.config.checks[0], unrelated).fingerprint, identity)
    await writeFile(path.join(root, "src/a.tsx"), "Relevant edit")
    const changed = await captureChecksInput(root)
    assert.notEqual(createCheckAssessment(changed.config.checks[0], changed).fingerprint, identity)
  })

  it("validates guidance before making configured checks ready", async (test) => {
    const { root } = await fixture(test)
    const filename = path.join(root, ".replica/checks.json")
    const config = JSON.parse(await readFile(filename, "utf8"))
    config.checks[0].context = ["guidance.md"]
    await writeFile(filename, JSON.stringify(config))
    await assert.rejects(captureChecksInput(root), /context|guidance|missing|read/i)
    await writeFile(path.join(root, "guidance.md"), "Review guidance")
    const captured = await captureChecksInput(root)
    assert.equal(captured.files.get("guidance.md").toString(), "Review guidance")
    assert.equal(captured.state, "ready")
  })

  it("is unconfigured only when the manifest is absent", async (test) => {
    const { root } = await fixture(test)
    await rm(path.join(root, ".replica/checks.json"))
    assert.equal((await captureChecksInput(root)).state, "unconfigured")
  })

  it("omits deleted files and excludes tracked credential-like files", async (test) => {
    const { root, git } = await fixture(test)
    await writeFile(path.join(root, ".env.local"), "SECRET=never copied")
    await git("add", ".env.local")
    await rm(path.join(root, "src/a.tsx"))
    const captured = await captureChecksInput(root)
    assert.equal(captured.state, "ready")
    assert.equal(captured.files.has(".env.local"), false)
    assert.equal(captured.files.has("src/a.tsx"), false)
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
})
