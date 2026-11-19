import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { promisify } from "node:util"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"

const actionFile = new URL("../../action.yml", import.meta.url)
const screenshotsActionFile = new URL("../../screenshots/action.yml", import.meta.url)

function steps(action) {
  return action
    .split(/^ {4}- name: /m)
    .slice(1)
    .map((step) => ({
      name: step.split("\n")[0],
      condition: step.match(/^ {6}if: (.+)$/m)?.[1],
      uses: step.match(/^ {6}uses: (.+)$/m)?.[1],
      run: step.match(/^ {6}run: (.+)$/m)?.[1],
      body: step,
    }))
}

function script(step) {
  if (step.run !== "|") return step.run.replace(/^'(.*)'$/, "$1")
  return step.body
    .slice(step.body.indexOf("      run: |") + "      run: |".length)
    .split("\n")
    .filter((line) => line.startsWith("        "))
    .map((line) => line.slice(8))
    .join("\n")
}

function inputDefault(action, name) {
  return action.match(new RegExp(` {2}${name}:[\\s\\S]*? {4}default: "?([^"\\n]+)"?`))?.[1]
}

function enabled(condition, inputs) {
  if (!condition) return true
  const conditions = {
    "inputs.skip-build != 'true'": inputs.skipBuild !== "true",
    "inputs.screenshots == 'inline'": inputs.screenshots === "inline",
    "inputs.screenshots == 'separate'": inputs.screenshots === "separate",
  }
  assert.ok(condition in conditions, `Unexpected step condition: ${condition}`)
  return conditions[condition]
}

async function runAction(action, inputs) {
  const root = await temporaryDirectory()
  const bin = path.join(root, "bin")
  const actionPath = path.join(root, "action")
  const workspace = path.join(root, "workspace")
  const runner = path.join(root, "runner")
  const trace = path.join(root, "trace.jsonl")
  await Promise.all([mkdir(bin), mkdir(workspace), mkdir(runner)])
  await mkdir(path.join(actionPath, "node_modules", ".bin"), { recursive: true })
  const executable = `#!${process.execPath}
import { appendFileSync } from "node:fs"
appendFileSync(process.env.TRACE, JSON.stringify({ command: process.argv[1].split("/").at(-1), args: process.argv.slice(2), cwd: process.cwd() }) + "\\n")
`
  for (const command of ["node", "npm", "docker"]) {
    await writeFile(path.join(bin, command), executable, { mode: 0o755 })
  }
  await writeFile(path.join(actionPath, "node_modules", ".bin", "playwright"), executable, {
    mode: 0o755,
  })
  await writeFile(trace, "")

  for (const step of steps(action)) {
    if (!step.run || !enabled(step.condition, inputs)) continue
    await promisify(execFile)("bash", ["-e", "-c", script(step)], {
      cwd: step.body.includes("working-directory:") ? actionPath : workspace,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TRACE: trace,
        GITHUB_ACTION_PATH: actionPath,
        GITHUB_WORKSPACE: workspace,
        RUNNER_TEMP: runner,
        REPLICA_SKIP_BUILD: inputs.skipBuild,
        REPLICA_OUTPUT_DIRECTORY: inputs.outputDirectory,
        REPLICA_SCREENSHOTS: inputs.screenshots,
      },
    })
  }

  const calls = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  return { calls, actionPath: await realpath(actionPath), workspace, runner }
}

describe("Replica composite action", () => {
  for (const options of [
    { builds: true, captures: true },
    { skipBuild: "true", outputDirectory: "website/public", builds: false, captures: true },
    { screenshots: "separate", builds: true, captures: false },
  ]) {
    it(`builds=${options.builds} and captures=${options.captures} with the expected steps`, async () => {
      const action = await readFile(actionFile, "utf8")
      assert.equal(inputDefault(action, "skip-build"), "false")
      assert.equal(inputDefault(action, "output-directory"), "dist")
      assert.equal(inputDefault(action, "screenshots"), "inline")
      const inputs = {
        skipBuild: options.skipBuild ?? "false",
        outputDirectory: options.outputDirectory ?? "dist",
        screenshots: options.screenshots ?? "inline",
      }
      const { calls, actionPath, workspace, runner } = await runAction(action, inputs)
      const scripts = calls.filter((call) => call.command === "node")
      function called(name) {
        return scripts.find((call) => call.args[0].includes(name))
      }

      assert.ok(called("validate-checkout"))
      assert.equal(Boolean(called("validate-repository")), options.builds)
      assert.equal(
        calls.some((call) => call.command === "docker"),
        options.builds,
      )
      assert.deepEqual(
        calls.filter((call) => call.command === "npm"),
        options.captures
          ? [{ command: "npm", args: ["ci", "--ignore-scripts", "--omit=dev"], cwd: actionPath }]
          : [],
      )
      assert.deepEqual(called("prepare-build-output").args.slice(1), [
        "--root",
        workspace,
        "--output-directory",
        inputs.outputDirectory,
        "--output",
        path.join(runner, "replica-build-root"),
      ])
      assert.equal(
        calls.some((call) => call.command === "playwright"),
        options.captures,
      )
      if (options.captures) {
        // Inline mode keeps the earlier single-package contract: dist, screenshots, and templates.
        assert.equal(called("create-dist-package"), undefined)
        assert.deepEqual(called("capture-screenshots").args.slice(1), [
          "--root",
          path.join(runner, "replica-build-root"),
          "--config-root",
          workspace,
          "--screenshots",
          path.join(runner, "replica-screenshots"),
        ])
        assert.deepEqual(called("create-package").args.slice(1), [
          "--root",
          path.join(runner, "replica-build-root"),
          "--screenshots",
          path.join(runner, "replica-screenshots"),
          "--output",
          path.join(runner, "replica-build-v1"),
        ])
      } else {
        assert.deepEqual(called("create-dist-package").args.slice(1), [
          "--root",
          path.join(runner, "replica-build-root"),
          "--config-root",
          workspace,
          "--output",
          path.join(runner, "replica-build-v1"),
        ])
        assert.equal(called("capture-screenshots"), undefined)
        assert.equal(called("create-package"), undefined)
      }
      assert.equal(called("create-screenshot-package"), undefined)
    })
  }

  it("uploads one replica-build-v1 package per mode, with separate mode first", async () => {
    const list = steps(await readFile(actionFile, "utf8"))
    const uploads = list.filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
    assert.deepEqual(
      uploads.map((step) => step.condition),
      ["inputs.screenshots == 'separate'", "inputs.screenshots == 'inline'"],
    )
    for (const upload of uploads) {
      assert.match(upload.body, /name: replica-build-v1\n/)
      assert.match(upload.body, /path: \$\{\{ runner\.temp \}\}\/replica-build-v1\//)
    }
    const separateUpload = list.indexOf(uploads[0])
    for (const step of list.slice(0, separateUpload)) {
      assert.doesNotMatch(step.body, /npm ci --ignore-scripts|playwright|capture-screenshots/)
    }
  })

  it("captures separate screenshots from the downloaded dist package", async () => {
    const list = steps(await readFile(screenshotsActionFile, "utf8"))
    const names = list.map((step) => step.name)
    assert.ok(names.indexOf("Check checkout credentials") < names.indexOf("Capture screenshots"))
    const download = list.find((step) => step.uses?.startsWith("actions/download-artifact@"))
    assert.match(download.body, /name: replica-build-v1\n/)
    const validate = list.find((step) => step.run?.includes("validate-build-output"))
    assert.ok(names.indexOf(download.name) < names.indexOf(validate.name))
    assert.ok(names.indexOf(validate.name) < names.indexOf("Capture screenshots"))
    assert.match(list.at(-1).body, /name: replica-screenshots-v1\n/)
    const uploads = list.filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
    assert.equal(uploads.length, 1)
    assert.match(uploads[0].body, /name: replica-screenshots-v1\n/)
  })
})
