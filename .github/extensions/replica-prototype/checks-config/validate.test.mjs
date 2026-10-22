import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execute = promisify(execFile)
const directory = fileURLToPath(new URL(".", import.meta.url))
const cli = fileURLToPath(new URL("./validate.mjs", import.meta.url))

async function fixture(test) {
  const repository = await mkdtemp(path.join(directory, ".validate-test-"))
  test.after(() => rm(repository, { recursive: true, force: true }))
  await mkdir(path.join(repository, ".replica"))
  const config = {
    $schema: "https://unavailable.invalid/schema.json",
    version: 2,
    checks: [
      {
        id: "command",
        name: "Command",
        inputs: { include: ["src/**"] },
        runner: {
          type: "command",
          command: [
            process.execPath,
            "-e",
            "require('node:fs').writeFileSync('executed', 'unexpected')",
          ],
        },
        context: ["guidance.md"],
      },
    ],
  }
  await writeFile(path.join(repository, "guidance.md"), "Read-only repository guidance.")
  function save(value = config) {
    return writeFile(path.join(repository, ".replica/checks.json"), JSON.stringify(value))
  }
  await save()
  return { repository, config, save }
}

async function run(repository, ...args) {
  try {
    const result = await execute(process.execPath, [cli, ...args], {
      cwd: repository,
      env: { ...process.env, PATH: path.join(repository, "no-executables") },
      timeout: 10000,
    })
    return { code: 0, output: `${result.stdout}${result.stderr}` }
  } catch (error) {
    if (typeof error.code !== "number") throw error
    return { code: error.code, output: `${error.stdout}${error.stderr}` }
  }
}

describe("checks validation command", () => {
  it("validates the default cwd or an explicit repository without executing checks or fetching schema metadata", async (test) => {
    const { repository } = await fixture(test)
    assert.equal((await run(repository)).code, 0)
    assert.equal((await run(directory, repository)).code, 0)
    await assert.rejects(() => access(path.join(repository, "executed")), {
      code: "ENOENT",
    })
  })

  it("prints help successfully and rejects unsupported options and extra arguments", async (test) => {
    const { repository } = await fixture(test)
    const help = await run(repository, "--help")
    assert.equal(help.code, 0)
    assert.match(help.output, /usage|repository/i)
    for (const args of [["--unknown"], [repository, repository]]) {
      const result = await run(repository, ...args)
      assert.notEqual(result.code, 0)
      assert.match(result.output, /usage|argument|option/i)
    }
  })

  it("reports missing and malformed configuration with its path", async (test) => {
    const { repository } = await fixture(test)
    await rm(path.join(repository, ".replica/checks.json"))
    let result = await run(repository)
    assert.notEqual(result.code, 0)
    assert.match(result.output, /checks\.json/)
    await writeFile(path.join(repository, ".replica/checks.json"), "{invalid")
    result = await run(repository)
    assert.notEqual(result.code, 0)
    assert.match(result.output, /checks\.json/)
  })

  it("fails invalid schema content, legacy versions and missing declared guidance", async (test) => {
    const { repository, config, save } = await fixture(test)
    config.checks[0].runner.command = []
    await save()
    let result = await run(repository)
    assert.notEqual(result.code, 0)
    assert.match(result.output, /command|runner|checks/i)
    config.version = 1
    await save()
    result = await run(repository)
    assert.notEqual(result.code, 0)
    assert.match(result.output, /version.*2|v2/i)
    config.version = 2
    config.checks[0].runner.command = ["not-installed"]
    await save()
    await rm(path.join(repository, "guidance.md"))
    result = await run(repository)
    assert.notEqual(result.code, 0)
    assert.match(result.output, /guidance\.md/)
  })
})
