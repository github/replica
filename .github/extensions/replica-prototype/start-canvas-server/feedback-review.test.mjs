import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { describe, it } from "node:test"

import { withContext } from "../test-support/with-context/index.mjs"
import { startCanvasServer } from "./index.mjs"

const repository = "github/replica"

// Starts the canvas with a stored connection to a Hub whose access check the case controls.
async function withCanvas(options, run) {
  const { review = () => [200, null] } = options
  await withContext(async (context) => {
    const workspace = context.sessionWorkspacePath
    execFileSync("git", ["remote", "add", "origin", `https://github.com/${repository}.git`], {
      cwd: context.repositoryPath,
    })
    const bin = path.join(workspace, "bin")
    await mkdir(bin)
    await writeFile(path.join(bin, "gh"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    })
    const reviewChecks = []
    const hub = createServer(async (request, response) => {
      request.resume()
      response.setHeader("X-Replica-Canvas-Version", "1")
      response.setHeader("Content-Type", "application/json")
      let status = 200
      let result
      if (request.url === "/api/canvas/connection" && request.method === "GET") {
        result = { repository, canPublish: false, viewerLogin: "octocat" }
        if (request.headers["x-replica-canvas-activity"] === "interactive") {
          reviewChecks.push(request.headers.authorization)
          ;[status, result] = await review()
          result ??= { repository, canPublish: false, viewerLogin: "octocat" }
        }
      } else {
        status = 404
        result = { error: "Hub has not discovered this branch." }
      }
      response.writeHead(status)
      response.end(JSON.stringify(result))
    })
    await new Promise((resolve) => hub.listen(0, "127.0.0.1", resolve))
    const origin = `http://127.0.0.1:${hub.address().port}`
    const directory = path.join(workspace, "credentials")
    await mkdir(directory, { mode: 0o700 })
    const key = createHash("sha256").update(`${origin}\n${repository}`).digest("hex")
    await writeFile(
      path.join(directory, `${key}.json`),
      JSON.stringify({
        origin,
        repository,
        token: "fixture-token",
        connectionId: "fixture-connection",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      { mode: 0o600 },
    )
    const prompts = []
    const session = {
      rpc: {
        skills: {
          list: async () => ({
            skills: [{ name: "review-hub-feedback", enabled: true }],
          }),
        },
      },
      send: async ({ prompt }) => prompts.push(prompt),
    }
    const originalPath = process.env.PATH
    let canvas
    try {
      process.env.PATH = `${bin}:${originalPath}`
      canvas = await startCanvasServer(context, session, {
        localCommentsDirectory: path.join(workspace, "local-comments"),
        hubOptions: { origin, directory },
      })
      const page = await (await fetch(canvas.url)).text()
      const { token } = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
      async function send(
        route,
        method = "GET",
        body,
        headers = { "X-Replica-Canvas-Token": token },
      ) {
        const response = await fetch(new URL(route, canvas.url), {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return { status: response.status, body: await response.json() }
      }
      await run({ send, prompts, reviewChecks, origin })
    } finally {
      if (canvas) await canvas.close()
      process.env.PATH = originalPath
      await new Promise((resolve) => hub.close(resolve))
    }
  })
}

function displayedTarget(status) {
  return {
    repository: status.repository,
    branch: status.branch,
    hubOrigin: status.hubOrigin,
  }
}

describe("POST /api/hub/feedback-review", () => {
  it("requests the review in the current chat for a reader of the displayed repository", async () => {
    await withCanvas({}, async ({ send, prompts, reviewChecks, origin }) => {
      const status = (await send("/api/hub/status")).body
      assert.equal(status.repositoryAuthorized, true)
      assert.equal("canReviewFeedback" in status, false)
      assert.equal(status.canPublish, false)
      assert.deepEqual(displayedTarget(status), {
        repository,
        branch: "prototype",
        hubOrigin: origin,
      })

      const requested = await send("/api/hub/feedback-review", "POST", displayedTarget(status))

      assert.ok(requested.status >= 200 && requested.status < 300, JSON.stringify(requested.body))
      assert.deepEqual(reviewChecks, ["Bearer fixture-token"])
      assert.equal(prompts.length, 1)
      assert.match(prompts[0], /\/review-hub-feedback\b/)
    })
  })

  it("requires the canvas token before checking Hub or dispatching", async () => {
    await withCanvas({}, async ({ send, prompts, reviewChecks, origin }) => {
      const target = { repository, branch: "prototype", hubOrigin: origin }

      const rejected = await send("/api/hub/feedback-review", "POST", target, {})

      assert.equal(rejected.status, 403)
      assert.deepEqual(reviewChecks, [])
      assert.deepEqual(prompts, [])
    })
  })

  it("returns Hub's refusal as a visible error without dispatching", async () => {
    const error =
      "Reviewing repository feedback requires repository access through a connected Hub."
    await withCanvas({ review: () => [403, { error }] }, async ({ send, prompts }) => {
      const status = (await send("/api/hub/status")).body

      const refused = await send("/api/hub/feedback-review", "POST", displayedTarget(status))

      assert.equal(refused.status, 403)
      assert.equal(refused.body.error, error)
      assert.deepEqual(prompts, [])
    })
  })

  it("does not dispatch when another Hub is selected while access is checked", async () => {
    let selectOtherHub
    await withCanvas(
      {
        review: async () => {
          await selectOtherHub()
          return [200, null]
        },
      },
      async ({ send, prompts, origin }) => {
        selectOtherHub = async () => {
          const port = new URL(origin).port
          const selected = await send("/api/hub/origin", "POST", {
            origin: `http://localhost:${port}`,
          })
          assert.equal(selected.status, 200)
        }
        const status = (await send("/api/hub/status")).body

        const stale = await send("/api/hub/feedback-review", "POST", displayedTarget(status))

        assert.equal(stale.status, 409)
        assert.deepEqual(prompts, [])
      },
    )
  })
})
