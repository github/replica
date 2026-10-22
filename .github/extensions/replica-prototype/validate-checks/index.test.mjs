import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { validateChecks } from "./index.mjs"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL(".", import.meta.url))

async function fixture(test) {
  const repository = await mkdtemp(path.join(directory, ".validation-test-"))
  test.after(() => rm(repository, { recursive: true, force: true }))
  await execute("git", ["init", "--initial-branch=prototype"], {
    cwd: repository,
  })
  await mkdir(path.join(repository, ".replica"))
  const config = {
    $schema: "https://unavailable.invalid/checks.json",
    version: 2,
    checks: [
      {
        id: "lint",
        name: "Lint",
        inputs: { include: ["src/**"] },
        context: ["guidance.md"],
        runner: {
          type: "command",
          command: [
            process.execPath,
            "-e",
            "require('node:fs').writeFileSync('executed', 'unexpected')",
          ],
        },
      },
    ],
  }
  const filename = path.join(repository, ".replica/checks.json")
  function save(value = config) {
    return writeFile(filename, JSON.stringify(value))
  }
  await writeFile(path.join(repository, "guidance.md"), "Read-only guidance.")
  await save()
  return { repository, config, filename, save }
}

function assertInvalid(result, message) {
  assert.equal(result.status, "invalid")
  assert.equal(result.file, ".replica/checks.json")
  assert.ok(result.issues.length > 0)
  for (const issue of result.issues) {
    assert.equal(typeof issue.path, "string")
    assert.match(issue.path, /^(?:\/(?:[^~]|~[01])*)?$/)
    assert.ok(issue.path.length <= 256)
    assert.equal(typeof issue.message, "string")
    assert.ok(issue.message.length > 0 && issue.message.length <= 500)
    for (const value of [issue.path, issue.message]) {
      assert.doesNotMatch(value, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u)
    }
  }
  assert.match(result.issues.map((issue) => issue.message).join(" "), message)
}

describe("validateChecks()", () => {
  it("validates from a subdirectory on an unborn branch without a baseline, schema fetch or check execution", async (test) => {
    const { repository, filename } = await fixture(test)
    test.mock.method(globalThis, "fetch", () => assert.fail("Use the bundled checks schema."))
    const source = await readFile(filename, "utf8")
    const subdirectory = path.join(repository, "src/pages")
    await mkdir(subdirectory, { recursive: true })
    await assert.rejects(execute("git", ["rev-parse", "--verify", "HEAD"], { cwd: repository }))
    assert.deepEqual(await validateChecks(subdirectory), {
      status: "valid",
      file: ".replica/checks.json",
      issues: [],
    })
    assert.equal(await readFile(filename, "utf8"), source)
    await assert.rejects(access(path.join(repository, "executed")), {
      code: "ENOENT",
    })
  })

  it("reports an absent manifest as missing rather than invalid", async (test) => {
    const { repository, filename } = await fixture(test)
    await rm(filename)
    assert.deepEqual(await validateChecks(repository), {
      status: "missing",
      file: ".replica/checks.json",
      issues: [],
    })
  })

  it("returns diagnostics from the canonical structural, semantic and guidance validators", async (test) => {
    const { repository, config, save } = await fixture(test)
    for (const [change, message] of [
      [(value) => (value.checks[0].runner.command = []), /command|runner/i],
      [(value) => (value.checks[0].targets = ["unknown"]), /page|target/i],
      [(value) => (value.checks[0].context = ["missing.md"]), /missing\.md/],
    ]) {
      const value = structuredClone(config)
      change(value)
      await save(value)
      assertInvalid(await validateChecks(repository), message)
    }
  })

  it("reports malformed JSON and invalid UTF-8 as invalid configuration", async (test) => {
    const { repository, filename } = await fixture(test)
    for (const source of ["{broken", Buffer.from([0xff])]) {
      await writeFile(filename, source)
      const invalid = await validateChecks(repository)
      assertInvalid(invalid, /JSON|UTF|encoded/i)
      assert.equal(invalid.issues[0].path, "/")
    }
  })

  it("rejects a symlinked manifest whether its in-repository target exists or is missing", async (test) => {
    const { repository, config, filename } = await fixture(test)
    await writeFile(path.join(repository, "other.json"), JSON.stringify(config))
    await rm(filename)
    await symlink("../other.json", filename)
    assertInvalid(await validateChecks(repository), /symbolic|symlink/i)
    await rm(path.join(repository, "other.json"))
    assertInvalid(await validateChecks(repository), /symbolic|symlink/i)
  })

  it("bounds and sanitizes diagnostics that echo untrusted configuration keys", async (test) => {
    const { repository, config, save } = await fixture(test)
    config[`unsafe\n\u202e${"x".repeat(1000)}`] = true
    await save()
    assertInvalid(await validateChecks(repository), /unknown|additional/i)
  })

  it("throws for an unavailable checkout instead of reporting a missing manifest", async (test) => {
    const { repository } = await fixture(test)
    await assert.rejects(validateChecks(path.join(repository, "removed-checkout")))
  })
})
