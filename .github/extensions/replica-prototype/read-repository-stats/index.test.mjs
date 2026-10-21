import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { readRepositoryStats } from "./index.mjs"

describe("readRepositoryStats()", () => {
  it("compares the upstream or local main without claiming a remote exists", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    function git(...args) {
      return execFileSync("git", args, { cwd: workspace, stdio: "pipe" })
    }
    const context = {
      repositoryPath: workspace,
      target: {
        repository: null,
        branch: "prototype/welcome",
        commitSha: null,
        publishedUrl: null,
      },
      urlHost: "localhost:3000",
    }
    try {
      git("init", "-b", "main")
      function commit(message) {
        return git(
          "-c",
          "user.name=Replica",
          "-c",
          "user.email=replica@example.com",
          "commit",
          "--allow-empty",
          "-m",
          message,
        )
      }
      commit("Initial")
      git("switch", "-c", "prototype/welcome")
      commit("Prototype")

      assert.deepEqual((await readRepositoryStats(context)).comparison, {
        branch: "main",
        source: "local",
        behind: 0,
        error: null,
      })

      git("switch", "main")
      commit("New main commit")
      git("switch", "prototype/welcome")
      assert.equal((await readRepositoryStats(context)).comparison.behind, 1)

      git("branch", "--set-upstream-to=main", "prototype/welcome")
      assert.deepEqual((await readRepositoryStats(context)).comparison, {
        branch: "main",
        source: "upstream",
        behind: 1,
        error: null,
      })

      git("branch", "--unset-upstream")
      git("branch", "-D", "main")
      assert.match(
        (await readRepositoryStats(context)).comparison.error,
        /No upstream or local main branch/,
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it("does not use a stale branch hint or query its workflow in a detached checkout", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    const originalPath = process.env.PATH
    function git(...args) {
      return execFileSync("git", args, { cwd: workspace, stdio: "pipe" })
    }
    try {
      git("init", "-b", "main")
      git(
        "-c",
        "user.name=Replica",
        "-c",
        "user.email=replica@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "Initial",
      )
      git(
        "-c",
        "user.name=Replica",
        "-c",
        "user.email=replica@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "New main commit",
      )
      git("switch", "--detach", "HEAD~1")
      await mkdir(path.join(workspace, ".github/workflows"), {
        recursive: true,
      })
      await writeFile(path.join(workspace, ".github/workflows/replica.yml"), "name: Replica\n")
      await writeFile(path.join(workspace, "gh"), '#!/bin/sh\ntouch "$PWD/gh-called"\n', {
        mode: 0o755,
      })
      process.env.PATH = `${workspace}:${originalPath}`

      const stats = await readRepositoryStats({
        repositoryPath: workspace,
        target: {
          repository: "github/replica",
          branch: "stale/target",
          commitSha: null,
          publishedUrl: null,
        },
        urlHost: "localhost:3000",
      })
      assert.equal(stats.branch, null)
      assert.match(stats.branchError, /detached HEAD/)
      assert.deepEqual(stats.comparison, {
        branch: null,
        source: null,
        behind: null,
        error: stats.branchError,
      })
      assert.equal(stats.replicaWorkflowExists, true)
      assert.equal(stats.workflow.state, "unavailable")
      assert.match(stats.workflow.detail, /current git branch is unavailable/)
      await assert.rejects(access(path.join(workspace, "gh-called")), {
        code: "ENOENT",
      })
    } finally {
      process.env.PATH = originalPath
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it("matches workflow branch and commit without calling workflow success publication", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    const originalPath = process.env.PATH
    try {
      await mkdir(path.join(workspace, ".github/workflows"), {
        recursive: true,
      })
      await writeFile(path.join(workspace, ".github/workflows/replica.yml"), "name: Replica\n")
      await writeFile(
        path.join(workspace, "git"),
        `#!/bin/sh\ncase "$1:$2" in\n  remote:*) echo git@github.com:github/replica.git ;;\n  rev-parse:HEAD) printf '%s\\n' "\${TEST_COMMIT:-${"a".repeat(40)}}" ;;\n  rev-parse:*) echo prototype ;;\nesac\n`,
        { mode: 0o755 },
      )
      const runs = [
        {
          status: "completed",
          conclusion: "success",
          headSha: "a".repeat(40),
          headBranch: "prototype",
          databaseId: 123,
          updatedAt: "2026-09-23T09:00:00Z",
          url: "https://github.com/github/replica/actions/runs/123",
        },
        {
          status: "completed",
          conclusion: "success",
          headSha: "b".repeat(40),
          headBranch: "prototype",
        },
        {
          status: "completed",
          conclusion: "failure",
          headSha: "c".repeat(40),
          headBranch: "prototype",
        },
      ]
      await writeFile(path.join(workspace, "gh-runs.json"), JSON.stringify(runs))
      await writeFile(
        path.join(workspace, "gh"),
        `#!/bin/sh
case "$1:$2" in
  run:list) printf '%s\\n' "$@" > gh-run-args; cat gh-runs.json ;;
  api:repos/*) printf '%s\\n' '{"actor":{"login":"workflow-actor","avatar_url":"https://avatars.githubusercontent.com/u/1"}}' ;;
  api:users/*) printf '%s\\n' '{"name":"Workflow Actor"}' ;;
esac
`,
        { mode: 0o755 },
      )
      process.env.PATH = `${workspace}:${originalPath}`

      const context = {
        repositoryPath: workspace,
        target: {
          repository: "github/replica",
          branch: "stale/target",
          commitSha: null,
          publishedUrl: "https://hub.example.com/prototype",
        },
        urlHost: "localhost:3000",
      }
      const stats = await readRepositoryStats(context)
      assert.match(
        await readFile(path.join(workspace, "gh-run-args"), "utf8"),
        /--branch\nprototype\n/,
      )
      assert.equal(stats.branch, "prototype")
      assert.equal(stats.workflow.state, "succeeded")
      assert.equal(stats.workflow.versionCount, 2)
      assert.deepEqual(stats.workflow.run.actor, {
        login: "workflow-actor",
        name: "Workflow Actor",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      })
      assert.equal(stats.publishedUrl, "https://hub.example.com/prototype")

      process.env.TEST_COMMIT = "c".repeat(40)
      const pinned = await readRepositoryStats({
        ...context,
        target: { ...context.target, commitSha: "c".repeat(40) },
      })
      assert.equal(pinned.workflow.state, "failed")
      assert.equal(pinned.workflow.run.headSha, "c".repeat(40))

      delete process.env.TEST_COMMIT
      for (const [status, conclusion, expectedConclusion] of [
        ["queued", "", null],
        ["in_progress", "", null],
        ["queued", null, null],
        ["in_progress", null, null],
        ["completed", "", ""],
        ["completed", null, null],
        ["completed", undefined, undefined],
        ["in_progress", "invalid", "invalid"],
        ["in_progress", "success", "success"],
      ]) {
        await writeFile(
          path.join(workspace, "gh-runs.json"),
          JSON.stringify([{ ...runs[0], status, conclusion }]),
        )
        const refreshed = await readRepositoryStats(context)
        assert.equal(refreshed.workflow.state, status === "completed" ? "failed" : "in_progress")
        assert.equal(refreshed.workflow.run.conclusion, expectedConclusion)
      }

      for (const invalidRuns of [
        null,
        { runs },
        [null],
        [{ ...runs[0], headSha: 123 }],
        [{ ...runs[0], headBranch: null }],
      ]) {
        await writeFile(path.join(workspace, "gh-runs.json"), JSON.stringify(invalidRuns))
        const unavailable = await readRepositoryStats(context)
        assert.equal(unavailable.workflow.state, "unavailable")
        assert.equal(unavailable.workflow.run, null)
        assert.match(unavailable.workflow.detail, /invalid workflow data/)
      }

      await writeFile(
        path.join(workspace, "gh-runs.json"),
        JSON.stringify([{ ...runs[0], databaseId: { unexpected: "run ID" } }]),
      )
      const missingPublisher = await readRepositoryStats(context)
      assert.equal(missingPublisher.workflow.state, "succeeded")
      assert.equal(missingPublisher.workflow.run.actor, null)
      assert.match(missingPublisher.workflow.run.actorError, /publisher is unavailable/)
    } finally {
      delete process.env.TEST_COMMIT
      process.env.PATH = originalPath
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
