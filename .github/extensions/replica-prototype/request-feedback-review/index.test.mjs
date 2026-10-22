import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { describe, it } from "node:test"

import { createCanvasContext } from "../create-canvas-context/index.mjs"
import { createHubClient } from "../create-hub-client/index.mjs"
import { requestFeedbackReview } from "./index.mjs"

const repository = "github/prototype"
const branch = "prototype/review"
const enabledSkill = [{ name: "review-hub-feedback", enabled: true }]
const maintainer = { repository, canReviewFeedback: true, viewerLogin: "octocat" }

// A checkout, a stored Hub connection and a Hub that answers the maintainer check.
async function withFixture(t, respond = () => [200, maintainer]) {
  const root = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  await mkdir(root, { recursive: true })
  t.after(() => rm(root, { recursive: true, force: true }))
  function git(...args) {
    execFileSync("git", args, { cwd: root, stdio: "ignore" })
  }
  git("init", "-q", "-b", branch)
  git("remote", "add", "origin", `https://github.com/${repository}.git`)
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "Fixture",
  )
  const fixture = { root, git, reviewChecks: [] }
  const server = createServer(async (request, response) => {
    request.resume()
    response.setHeader("X-Replica-Canvas-Version", "1")
    if (request.url !== "/api/canvas/feedback_review") {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "Not found." }))
      return
    }
    fixture.reviewChecks.push({
      method: request.method,
      authorization: request.headers.authorization,
    })
    const [status, result] = await respond(fixture)
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(result))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const directory = path.join(root, "credentials")
  await mkdir(directory, { mode: 0o700 })
  fixture.credentialFile = path.join(
    directory,
    `${createHash("sha256").update(`${origin}\n${repository}`).digest("hex")}.json`,
  )
  fixture.writeCredential = (token) =>
    writeFile(
      fixture.credentialFile,
      JSON.stringify({
        origin,
        repository,
        token,
        connectionId: token,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      { mode: 0o600 },
    )
  await fixture.writeCredential("fixture-token")
  fixture.context = await createCanvasContext({
    prototypeUrl: "http://localhost:3000",
    name: "Demo",
    repository,
    branch,
    sessionWorkspacePath: root,
    repositoryPath: root,
  })
  fixture.hub = createHubClient(fixture.context, { origin, directory })
  fixture.target = { repository, branch, hubOrigin: origin }
  fixture.sent = []
  fixture.session = (skills = enabledSkill) => ({
    rpc: { skills: { list: async () => ({ skills }) } },
    send: async (message) => {
      fixture.sent.push(message)
      return "dispatched"
    },
  })
  fixture.request = (options = {}, target = fixture.target, session = fixture.session()) =>
    requestFeedbackReview(fixture.context, session, fixture.hub, target, options)
  return fixture
}

describe("requestFeedbackReview()", () => {
  it("asks the current chat to run the review skill after Hub confirms maintainer access", async (t) => {
    const fixture = await withFixture(t)

    await fixture.request()

    assert.deepEqual(fixture.reviewChecks, [
      { method: "POST", authorization: "Bearer fixture-token" },
    ])
    assert.equal(fixture.sent.length, 1)
    assert.match(fixture.sent[0].prompt, /\/review-hub-feedback\b/)
  })

  for (const [label, status, result] of [
    [
      "writer",
      403,
      { error: "Reviewing repository feedback requires GitHub Admin or Maintain access." },
    ],
    ["revoked connection", 401, { error: "Unauthorized" }],
    ["older Hub without the check", 404, { error: "Not found." }],
    ["unavailable GitHub check", 503, {}],
    ["Hub that withholds the capability", 200, { ...maintainer, canReviewFeedback: false }],
    ["Hub that verified another repository", 200, { ...maintainer, repository: "github/other" }],
  ])
    it(`does not dispatch for a ${label}`, async (t) => {
      const fixture = await withFixture(t, () => [status, result])

      await assert.rejects(fixture.request())

      assert.equal(fixture.reviewChecks.length, 1)
      assert.deepEqual(fixture.sent, [])
    })

  for (const field of ["repository", "branch", "hubOrigin"])
    it(`does not dispatch when the displayed ${field} differs from the current target`, async (t) => {
      const fixture = await withFixture(t)

      await assert.rejects(fixture.request({}, { ...fixture.target, [field]: "stale" }))

      assert.deepEqual(fixture.sent, [])
      assert.deepEqual(fixture.reviewChecks, [])
    })

  for (const [label, change] of [
    [
      "the checkout switches branches",
      (fixture) => fixture.git("checkout", "-q", "-b", "prototype/other"),
    ],
    ["the Hub connection is replaced", (fixture) => fixture.writeCredential("replacement-token")],
  ])
    it(`does not dispatch when ${label} while Hub checks access`, async (t) => {
      const fixture = await withFixture(t, async (current) => {
        await change(current)
        return [200, maintainer]
      })

      await assert.rejects(fixture.request())

      assert.equal(fixture.reviewChecks.length, 1)
      assert.deepEqual(fixture.sent, [])
    })

  it("does not dispatch when the canvas context changes while Hub checks access", async (t) => {
    let answered = false
    const fixture = await withFixture(t, () => {
      answered = true
      return [200, maintainer]
    })

    await assert.rejects(
      fixture.request({
        verifyCurrent: async () => {
          if (answered) throw new Error("The canvas selection changed.")
        },
      }),
    )

    assert.deepEqual(fixture.sent, [])
  })

  for (const [label, skills] of [
    ["missing", []],
    ["disabled", [{ name: "review-hub-feedback", enabled: false }]],
  ])
    it(`reports a ${label} review skill instead of dispatching`, async (t) => {
      const fixture = await withFixture(t)

      await assert.rejects(
        fixture.request({}, fixture.target, fixture.session(skills)),
        /review-hub-feedback/,
      )

      assert.deepEqual(fixture.sent, [])
    })

  it("does not dispatch when session skill discovery fails", async (t) => {
    const fixture = await withFixture(t)
    const session = {
      rpc: {
        skills: {
          list: async () => {
            throw new Error("Skill discovery failed")
          },
        },
      },
      send: () => assert.fail("Must not dispatch"),
    }

    await assert.rejects(fixture.request({}, fixture.target, session))
  })

  it("dispatches once for overlapping clicks", async (t) => {
    let release
    const gate = new Promise((resolve) => (release = resolve))
    const fixture = await withFixture(t, async () => {
      await gate
      return [200, maintainer]
    })

    const requests = Promise.allSettled([fixture.request(), fixture.request()])
    await new Promise((resolve) => setTimeout(resolve, 100))
    release()
    const results = await requests

    assert.ok(results.some((result) => result.status === "fulfilled"))
    assert.equal(fixture.sent.length, 1)
  })
})
