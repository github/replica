import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { it } from "node:test"

import { createCanvasContext } from "../create-canvas-context/index.mjs"
import { startCanvasServer } from "./index.mjs"

for (const { name, localCheckout, origin, skipProfile } of [
  {
    name: "keeps local-only comments login-only without looking up a GitHub profile",
    localCheckout: true,
    origin: "http://replica.localhost:19500",
    skipProfile: true,
  },
  {
    name: "still discovers a GitHub profile for a GitHub checkout with a loopback Hub",
    localCheckout: false,
    origin: "http://127.0.0.1:19500",
    skipProfile: false,
  },
  {
    name: "still discovers a GitHub profile for a local checkout with a remote Hub",
    localCheckout: true,
    origin: "https://hub.example.com",
    skipProfile: false,
  },
]) {
  it(name, async (t) => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    const repositoryPath = localCheckout
      ? path.join(workspace, ".local/prototypes/example")
      : path.join(workspace, "example")
    const repository = skipProfile ? "local/example" : "github/replica"
    const viewerLogin = skipProfile ? "local" : "octocat"
    const directory = path.join(workspace, "credentials")
    const callsFile = path.join(workspace, "gh-calls")
    const originalPath = process.env.PATH
    const originalTmpdir = process.env.TMPDIR
    let canvas
    await mkdir(repositoryPath, { recursive: true })
    await mkdir(directory, { mode: 0o700 })
    try {
      execFileSync("git", ["init", "-q", "-b", "prototype"], { cwd: repositoryPath })
      execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], {
        cwd: repositoryPath,
      })
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
          "Fixture",
        ],
        { cwd: repositoryPath },
      )
      await writeFile(callsFile, "")
      await writeFile(
        path.join(workspace, "gh"),
        `#!/bin/sh
if [ "$*" = "api --hostname github.com user" ]; then
  echo profile >> ${JSON.stringify(callsFile)}
  echo '{"login":"octocat","name":"The Octocat","avatar_url":"https://avatars.githubusercontent.com/u/583231"}'
  exit 0
fi
exit 1
`,
        { mode: 0o755 },
      )
      process.env.PATH = `${workspace}:${originalPath}`
      process.env.TMPDIR = workspace
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
      const realFetch = globalThis.fetch
      t.mock.method(globalThis, "fetch", (input, options) => {
        const url = new URL(input)
        if (url.origin !== origin) return realFetch(input, options)
        assert.ok(
          url.pathname === "/api/canvas/prototype" || url.pathname.endsWith("/review_comments"),
        )
        return Promise.resolve(
          Response.json(
            url.pathname === "/api/canvas/prototype"
              ? {
                  id: 1,
                  repositoryId: 2,
                  repository,
                  viewerLogin,
                  branch: "prototype",
                  registered: true,
                  build: null,
                }
              : { comments: [], hasMore: false, nextCursor: null },
          ),
        )
      })
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        repository: localCheckout ? "local/example" : repository,
        sessionWorkspacePath: workspace,
        repositoryPath,
      })
      canvas = await startCanvasServer(
        context,
        {},
        {
          localCommentsDirectory: path.join(workspace, "comments"),
          hubOptions: { origin, directory },
        },
      )
      const html = await (await fetch(canvas.url)).text()
      const { token } = JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
      async function send(route, body) {
        const response = await fetch(new URL(route, canvas.url), {
          method: body ? "POST" : "GET",
          headers: { "X-Replica-Canvas-Token": token },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        const result = await response.json()
        assert.equal(response.status, body ? 201 : 200, JSON.stringify(result))
        return result
      }
      const status = await send("/api/hub/status")
      assert.equal(status.state, "connected")
      assert.equal(status.reviewError, undefined)
      assert.equal(status.localCommentsError, undefined)
      const { comments } = await send("/api/hub/comments", {
        review_revision: status.reviewRevision,
        review_comment: { body: "Local review", anchor: { kind: "element", path: "/" } },
      })
      const author = skipProfile
        ? { login: "local", name: null, avatarUrl: null }
        : {
            login: "octocat",
            name: "The Octocat",
            avatarUrl: "https://avatars.githubusercontent.com/u/583231",
          }
      assert.deepEqual(comments[0].author, author)
      assert.deepEqual((await send("/api/hub/comments")).comments[0].author, author)
      assert.equal(await readFile(callsFile, "utf8"), skipProfile ? "" : "profile\n")
    } finally {
      await canvas?.close()
      process.env.PATH = originalPath
      if (originalTmpdir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = originalTmpdir
      await rm(workspace, { recursive: true, force: true })
    }
  })
}
