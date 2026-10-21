import assert from "node:assert/strict"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { refreshPrototypeStatus } from "../refresh-prototype-status/index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"
import { getPrototypeState } from "./index.mjs"
import { readState } from "../read-state/index.mjs"
import { writeState } from "../write-state/index.mjs"
import { capturePublishTarget } from "../publish-target/index.mjs"
import { execFileSync } from "node:child_process"

describe("getPrototypeState()", () => {
  it("does not query workflows using an unverified repository hint", async () => {
    await withContext(async (context) => {
      await mkdir(path.join(context.repositoryPath, ".github/workflows"), { recursive: true })
      await writeFile(
        path.join(context.repositoryPath, ".github/workflows/replica.yml"),
        "name: Replica\n",
      )
      const state = await getPrototypeState(context, { refresh: true })
      assert.equal(state.stats.workflow.state, "unavailable")
      assert.match(state.stats.workflow.detail, /could not be verified/)
      assert.equal(state.stats.remoteBranch.state, "unknown")
    })
  })
  it("refreshes expired evidence and new commits without forcing remote checks on every poll", async () => {
    await withContext(async (context) => {
      const first = await getPrototypeState(context, { refresh: true })
      assert.deepEqual(await getPrototypeState(context), first)
      const expired = await readState(context)
      expired.stats.refreshedAt = new Date(Date.now() - 61_000).toISOString()
      await writeState(context, expired)
      const refreshed = await getPrototypeState(context)
      assert.notEqual(refreshed.stats.refreshedAt, expired.stats.refreshedAt)
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "--allow-empty",
          "-qm",
          "Next",
        ],
        { cwd: context.repositoryPath },
      )
      const next = await getPrototypeState(context)
      assert.notEqual(next.stats.commitSha, first.stats.commitSha)
    })
  })

  for (const mode of ["legacy", "same-commit", "descendant"]) {
    it(`keeps a ${mode} request pending until new push evidence appears despite clock skew`, async () => {
      await withContext(async (context) => {
        const originalPath = process.env.PATH
        let commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: context.repositoryPath,
          encoding: "utf8",
        }).trim()
        const runFile = path.join(context.repositoryPath, "runs.json")
        const remoteFile = path.join(context.repositoryPath, "remote.json")
        await mkdir(path.join(context.repositoryPath, ".github/workflows"), { recursive: true })
        await writeFile(
          path.join(context.repositoryPath, ".github/workflows/replica.yml"),
          "name: Replica\n",
        )
        execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], {
          cwd: context.repositoryPath,
        })
        await writeFile(
          path.join(context.repositoryPath, "gh"),
          `#!/bin/sh
if [ "$1:$2" = "run:list" ]; then
  cat "${runFile}"
else
  cat "${remoteFile}"
fi
`,
          { mode: 0o755 },
        )
        function run(databaseId) {
          return [
            {
              databaseId,
              headSha: commitSha,
              headBranch: "prototype",
              status: "in_progress",
              conclusion: null,
              createdAt: "2000-01-01T00:00:00Z",
              updatedAt: "2000-01-01T00:00:00Z",
            },
          ]
        }
        try {
          process.env.PATH = `${context.repositoryPath}:${originalPath}`
          function remote() {
            return [
              {
                ref: "refs/heads/prototype",
                object: { type: "commit", sha: commitSha },
              },
            ]
          }
          await writeFile(remoteFile, JSON.stringify(remote()))
          await writeFile(runFile, JSON.stringify(run(1)))
          const state = await readState(context)
          state.publishRequest = {
            state: "requested",
            requestedAt: new Date().toISOString(),
            commitSha,
            ...(mode === "legacy" ? {} : { target: await capturePublishTarget(context) }),
            remoteState: "present",
            remoteSha: commitSha,
            workflowRunId: 1,
            buildNumber: 1,
          }
          await writeState(context, state)

          const existing = await getPrototypeState(context, { refresh: true })
          assert.equal(existing.stats.workflow.run.databaseId, 1)
          assert.equal(existing.publishRequest.state, "requested")

          if (mode === "descendant") {
            execFileSync(
              "git",
              [
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-qm",
                "Publication commit",
              ],
              { cwd: context.repositoryPath },
            )
            commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: context.repositoryPath,
              encoding: "utf8",
            }).trim()
            const committed = await getPrototypeState(context, { refresh: true })
            assert.equal(committed.publishRequest.state, "requested")
            assert.equal(committed.publishRequest.commitSha, commitSha)
            assert.deepEqual(committed.publishRequest.target, state.publishRequest.target)
            assert.equal(committed.publishRequest.requestedAt, state.publishRequest.requestedAt)
            await writeFile(remoteFile, JSON.stringify(remote()))
            // A new remote SHA is sufficient even without a new workflow run.
            await writeFile(runFile, "[]")
          } else {
            await writeFile(runFile, JSON.stringify(run(2)))
          }
          const rerun = await getPrototypeState(context, { refresh: true })
          if (mode !== "descendant") assert.equal(rerun.stats.workflow.run.databaseId, 2)
          assert.equal(rerun.publishRequest.state, "idle")
          assert.equal(rerun.publishRequest.error, null)
        } finally {
          process.env.PATH = originalPath
        }
      })
    })
  }

  for (const evidence of ["none", "push", "workflow"]) {
    it(`${evidence === "none" ? "keeps" : "clears"} a reported failure ${evidence === "none" ? "without" : "after"} new ${evidence === "none" ? "" : `${evidence} `}evidence for the current HEAD`, async () => {
      await withContext(async (context) => {
        const originalPath = process.env.PATH
        const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: context.repositoryPath,
          encoding: "utf8",
        }).trim()
        const runFile = path.join(context.repositoryPath, "runs.json")
        const remoteFile = path.join(context.repositoryPath, "remote.json")
        await mkdir(path.join(context.repositoryPath, ".github/workflows"), { recursive: true })
        await writeFile(
          path.join(context.repositoryPath, ".github/workflows/replica.yml"),
          "name: Replica\n",
        )
        execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], {
          cwd: context.repositoryPath,
        })
        await writeFile(
          path.join(context.repositoryPath, "gh"),
          `#!/bin/sh
if [ "$1:$2" = "run:list" ]; then
  cat "${runFile}"
else
  cat "${remoteFile}"
fi
`,
          { mode: 0o755 },
        )
        const run = {
          databaseId: evidence === "workflow" ? 2 : 1,
          headSha: commitSha,
          headBranch: "prototype",
          status: "in_progress",
          conclusion: null,
          createdAt: "2000-01-01T00:00:00Z",
          updatedAt: "2000-01-01T00:00:00Z",
        }
        try {
          process.env.PATH = `${context.repositoryPath}:${originalPath}`
          await writeFile(
            remoteFile,
            JSON.stringify([
              { ref: "refs/heads/prototype", object: { type: "commit", sha: commitSha } },
            ]),
          )
          await writeFile(runFile, JSON.stringify([run]))
          const state = await readState(context)
          state.publishRequest = {
            state: "failed",
            requestedAt: new Date().toISOString(),
            commitSha,
            target: await capturePublishTarget(context),
            mode: "committed-only",
            remoteState: evidence === "push" ? "absent" : "present",
            remoteSha: evidence === "push" ? null : commitSha,
            workflowRunId: 1,
            buildNumber: null,
            outcome: "blocked",
            reportedAt: new Date().toISOString(),
            error: "Copilot stopped before pushing.",
          }
          await writeState(context, state)

          const refreshed = await getPrototypeState(context, { refresh: true })
          if (evidence === "none") {
            assert.equal(refreshed.publishRequest.state, "failed")
            assert.equal(refreshed.publishStatus.state, "failed")
          } else {
            assert.equal(refreshed.publishRequest.state, "idle")
            assert.equal(refreshed.publishRequest.error, null)
            assert.equal(refreshed.publishRequest.outcome, undefined)
            assert.equal(refreshed.publishStatus.state, "in_progress")
          }
        } finally {
          process.env.PATH = originalPath
        }
      })
    })
  }

  it("caches until a forced refresh and persists the same state ID", async () => {
    await withContext(async (context) => {
      const withSession = { ...context, sessionId: "example-session-id" }
      const initial = await getPrototypeState(withSession)
      assert.equal(initial.sessionId, "example-session-id")
      assert.equal(initial.stats.refreshedAt, null)
      assert.equal(initial.stats.publishedUrl, "https://hub.example.com/prototype")
      assert.equal(initial.publishStatus.state, "unavailable")
      assert.deepEqual(await getPrototypeState(withSession), initial)

      const refreshed = await refreshPrototypeStatus(withSession)
      assert.equal(refreshed.sessionId, "example-session-id")
      assert.equal(refreshed.stateId, initial.stateId)
      assert.equal(refreshed.stats.workflow.state, "not_published")
      assert.equal(refreshed.publishStatus.state, "not_published")
      assert.ok(refreshed.stats.refreshedAt)
      assert.deepEqual(await getPrototypeState(withSession), refreshed)
      assert.equal(JSON.parse(await readFile(context.stateFile, "utf8")).version, 1)
    })
  })
})
