import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { setTimeout } from "node:timers/promises"

import { capturePublishTarget } from "../publish-target/index.mjs"
import { readState } from "../read-state/index.mjs"
import { requestPublish } from "../request-publish/index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"
import { writeState } from "../write-state/index.mjs"
import { reportPublishResult } from "./index.mjs"

function requestTarget(prompt) {
  return prompt
    .split("\n\n")
    .map((paragraph) => {
      try {
        return JSON.parse(paragraph)
      } catch {
        return null
      }
    })
    .find((value) => value?.canvasInstanceId)
}

async function dispatch(context, mode = "commit-changes") {
  const prompts = []
  const session = {
    rpc: { skills: { list: async () => ({ skills: [] }) } },
    send: async ({ prompt }) => {
      prompts.push(prompt)
      return `message-${prompts.length}`
    },
  }
  await requestPublish(context, session, { instanceId: "canvas-1", mode })
  return { target: requestTarget(prompts.at(-1)), prompts, session }
}

function report(context, target, overrides = {}) {
  return reportPublishResult(context, {
    instanceId: "canvas-1",
    outcome: "blocked",
    reason: "The rebased branch cannot fast-forward origin.",
    mode: target.mode,
    target,
    ...overrides,
  })
}

describe("reportPublishResult()", () => {
  it("ends a request that stopped before pushing so the user can publish again", async () => {
    await withContext(async (context) => {
      const { target, prompts, session } = await dispatch(context)

      const result = await report(context, target)

      assert.equal(result.reported, true)
      const { publishRequest } = await readState(context)
      assert.equal(publishRequest.state, "failed")
      assert.equal(publishRequest.outcome, "blocked")
      assert.equal(
        publishRequest.error,
        "Copilot stopped before pushing because publishing was blocked. The rebased branch cannot fast-forward origin.",
      )

      await requestPublish(context, session, { instanceId: "canvas-1", mode: "commit-changes" })
      assert.equal(prompts.length, 2)
      assert.equal((await readState(context)).publishRequest.state, "requested")
    })
  })

  it("acknowledges a repeated report without changing the recorded outcome", async () => {
    await withContext(async (context) => {
      const { target } = await dispatch(context)
      await report(context, target, { outcome: "canceled", reason: undefined })
      const before = await readState(context)

      assert.equal(
        (await report(context, target, { outcome: "canceled", reason: undefined })).reported,
        false,
      )
      await assert.rejects(report(context, target, { outcome: "failed" }), { statusCode: 409 })
      await assert.rejects(
        report(context, target, { outcome: "canceled", reason: "A different reason." }),
        { statusCode: 409 },
      )
      assert.deepEqual((await readState(context)).publishRequest, before.publishRequest)
      assert.equal(
        before.publishRequest.error,
        "Publishing was canceled before anything was pushed.",
      )
    })
  })

  for (const [label, change] of [
    ["another canvas", { instanceId: "canvas-2" }],
    ["another mode", { mode: "committed-only" }],
    ["another repository", (target) => ({ target: { ...target, repository: "team/other" } })],
    ["another commit", (target) => ({ target: { ...target, commitSha: "f".repeat(40) } })],
    ["another branch", (target) => ({ target: { ...target, branch: "other" } })],
    ["another fetch remote", (target) => ({ target: { ...target, originFingerprint: "0" } })],
    ["another push remote", (target) => ({ target: { ...target, pushFingerprint: "0" } })],
    ["another target mode", (target) => ({ target: { ...target, mode: "committed-only" } })],
    ["another target canvas", (target) => ({ target: { ...target, canvasInstanceId: "other" } })],
    ["a missing reporting canvas", { instanceId: undefined }],
    [
      "a missing target canvas",
      (target) => {
        const withoutCanvas = { ...target }
        delete withoutCanvas.canvasInstanceId
        return { target: withoutCanvas }
      },
    ],
  ]) {
    it(`leaves the request pending for ${label}`, async () => {
      await withContext(async (context) => {
        const { target } = await dispatch(context)

        await assert.rejects(
          report(context, target, typeof change === "function" ? change(target) : change),
          { statusCode: 409 },
        )
        assert.equal((await readState(context)).publishRequest.state, "requested")
      })
    })
  }

  for (const canvasInstanceId of [null, undefined]) {
    it(`rejects a legacy request with ${canvasInstanceId} canvas identity`, async () => {
      await withContext(async (context) => {
        const { target } = await dispatch(context)
        const state = await readState(context)
        if (canvasInstanceId === undefined) delete state.publishRequest.canvasInstanceId
        else state.publishRequest.canvasInstanceId = canvasInstanceId
        await writeState(context, state)

        await assert.rejects(report(context, target), { statusCode: 409 })
        assert.deepEqual((await readState(context)).publishRequest, state.publishRequest)
      })
    })
  }

  it("rejects an original target after a committed-only checkout advances", async () => {
    await withContext(async (context) => {
      const { target } = await dispatch(context, "committed-only")
      const before = (await readState(context)).publishRequest
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
          "A different checkout commit",
        ],
        { cwd: context.repositoryPath },
      )

      await assert.rejects(report(context, target), { statusCode: 409 })
      assert.deepEqual((await readState(context)).publishRequest, before)
    })
  })

  it("accepts the original target after task commits advance a commit-changes request", async () => {
    await withContext(async (context) => {
      const { target } = await dispatch(context)
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
          "Task commit before a blocked push",
        ],
        { cwd: context.repositoryPath },
      )

      assert.equal((await report(context, target)).reported, true)
      assert.equal((await readState(context)).publishRequest.outcome, "blocked")
    })
  })

  it("does not overwrite a retry dispatched while the old report checks push evidence", async () => {
    await withContext(async (context) => {
      execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], {
        cwd: context.repositoryPath,
      })
      const entered = path.join(context.repositoryPath, "checking-push")
      const release = path.join(context.repositoryPath, "continue-check")
      await writeFile(
        path.join(context.repositoryPath, "gh"),
        `#!/bin/sh\n: > "${entered}"\nwhile [ ! -f "${release}" ]; do sleep 0.01; done\nprintf '[]'\n`,
        { mode: 0o755 },
      )
      const { target, session } = await dispatch(context)
      const initial = await readState(context)
      initial.publishRequest.requestedAt = new Date(Date.now() - 1000).toISOString()
      await writeState(context, initial)
      const originalPath = process.env.PATH
      process.env.PATH = `${context.repositoryPath}:${originalPath}`
      const pending = report(context, target)
      const rejected = assert.rejects(pending, { statusCode: 409 })
      try {
        let checking = false
        for (let attempt = 0; attempt < 300; attempt++) {
          checking = await access(entered).then(
            () => true,
            () => false,
          )
          if (checking) break
          await setTimeout(10)
        }
        assert.equal(checking, true, "The old report is waiting for push evidence.")
        const stopped = await readState(context)
        stopped.publishRequest.state = "failed"
        await writeState(context, stopped)
        await requestPublish(context, session, { instanceId: "canvas-1", mode: target.mode })
        const retry = (await readState(context)).publishRequest

        await writeFile(release, "")
        await rejected

        assert.deepEqual((await readState(context)).publishRequest, retry)
      } finally {
        await writeFile(release, "")
        await Promise.allSettled([pending, rejected])
        process.env.PATH = originalPath
      }
    })
  })

  it("rejects a report when no request is waiting", async () => {
    await withContext(async (context) => {
      const target = {
        ...(await capturePublishTarget(context)),
        mode: "commit-changes",
        canvasInstanceId: "canvas-1",
      }

      await assert.rejects(report(context, target), { statusCode: 409 })
      assert.equal((await readState(context)).publishRequest.state, "idle")
    })
  })

  it("rejects unsupported outcomes and unsafe reasons before changing state", async () => {
    await withContext(async (context) => {
      const { target } = await dispatch(context)

      await assert.rejects(report(context, target, { outcome: "published" }), /blocked, canceled/)
      await assert.rejects(report(context, target, { reason: "x".repeat(301) }), /300 characters/)
      await assert.rejects(report(context, target, { reason: { message: "blocked" } }), /text/)
      assert.equal((await readState(context)).publishRequest.state, "requested")

      await report(context, target, { outcome: "failed", reason: " Network\nerror\u2028here " })
      assert.equal(
        (await readState(context)).publishRequest.error,
        "Copilot could not publish this checkout. Network error here",
      )
    })
  })

  it("accepts a reason at the 300-character boundary", async () => {
    await withContext(async (context) => {
      const { target } = await dispatch(context)
      const reason = "x".repeat(300)

      assert.equal((await report(context, target, { reason })).reported, true)
      assert.ok((await readState(context)).publishRequest.error.endsWith(reason))
    })
  })

  it("keeps following publication when the push was already observed", async () => {
    await withContext(async (context) => {
      const originalPath = process.env.PATH
      const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: context.repositoryPath,
        encoding: "utf8",
      }).trim()
      execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], {
        cwd: context.repositoryPath,
      })
      const remoteFile = path.join(context.repositoryPath, "remote.json")
      await writeFile(
        remoteFile,
        JSON.stringify([
          { ref: "refs/heads/prototype", object: { type: "commit", sha: commitSha } },
        ]),
      )
      await writeFile(
        path.join(context.repositoryPath, "gh"),
        `#!/bin/sh\nif [ "$1:$2" = "run:list" ]; then echo "[]"; else cat "${remoteFile}"; fi\n`,
        { mode: 0o755 },
      )
      const target = await capturePublishTarget(context)
      const state = await readState(context)
      state.publishRequest = {
        state: "requested",
        requestedAt: new Date().toISOString(),
        messageId: "message-1",
        error: null,
        commitSha,
        mode: "committed-only",
        target,
        canvasInstanceId: "canvas-1",
        remoteState: "absent",
        remoteSha: null,
        workflowRunId: null,
        buildNumber: null,
      }
      await writeState(context, state)
      try {
        process.env.PATH = `${context.repositoryPath}:${originalPath}`

        await assert.rejects(
          report(context, { ...target, canvasInstanceId: "canvas-1", mode: "committed-only" }),
          { statusCode: 409, message: /push was already observed/ },
        )
        assert.equal((await readState(context)).publishRequest.state, "idle")
      } finally {
        process.env.PATH = originalPath
      }
    })
  })
})
