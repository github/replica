import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { runPrototypeCheck } from "./index.mjs"
import { createCheckAssessment } from "../checks-assessment/index.mjs"

const execute = promisify(execFile)
const root = fileURLToPath(new URL(".", import.meta.url))

function input() {
  return {
    files: new Map([
      ["page.tsx", Buffer.from("original code")],
      ["review.md", Buffer.from("Check component usage.")],
    ]),
  }
}
function result(fingerprint) {
  return {
    version: 2,
    checkId: "review",
    fingerprint,
    outcome: "pass",
    summary: "Reviewed captured source.",
    criteria: [
      {
        id: "usage",
        status: "pass",
        evidence: "Read captured page.tsx.",
      },
    ],
    findings: [],
  }
}
const check = {
  id: "review",
  inputs: { include: ["page.tsx"] },
  criteria: [{ id: "usage" }],
}

function contextFrom(prompt) {
  return JSON.parse(prompt.prompt.split("\n\n").find((part) => part.startsWith('{"version":2')))
}

async function fixture(test) {
  const owned = await mkdtemp(path.join(root, ".runner-test-"))
  test.after(() => rm(owned, { recursive: true, force: true }))
  const directory = path.join(owned, "runs")
  const repositoryPath = path.join(owned, "checkout")
  await mkdir(directory)
  await mkdir(repositoryPath)
  await execute("git", ["init", "--quiet"], { cwd: repositoryPath })
  return {
    directory,
    repositoryPath,
    signal: new AbortController().signal,
    cliPath: process.execPath,
  }
}

function command(script, runner = {}) {
  return {
    id: "review",
    inputs: { include: ["page.tsx"] },
    runner: {
      type: "command",
      command: [process.execPath, "-e", script],
      report: "exit-code",
      ...runner,
    },
  }
}

async function waitFor(read) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read()
    if (value) return value
    await delay(10)
  }
  assert.fail("The owned child process did not reach the expected state.")
}

describe("runPrototypeCheck()", () => {
  for (const boundary of ["SDK parser", "SDK return", "command JSON"]) {
    it(`rejects a report with the wrong assessment identity at the ${boundary} boundary`, async (test) => {
      const options = await fixture(test)
      const snapshot = { ...input(), repositoryPath: options.repositoryPath }
      class Client {
        async start() {}
        async getAuthStatus() {
          return { isAuthenticated: true }
        }
        async createSession() {
          return {
            sessionId: "owned",
            abort: async () => {},
            async sendAndWait(prompt, schema) {
              const raw = result("0".repeat(64))
              return boundary === "SDK parser" ? schema.parse(raw) : raw
            },
          }
        }
        async deleteSession() {}
        async stop() {
          return []
        }
      }
      await assert.rejects(
        runPrototypeCheck(
          boundary === "command JSON"
            ? {
                ...command(
                  `console.log(${JSON.stringify(JSON.stringify(result("0".repeat(64))))})`,
                  {
                    report: "json",
                  },
                ),
                criteria: check.criteria,
              }
            : {
                ...check,
                runner: { type: "agent", instructions: "review.md" },
              },
          snapshot,
          {
            ...options,
            sdk: {
              CopilotClient: Client,
              RuntimeConnection: { forStdio: (value) => value },
            },
          },
        ),
        /mismatched|invalid/i,
      )
      assert.deepEqual(await readdir(options.directory), [])
    })
  }
  for (const mode of ["unread", "partial", "unverified"]) {
    it(`uses actual reads rather than a worker's forged coverage (${mode})`, async (test) => {
      const options = await fixture(test)
      const snapshot = input()
      snapshot.files.set("page.tsx", Buffer.from("x".repeat(10000)))
      class Client {
        async start() {}
        async getAuthStatus() {
          return { isAuthenticated: true }
        }
        async createSession(configuration) {
          return {
            sessionId: "owned",
            abort: async () => {},
            async sendAndWait(prompt) {
              const read = configuration.tools.find((tool) => tool.name === "read_snapshot").handler
              if (mode === "partial") read({ file: "page.tsx" })
              if (mode === "unverified") {
                let offset = 0
                do {
                  offset = JSON.parse(read({ file: "page.tsx", offset })).nextOffset
                } while (offset !== null)
              }
              const value = result(contextFrom(prompt).fingerprint)
              if (mode === "unverified") value.criteria[0].status = "unverified"
              return { ...value, readCoverage: { version: 1, files: [] } }
            },
          }
        }
        async deleteSession() {}
        async stop() {
          return []
        }
      }
      const assessment = await runPrototypeCheck(
        { ...check, runner: { type: "agent", instructions: "review.md" } },
        snapshot,
        {
          ...options,
          sdk: {
            CopilotClient: Client,
            RuntimeConnection: { forStdio: (value) => value },
          },
        },
      )
      assert.equal(assessment.outcome, "unverified")
      assert.equal(assessment.criteria[0].status, "unverified")
      assert.equal(assessment.readCoverage.files[0].status, mode === "unverified" ? "read" : mode)
    })
  }
  it("runs in the actual checkout with installed dependencies and a metadata file, not a snapshot copy", async (test) => {
    const options = await fixture(test)
    const snapshot = { ...input(), repositoryPath: options.repositoryPath }
    await writeFile(path.join(options.repositoryPath, "page.tsx"), "saved checkout source")
    const dependency = path.join(options.repositoryPath, "node_modules/local-check")
    await mkdir(dependency, { recursive: true })
    await writeFile(path.join(dependency, "index.js"), "module.exports = 'installed dependency'")
    const script = `
      const assert = require('node:assert/strict')
      const fs = require('node:fs')
      const path = require('node:path')
      assert.ok(fs.existsSync('.git'))
      assert.equal(fs.readFileSync('page.tsx', 'utf8'), 'saved checkout source')
      assert.equal(require('local-check'), 'installed dependency')
      assert.ok(path.isAbsolute(process.env.REPLICA_CHECK_CONTEXT))
      const context = JSON.parse(fs.readFileSync(process.env.REPLICA_CHECK_CONTEXT, 'utf8'))
      assert.match(context.fingerprint, /^[a-f0-9]{64}$/)
      assert.deepEqual(context.scope.files, ['page.tsx'])
      assert.deepEqual(Object.keys(context).sort(), ['checkId', 'criteria', 'fingerprint', 'scope', 'version'])
      fs.writeFileSync('local-output.txt', 'ordinary checkout permissions')
      console.log(JSON.stringify({ ...${JSON.stringify(result())}, fingerprint: context.fingerprint }))
    `
    const definition = {
      ...command(script, { report: "json" }),
      inputs: { include: ["page.tsx"] },
      criteria: check.criteria,
    }
    const value = await runPrototypeCheck(definition, snapshot, options)
    assert.equal(value.outcome, "pass")
    assert.equal(value.fingerprint, createCheckAssessment(definition, snapshot).fingerprint)
    assert.deepEqual(value.scope.files, ["page.tsx"])
    assert.equal(
      await readFile(path.join(options.repositoryPath, "local-output.txt"), "utf8"),
      "ordinary checkout permissions",
    )
    assert.deepEqual(await readdir(options.directory), [])
  })
  it("passes argv literally without an implicit host shell", async (test) => {
    const options = await fixture(test)
    const literal = "$(touch shell-executed); * $HOME"
    const value = await runPrototypeCheck(
      command("console.log(process.argv[1])", {
        command: [process.execPath, "-e", "console.log(process.argv[1])", literal],
      }),
      { ...input(), repositoryPath: options.repositoryPath },
      options,
    )
    assert.equal(value.outcome, "pass")
    assert.equal(value.summary, literal)
    await assert.rejects(readFile(path.join(options.repositoryPath, "shell-executed")), {
      code: "ENOENT",
    })
  })
  it("creates an independent empty SDK client with only immutable custom reads and deny-wins policy", async (test) => {
    const options = await fixture(test)
    const snapshot = input()
    let configuration
    let stopped = false
    class Client {
      constructor(value) {
        assert.equal(value.mode, "empty")
      }
      async start() {}
      async getAuthStatus() {
        return { isAuthenticated: true }
      }
      async createSession(value) {
        configuration = value
        return {
          sessionId: "owned",
          abort: async () => {},
          async sendAndWait(prompt, schema) {
            const context = contextFrom(prompt)
            assert.match(context.fingerprint, /^[a-f0-9]{64}$/)
            const tool = value.tools.find((item) => item.name === "read_snapshot")
            assert.equal(JSON.parse(tool.handler({ file: "page.tsx" })).content, "1: original code")
            assert.equal(tool.handler({ file: "/etc/passwd" }).resultType, "failure")
            return schema.parse(result(context.fingerprint))
          },
        }
      }
      async deleteSession(id) {
        assert.equal(id, "owned")
      }
      async stop() {
        stopped = true
        return []
      }
    }
    const sdk = {
      CopilotClient: Client,
      RuntimeConnection: { forStdio: (value) => value },
    }
    const assessment = await runPrototypeCheck(
      { ...check, runner: { type: "agent", instructions: "review.md" } },
      snapshot,
      {
        ...options,
        sdk,
      },
    )
    assert.equal(assessment.outcome, "pass")
    assert.deepEqual(assessment.scope, {
      files: ["page.tsx"],
      contextFiles: [],
    })
    assert.equal(assessment.readCoverage.files[0].status, "read")
    assert.equal(Object.hasOwn(assessment.readCoverage.files[0], "pageIds"), false)
    assert.deepEqual(configuration.excludedTools, ["builtin:*", "mcp:*"])
    assert.equal(configuration.skipCustomInstructions, true)
    assert.equal(configuration.onPermissionRequest({ kind: "write" }).kind, "reject")
    assert.equal(
      configuration.onPermissionRequest({
        kind: "custom-tool",
        toolName: "read_snapshot",
      }).kind,
      "approve-once",
    )
    assert.equal(
      configuration.onPermissionRequest({
        kind: "custom-tool",
        toolName: "read_snapshot",
        managedApprovalRequired: true,
      }).kind,
      "reject",
    )
    assert.equal(stopped, true)
    assert.deepEqual(await readdir(options.directory), [])
  })
  it("fails closed when the background runtime cannot authenticate", async (test) => {
    const options = await fixture(test)
    let stopped = false
    class Client {
      async start() {}
      async getAuthStatus() {
        return { isAuthenticated: false }
      }
      async stop() {
        stopped = true
        return []
      }
    }
    await assert.rejects(
      runPrototypeCheck(
        { ...check, runner: { type: "agent", instructions: "review.md" } },
        input(),
        {
          ...options,
          sdk: {
            CopilotClient: Client,
            RuntimeConnection: { forStdio: (value) => value },
          },
        },
      ),
      /not authenticated/,
    )
    assert.equal(stopped, true)
  })
  it("separates source from context guidance and denies reads outside the resolved scope", async (test) => {
    const options = await fixture(test)
    const snapshot = input()
    snapshot.files.set("context.md", Buffer.from("Team guidance"))
    snapshot.files.set("private.tsx", Buffer.from("Unrelated source"))
    class Client {
      async start() {}
      async getAuthStatus() {
        return { isAuthenticated: true }
      }
      async createSession(configuration) {
        return {
          sessionId: "owned",
          abort: async () => {},
          async sendAndWait(prompt) {
            const read = configuration.tools.find((tool) => tool.name === "read_snapshot").handler
            assert.equal(read({ file: "private.tsx" }).resultType, "failure")
            assert.match(JSON.parse(read({ file: "context.md" })).content, /Team guidance/)
            assert.match(JSON.parse(read({ file: "review.md" })).content, /Check component usage/)
            read({ file: "page.tsx" })
            return result(contextFrom(prompt).fingerprint)
          },
        }
      }
      async deleteSession() {}
      async stop() {
        return []
      }
    }
    const value = await runPrototypeCheck(
      {
        ...check,
        inputs: { include: ["page.tsx"] },
        context: ["context.md"],
        runner: { type: "agent", instructions: "review.md" },
      },
      snapshot,
      {
        ...options,
        sdk: {
          CopilotClient: Client,
          RuntimeConnection: { forStdio: (value) => value },
        },
      },
    )
    assert.equal(value.outcome, "pass")
    assert.deepEqual(value.scope, {
      files: ["page.tsx"],
      contextFiles: ["context.md"],
    })
  })
  for (const exitCode of [0, 1, 2, 123, 127]) {
    it(`adapts exit code ${exitCode} without confusing a check failure with an execution error`, async (test) => {
      const options = await fixture(test)
      const definition = command(
        `console.log('Source review output'); console.error('Diagnostic detail'); process.exit(${exitCode})`,
        exitCode === 1 ? {} : { failureExitCodes: [1, 123] },
      )
      const snapshot = { ...input(), repositoryPath: options.repositoryPath }
      const promise = runPrototypeCheck(definition, snapshot, options)
      if (![0, 1, 123].includes(exitCode)) {
        await assert.rejects(promise, /exit|execution|code|timed|deadline/i)
      } else {
        const value = await promise
        assert.equal(value.version, 2)
        assert.equal(value.fingerprint, createCheckAssessment(definition, snapshot).fingerprint)
        assert.equal(value.outcome, exitCode === 0 ? "pass" : "fail")
        assert.equal(value.summary.length > 0 && value.summary.length <= 400, true)
        assert.deepEqual(value.criteria, [])
        assert.ok(Array.isArray(value.findings))
      }
      assert.deepEqual(await readdir(options.directory), [])
    })
  }
  for (const failure of ["spawn", "signal", "stdout overflow", "stderr overflow"]) {
    it(`reports ${failure} as an execution error, never a quality outcome`, async (test) => {
      const options = await fixture(test)
      const scripts = {
        spawn: "",
        signal: "process.kill(process.pid, 'SIGTERM')",
        "stdout overflow": "process.stdout.write('x'.repeat(300000))",
        "stderr overflow": "process.stderr.write('x'.repeat(300000))",
      }
      await assert.rejects(
        runPrototypeCheck(
          command(scripts[failure], failure === "spawn" ? { command: ["./missing-check"] } : {}),
          { ...input(), repositoryPath: options.repositoryPath },
          options,
        ),
        /ENOENT|spawn|signal|SIGTERM|limit|size|output/i,
      )
      assert.deepEqual(await readdir(options.directory), [])
    })
  }
  for (const reason of ["cancellation", "timeout"]) {
    it(`stops a local command and its subprocess descendants on ${reason}`, async (test) => {
      const options = await fixture(test)
      const controller = new AbortController()
      const pidFile = path.join(options.repositoryPath, "descendant.pid")
      const childScript = `
        process.on('SIGTERM', () => {})
        require('node:fs').writeFileSync('descendant.pid', String(process.pid))
        setInterval(() => {}, 20)
      `
      const script = `
        process.on('SIGTERM', () => {})
        require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' })
        setInterval(() => {}, 20)
      `
      const pending = runPrototypeCheck(
        { ...command(script), timeoutSeconds: reason === "timeout" ? 1 : 10 },
        { ...input(), repositoryPath: options.repositoryPath },
        { ...options, signal: controller.signal },
      )
      const rejection = assert.rejects(
        pending,
        reason === "timeout" ? /timeout|timed|deadline/i : /abort|cancel/i,
      )
      const pid = await waitFor(async () => {
        try {
          return Number(await readFile(pidFile, "utf8"))
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
      })
      test.after(() => {
        try {
          process.kill(pid, "SIGKILL")
        } catch (error) {
          if (error.code !== "ESRCH") throw error
        }
      })
      if (reason === "cancellation") controller.abort()
      await rejection
      await waitFor(async () => {
        try {
          const { stdout } = await execute("ps", ["-o", "stat=", "-p", String(pid)])
          return !stdout.trim() || stdout.trim().startsWith("Z")
        } catch (error) {
          if (error.code === 1) return true
          throw error
        }
      })
      assert.deepEqual(await readdir(options.directory), [])
    })
  }
})
