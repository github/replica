import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { captureChecksInput } from "../checks-input/index.mjs"
import { createCheckAssessment } from "../checks-assessment/index.mjs"
import { validateChecksConfig } from "./index.mjs"
import { validateChecksConfigFiles } from "./files.mjs"

const execute = promisify(execFile)
const starter = fileURLToPath(new URL("../../../../starter/", import.meta.url))
const directory = fileURLToPath(new URL(".", import.meta.url))

async function fixture(test) {
  const root = await mkdtemp(path.join(directory, ".starter-capture-test-"))
  test.after(() => rm(root, { recursive: true, force: true }))
  const manifest = JSON.parse(await readFile(path.join(starter, ".replica/checks.json"), "utf8"))
  const names = [
    ".gitignore",
    ".replica/checks.json",
    ...manifest.checks.flatMap((check) => [
      ...(check.runner.type === "agent" ? [check.runner.instructions] : []),
      ...(check.context ?? []),
    ]),
    "src/routes/home/home-page/index.tsx",
    "src/routes/about/about-page/index.tsx",
    "src/routes/activity/activity-page/index.tsx",
    "src/app/root-route.tsx",
    "src/main.tsx",
    "src/vite-env.d.ts",
    "src/data/seeds/activity.json",
    "package.json",
    "eslint.config.mjs",
    "vite.config.ts",
    "scripts/scaffold-prototype.mjs",
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
  it("ships valid configuration and guidance without a consumer schema or executable validator", async (test) => {
    const root = await mkdtemp(path.join(directory, ".starter-validation-test-"))
    test.after(() => rm(root, { recursive: true, force: true }))
    const manifest = validateChecksConfig(
      JSON.parse(await readFile(path.join(starter, ".replica/checks.json"), "utf8")),
    )
    assert.equal(Object.hasOwn(manifest, "$schema"), false)
    const names = new Set([
      ".replica/checks.json",
      ...manifest.checks.flatMap((check) => [
        ...(check.runner.type === "agent" ? [check.runner.instructions] : []),
        ...(check.context ?? []),
      ]),
    ])
    for (const name of names) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await writeFile(path.join(root, name), await readFile(path.join(starter, name)))
    }
    await assert.doesNotReject(() => validateChecksConfigFiles(manifest, root))
    const { scripts } = JSON.parse(await readFile(path.join(starter, "package.json"), "utf8"))
    assert.equal(Object.hasOwn(scripts, "checks:validate"), false)
    for (const name of [
      ".replica/checks.schema.json",
      ".replica/validate-checks.mjs",
      ".replica/checks-validator",
    ]) {
      await assert.rejects(access(path.join(starter, name)), {
        code: "ENOENT",
      })
    }
  })

  it("ships manual accessibility review and repository-wide lint with explicit source, tooling and config inputs", async (test) => {
    const manifest = validateChecksConfig(
      JSON.parse(await readFile(path.join(starter, ".replica/checks.json"), "utf8")),
    )
    assert.equal(manifest.checks.length, 2)
    for (const check of manifest.checks) {
      assert.equal(check.automatic, false)
      assert.equal("weight" in check, false)
      if (check.runner.type === "agent") {
        const instructions = await readFile(path.join(starter, check.runner.instructions))
        assert.ok(instructions.length < 100000)
        assert.match(instructions.toString(), /unverified/)
        for (const criterion of check.criteria)
          assert.ok(instructions.toString().includes(criterion.id))
      }
    }
    const lint = manifest.checks.find((check) => check.id === "lint")
    assert.equal(manifest.checks.filter((check) => check.runner.type === "agent").length, 1)
    assert.match(
      manifest.checks.find((check) => check.runner.type === "agent").name,
      /accessibility/i,
    )
    assert.equal(lint.runner.type, "command")
    assert.deepEqual(lint.runner.command, ["npm", "run", "lint"])
    assert.equal(lint.runner.report, "exit-code")
    assert.deepEqual(lint.runner.failureExitCodes, [1])
    assert.equal(lint.criteria?.length ?? 0, 0)
    assert.ok(lint.inputs.include.length > 0)
    const { root } = await fixture(test)
    const input = await captureChecksInput(root)
    const { scope } = createCheckAssessment(lint, input)
    for (const file of [
      "src/routes/about/about-page/index.tsx",
      "scripts/scaffold-prototype.mjs",
      "eslint.config.mjs",
      "vite.config.ts",
      "package.json",
    ]) {
      assert.ok(scope.files.includes(file), `Lint inputs must include ${file}`)
    }
  })

  it("captures ignored-directory guidance exceptions without including generated bindings", async (test) => {
    const { root, manifest } = await fixture(test)
    await writeFile(path.join(root, ".replica/generated-binding.ts"), "generated output")
    const page = "src/routes/about/about-page/index.tsx"
    await writeFile(path.join(root, page), `${await readFile(path.join(root, page), "utf8")}\n`)
    const input = await captureChecksInput(root)
    assert.equal(input.state, "ready")
    for (const check of manifest.checks) {
      if (check.runner.type === "agent") assert.ok(input.files.has(check.runner.instructions))
    }
    assert.equal(input.files.has(".replica/generated-binding.ts"), false)
  })

  it("reviews the union of former page inputs even in an unchanged checkout", async (test) => {
    const { root, manifest } = await fixture(test)
    const input = await captureChecksInput(root)
    const accessibility = manifest.checks.find((check) => check.id === "github-a11y-source")
    const { scope } = createCheckAssessment(accessibility, input)
    assert.deepEqual(
      scope.files.filter((file) => file.startsWith("src/")),
      [
        "src/app/root-route.tsx",
        "src/data/seeds/activity.json",
        "src/main.tsx",
        "src/routes/about/about-page/index.tsx",
        "src/routes/activity/activity-page/index.tsx",
        "src/routes/home/home-page/index.tsx",
        "src/vite-env.d.ts",
      ],
    )
    assert.ok(scope.files.includes("package.json"))
    assert.ok(scope.files.includes("vite.config.ts"))
    for (const check of manifest.checks) assert.ok(check.inputs.include.length > 0)
  })

  it("keeps checks ready after unrelated source additions and is unconfigured after deleting the manifest", async (test) => {
    const { root } = await fixture(test)
    await mkdir(path.join(root, "src/routes/new-page"), { recursive: true })
    await writeFile(path.join(root, "src/routes/new-page/index.tsx"), "new page")
    const input = await captureChecksInput(root)
    assert.equal(input.state, "ready")
    await rm(path.join(root, ".replica/checks.json"))
    assert.equal((await captureChecksInput(root)).state, "unconfigured")
  })
})
