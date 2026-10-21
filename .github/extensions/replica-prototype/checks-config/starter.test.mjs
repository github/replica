import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { captureChecksInput } from "../checks-input/index.mjs"
import { validateChecksConfig } from "./index.mjs"

const execute = promisify(execFile)
const starter = fileURLToPath(new URL("../../../../starter/", import.meta.url))
const directory = fileURLToPath(new URL(".", import.meta.url))

async function fixture(test) {
  const root = await mkdtemp(path.join(os.tmpdir(), "replica-starter-checks-"))
  test.after(() => rm(root, { recursive: true, force: true }))
  const manifest = JSON.parse(await readFile(path.join(starter, ".replica/checks.json"), "utf8"))
  const names = [
    ".gitignore",
    ".replica/checks.json",
    ...manifest.checks.flatMap((check) => [check.runner.instructions, ...(check.context || [])]),
    "src/routes/home/home-page/index.tsx",
    "src/routes/about/about-page/index.tsx",
    "src/routes/activity/activity-page/index.tsx",
    "src/app/root-route.tsx",
    "src/data/seeds/activity.json",
    "package.json",
  ]
  for (const name of names) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), await readFile(path.join(starter, name)))
  }
  async function git(...args) {
    return execute(
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
  }
  await git("init", "--initial-branch=main")
  await git("add", ".")
  await git("commit", "--no-gpg-sign", "-m", "starter")
  await git("switch", "-c", "prototype")
  return { root, manifest }
}

describe("starter quality-check examples", () => {
  it("ships the canonical schema and validates a standalone copy through its npm command", async (test) => {
    const root = await mkdtemp(path.join(directory, ".starter-validation-test-"))
    test.after(() => rm(root, { recursive: true, force: true }))
    const manifest = JSON.parse(await readFile(path.join(starter, ".replica/checks.json"), "utf8"))
    assert.equal(manifest.$schema, "./checks.schema.json")
    assert.deepEqual(
      JSON.parse(await readFile(path.join(starter, ".replica/checks.schema.json"), "utf8")),
      JSON.parse(await readFile(new URL("./schema.v2.json", import.meta.url), "utf8")),
    )
    const names = new Set([
      "package.json",
      ".replica/checks.json",
      ".replica/checks.schema.json",
      ".replica/validate-checks.mjs",
      ...manifest.checks.flatMap((check) => [check.runner.instructions, ...(check.context ?? [])]),
    ])
    for (const name of names) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await writeFile(path.join(root, name), await readFile(path.join(starter, name)))
    }
    await execute("npm", ["run", "checks:validate"], {
      cwd: root,
      timeout: 10000,
    })
    manifest.checks[0].runner.command = ["must-not-be-accepted-on-an-agent-runner"]
    await writeFile(path.join(root, ".replica/checks.json"), JSON.stringify(manifest))
    await assert.rejects(
      () =>
        execute(process.execPath, [".replica/validate-checks.mjs"], {
          cwd: root,
        }),
      (error) => {
        assert.equal(error.code, 1)
        assert.match(`${error.stdout}${error.stderr}`, /runner|command|checks/i)
        return true
      },
    )
  })

  it("declares removable manual-only source reviews with complete local instructions", async () => {
    const manifest = validateChecksConfig(
      JSON.parse(await readFile(path.join(starter, ".replica/checks.json"), "utf8")),
    )
    assert.equal(manifest.base, "main")
    assert.deepEqual(
      manifest.checks.map((check) => check.id),
      ["github-a11y-source", "github-code-quality-source"],
    )
    assert.deepEqual(
      manifest.pages.map((page) => page.route),
      ["/", "/#/about", "/#/activity"],
    )
    for (const check of manifest.checks) {
      assert.equal(check.runner.type, "agent")
      assert.equal(check.automatic, false)
      assert.equal("weight" in check, false)
      assert.match(check.name, /source review/)
      const instructions = await readFile(path.join(starter, check.runner.instructions))
      assert.ok(instructions.length < 100000)
      assert.match(instructions.toString(), /unverified/)
      for (const criterion of check.criteria)
        assert.ok(instructions.toString().includes(criterion.id))
    }
  })

  it("captures ignored-directory exceptions and confines page changes to their declared scope", async (test) => {
    const { root, manifest } = await fixture(test)
    await writeFile(path.join(root, ".replica/generated-binding.ts"), "generated output")
    const page = "src/routes/about/about-page/index.tsx"
    await writeFile(path.join(root, page), `${await readFile(path.join(root, page), "utf8")}\n`)
    const input = await captureChecksInput(root)
    assert.equal(input.state, "ready")
    assert.deepEqual(
      input.pages.map((page) => page.id),
      ["about"],
    )
    assert.deepEqual(input.unknown, [])
    for (const check of manifest.checks) assert.ok(input.files.has(check.runner.instructions))
    assert.equal(input.files.has(".replica/generated-binding.ts"), false)
    assert.ok(input.pageFiles.about.includes("src/app/root-route.tsx"))
    assert.ok(input.pageFiles.about.includes("package.json"))
  })

  it("includes all affected pages for shared layout changes and only Activity for seed changes", async (test) => {
    const { root } = await fixture(test)
    const shared = "src/app/root-route.tsx"
    const source = await readFile(path.join(root, shared), "utf8")
    await writeFile(path.join(root, shared), `${source}\n`)
    let input = await captureChecksInput(root)
    assert.deepEqual(
      input.pages.map((page) => page.id),
      ["home", "about", "activity"],
    )
    await writeFile(path.join(root, shared), source)
    const seeds = "src/data/seeds/activity.json"
    await writeFile(path.join(root, seeds), `${await readFile(path.join(root, seeds), "utf8")}\n`)
    input = await captureChecksInput(root)
    assert.deepEqual(
      input.pages.map((page) => page.id),
      ["activity"],
    )
  })

  it("requires explicit scope for new pages and is unconfigured after deleting the manifest", async (test) => {
    const { root } = await fixture(test)
    await mkdir(path.join(root, "src/routes/new-page"), { recursive: true })
    await writeFile(path.join(root, "src/routes/new-page/index.tsx"), "new page")
    const input = await captureChecksInput(root)
    assert.equal(input.state, "scope_required")
    assert.deepEqual(input.unknown, ["src/routes/new-page/index.tsx"])
    await rm(path.join(root, ".replica/checks.json"))
    assert.equal((await captureChecksInput(root)).state, "unconfigured")
  })
})
