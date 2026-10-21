import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { runPrototypeCheck } from "./index.mjs"

function input() {
  return {
    fingerprint: "snapshot",
    pages: [{ id: "page", route: "/page" }],
    pageFiles: { page: ["page.tsx"] },
    files: new Map([
      ["page.tsx", Buffer.from("original code")],
      ["review.md", Buffer.from("Check component usage.")],
    ]),
  }
}
function result() {
  return {
    version: 2,
    checkId: "review",
    fingerprint: "snapshot",
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
const check = { id: "review", criteria: [{ id: "usage" }] }

async function fixture(test) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "replica-checks-runner-"))
  test.after(() => rm(directory, { recursive: true, force: true }))
  return {
    directory,
    signal: new AbortController().signal,
    cliPath: process.execPath,
  }
}

describe("runPrototypeCheck()", () => {
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
            async sendAndWait() {
              const read = configuration.tools.find((tool) => tool.name === "read_snapshot").handler
              if (mode === "partial") read({ file: "page.tsx" })
              if (mode === "unverified") {
                let offset = 0
                do {
                  offset = JSON.parse(read({ file: "page.tsx", offset })).nextOffset
                } while (offset !== null)
              }
              const value = result()
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
          sdk: { CopilotClient: Client, RuntimeConnection: { forStdio: (value) => value } },
        },
      )
      assert.equal(assessment.outcome, "unverified")
      assert.equal(assessment.criteria[0].status, "unverified")
      assert.equal(assessment.readCoverage.files[0].status, mode === "unverified" ? "read" : mode)
    })
  }
  it("runs commands with only readonly snapshot mounts, no network/secrets and an in-container deadline", async (test) => {
    const options = await fixture(test)
    const snapshot = input()
    snapshot.files.set("review.mjs", Buffer.from("command wrapper"))
    snapshot.files.set("private.tsx", Buffer.from("Unrelated source"))
    snapshot.config = {
      pages: [{ id: "page", route: "/page", inputs: ["page.tsx", "private.tsx"] }],
    }
    snapshot.pages = []
    snapshot.pageFiles = {}
    let args
    async function execute(command, values) {
      assert.equal(command, "docker")
      if (values[0] === "image") return `sha256:${"a".repeat(64)}`
      if (values[0] === "rm") return ""
      args = values
      const mount = values.find((value) => value.includes("target=/snapshot,readonly"))
      const source = mount.split("source=")[1].split(",")[0]
      assert.equal(await readFile(path.join(source, "page.tsx"), "utf8"), "original code")
      assert.equal(await readFile(path.join(source, "review.mjs"), "utf8"), "command wrapper")
      await assert.rejects(readFile(path.join(source, "private.tsx")), { code: "ENOENT" })
      const contextMount = values.find((value) =>
        value.includes("target=/replica-context.json,readonly"),
      )
      const contextPath = contextMount.split("source=")[1].split(",")[0]
      const context = JSON.parse(await readFile(contextPath, "utf8"))
      assert.equal(context.fingerprint, "snapshot")
      assert.deepEqual(context.pages[0].files, ["page.tsx"])
      return JSON.stringify(result())
    }
    const value = await runPrototypeCheck(
      {
        ...check,
        inputs: { include: ["page.tsx"] },
        context: ["review.mjs"],
        runner: {
          type: "command",
          image: "checks:installed",
          command: ["node", "review.mjs"],
        },
      },
      snapshot,
      { ...options, execute },
    )
    assert.equal(value.outcome, "pass")
    assert.deepEqual(value.scope.files, ["page.tsx"])
    assert.deepEqual(value.scope.contextFiles, ["review.mjs"])
    assert.ok(args.includes("--read-only"))
    assert.ok(args.includes("none"))
    assert.ok(args.includes("no-new-privileges"))
    assert.ok(args.includes("/usr/bin/timeout"))
    assert.ok(!args.some((value) => value.includes("docker.sock")))
    assert.deepEqual(await readdir(options.directory), [])
  })
  it("creates an independent empty SDK client with only immutable custom reads and deny-wins policy", async (test) => {
    const options = await fixture(test)
    const snapshot = input()
    snapshot.config = { pages: [{ id: "page", route: "/page", inputs: ["page.tsx"] }] }
    snapshot.pages = []
    snapshot.pageFiles = {}
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
            const tool = value.tools.find((item) => item.name === "read_snapshot")
            assert.equal(JSON.parse(tool.handler({ file: "page.tsx" })).content, "1: original code")
            assert.equal(tool.handler({ file: "/etc/passwd" }).resultType, "failure")
            return schema.parse(result())
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
    assert.deepEqual(assessment.scope, { files: ["page.tsx"], contextFiles: [], pages: ["page"] })
    assert.equal(assessment.readCoverage.files[0].status, "read")
    assert.deepEqual(assessment.readCoverage.files[0].pageIds, ["page"])
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
          async sendAndWait() {
            const read = configuration.tools.find((tool) => tool.name === "read_snapshot").handler
            assert.equal(read({ file: "private.tsx" }).resultType, "failure")
            assert.match(JSON.parse(read({ file: "context.md" })).content, /Team guidance/)
            assert.match(JSON.parse(read({ file: "review.md" })).content, /Check component usage/)
            read({ file: "page.tsx" })
            return result()
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
        sdk: { CopilotClient: Client, RuntimeConnection: { forStdio: (value) => value } },
      },
    )
    assert.equal(value.outcome, "pass")
    assert.deepEqual(value.scope, {
      files: ["page.tsx"],
      contextFiles: ["context.md"],
      pages: ["page"],
    })
  })
  for (const exitCode of [0, 1, 2, 123, 124, 125, 126, 127, 137]) {
    it(`adapts exit code ${exitCode} without confusing a check failure with an execution error`, async (test) => {
      const options = await fixture(test)
      const command = {
        id: "review",
        runner: {
          type: "command",
          image: "checks:installed",
          command: ["node", "review.mjs"],
          report: "exit-code",
          ...(exitCode === 1 ? {} : { failureExitCodes: [1, 123] }),
        },
      }
      async function execute(executable, args, signal, executionOptions) {
        assert.equal(executable, "docker")
        if (args[0] === "image") return `sha256:${"a".repeat(64)}`
        if (args[0] === "rm") return ""
        assert.deepEqual(executionOptions, { captureExitCode: true })
        return { stdout: "Source review output", stderr: "Diagnostic detail", exitCode }
      }
      const promise = runPrototypeCheck(command, input(), { ...options, execute })
      if (![0, 1, 123].includes(exitCode)) {
        await assert.rejects(promise, /exit|execution|code|timed|deadline/i)
      } else {
        const value = await promise
        assert.equal(value.version, 2)
        assert.equal(value.outcome, exitCode === 0 ? "pass" : "fail")
        assert.equal(value.summary.length > 0 && value.summary.length <= 400, true)
        assert.deepEqual(value.criteria, [])
        assert.ok(Array.isArray(value.findings))
      }
      assert.deepEqual(await readdir(options.directory), [])
    })
  }
})
