import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { createServer, request as httpRequest } from "node:http"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { describe, it } from "node:test"

import { createCanvasContext } from "../create-canvas-context/index.mjs"
import { startCanvasServer } from "./index.mjs"
import { withContext } from "../test-support/with-context/index.mjs"
import { readState } from "../read-state/index.mjs"
import { writeState } from "../write-state/index.mjs"
import { createPublishPreferences } from "../publish-preferences/index.mjs"
import { agentCommands } from "../agent-commands/index.mjs"

function publishData(prompt) {
  assert.match(prompt, /\/replica-publish-prototype\b/)
  const data = prompt.split("\n\n").find((paragraph) => paragraph.startsWith('{"repository":'))
  assert.ok(data, "The publishing request includes its verified target.")
  return JSON.parse(data)
}

describe("startCanvasServer()", () => {
  it("rejects malformed HTTP action results without consuming the pending command", async () => {
    await withContext(async (context) => {
      const commands = agentCommands()
      const canvas = await startCanvasServer(
        context,
        {
          send() {
            throw new Error("Action results must not send chat requests.")
          },
        },
        { agentCommands: commands },
      )
      try {
        const html = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        const headers = { "X-Replica-Canvas-Token": token, "X-Replica-Renderer-Id": "renderer-1" }
        const pending = commands.invoke("reload")
        pending.catch(() => {})
        const next = await (await fetch(new URL("/api/agent/next", canvas.url), { headers })).json()
        const id = next.command.id
        for (const body of ["null", "[]", "{broken"]) {
          const response = await fetch(new URL("/api/agent/result", canvas.url), {
            method: "POST",
            headers,
            body,
          })
          assert.equal(response.status, 400)
        }
        for (const value of [
          { id, ok: true, value: { reloaded: true, address: 123 } },
          { id, ok: false, error: "" },
          { id, ok: false, error: "Failed", extra: true },
        ]) {
          const response = await fetch(new URL("/api/agent/result", canvas.url), {
            method: "POST",
            headers,
            body: JSON.stringify(value),
          })
          assert.equal(response.status, 422)
        }
        assert.equal(commands.diagnostics().requests[0].outcome, "pending")
        const value = { reloaded: true, address: context.normalizedUrl }
        const accepted = await fetch(new URL("/api/agent/result", canvas.url), {
          method: "POST",
          headers,
          body: JSON.stringify({ id, ok: true, value }),
        })
        assert.equal(accepted.status, 200)
        assert.deepEqual(await pending, value)
      } finally {
        await canvas.close()
      }
    })
  })

  it("protects saved notes with the canvas token and restores them after reopening", async () => {
    await withContext(async (context) => {
      const options = {
        improvementNotesDirectory: path.join(context.sessionWorkspacePath, "notes"),
        hubOptions: {
          directory: path.join(context.sessionWorkspacePath, "credentials"),
        },
      }
      let canvas = await startCanvasServer(context, { send: assert.fail }, options)
      try {
        const html = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        const headers = { "X-Replica-Canvas-Token": token }
        const endpoint = new URL("/api/improvement-notes", canvas.url)
        assert.equal((await fetch(endpoint)).status, 403)
        const captureEndpoint = new URL("/api/improvement-notes/capture", canvas.url)
        assert.equal((await fetch(captureEndpoint, { method: "POST" })).status, 403)
        const captured = await (await fetch(captureEndpoint, { method: "POST", headers })).json()
        const state = await (await fetch(endpoint, { headers })).json()
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            identity: state.identity,
            revision: state.revision,
            operation: "create",
            sourceId: captured.sourceId,
            body: "Improve the selected button.",
            anchor: {
              schemaVersion: 1,
              kind: "element",
              route: { pathname: "/", search: "", hash: "" },
              selector: "#save",
              accessibleName: "Save",
              tagName: "button",
              selectedText: "",
              rect: { x: 20, y: 30, width: 100, height: 32 },
              viewport: { width: 960, height: 560, scrollX: 0, scrollY: 0 },
              elementOffset: { x: 0.5, y: 0.5 },
            },
          }),
        })
        const saved = await response.json()
        assert.equal(response.status, 200, JSON.stringify(saved))
        assert.match(saved.notes[0].source.treeSha, /^[0-9a-f]{40}$/)
        await canvas.close()
        canvas = await startCanvasServer(context, { send: assert.fail }, options)
        const reopenedHtml = await (await fetch(canvas.url)).text()
        const reopened = JSON.parse(reopenedHtml.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        const restored = await fetch(new URL("/api/improvement-notes", canvas.url), {
          headers: { "X-Replica-Canvas-Token": reopened.token },
        })
        assert.equal(restored.status, 200)
        assert.deepEqual((await restored.json()).notes, saved.notes)
      } finally {
        await canvas.close()
      }
    })
  })

  it("requires an explicit committed-only choice after a failed check even with saved commit permission", async () => {
    await withContext(async (context) => {
      const directory = path.join(context.sessionWorkspacePath, "publish-settings")
      await writeFile(
        path.join(context.repositoryPath, ".git/info/exclude"),
        "replica-prototype/\npublish-settings/\n",
      )
      const prompts = []
      const canvas = await startCanvasServer(
        context,
        { send: ({ prompt }) => prompts.push(prompt) },
        {
          publishPreferencesDirectory: directory,
          hubOptions: {
            directory: path.join(context.sessionWorkspacePath, "replica-prototype", "credentials"),
          },
        },
      )
      try {
        const html = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        async function send(route, body = {}) {
          const response = await fetch(new URL(route, canvas.url), {
            method: "POST",
            headers: { "X-Replica-Canvas-Token": token },
            body: JSON.stringify(body),
          })
          return { status: response.status, body: await response.json() }
        }
        const initial = await send("/api/publish/prepare")
        const preferences = createPublishPreferences(directory)
        const index = path.join(context.repositoryPath, ".git/index")
        await writeFile(index, "invalid Git index")
        const failed = await send("/api/publish/prepare")
        assert.equal(failed.status, 200)
        assert.deepEqual(failed.body.target, initial.body.target)
        assert.equal(failed.body.workingTree, "unavailable")
        assert.ok(failed.body.workingTreeError)
        assert.equal("changes" in failed.body, false)
        const unchecked = {
          target: failed.body.target,
          workingTree: "unavailable",
        }
        for (const remember of [false, true]) {
          await preferences.write(initial.body.target, remember)
          assert.equal((await send("/api/publish", unchecked)).status, 409)
          assert.equal(
            (
              await send("/api/publish", {
                ...unchecked,
                mode: "commit-changes",
                remember: true,
              })
            ).status,
            409,
          )
          assert.equal(await preferences.read(initial.body.target), remember)
        }
        assert.equal((await send("/api/publish")).status, 409)
        assert.equal(
          (
            await send("/api/publish", {
              ...unchecked,
              workingTree: "clean",
              mode: "commit-changes",
            })
          ).status,
          409,
        )
        for (const field of [
          "commitSha",
          "branch",
          "repository",
          "originFingerprint",
          "pushFingerprint",
        ]) {
          assert.equal(
            (
              await send("/api/publish", {
                ...unchecked,
                target: { ...unchecked.target, [field]: "stale" },
                mode: "committed-only",
              })
            ).status,
            409,
          )
        }
        assert.equal(
          (
            await send("/api/publish", {
              ...unchecked,
              mode: "committed-only",
              remember: true,
            })
          ).status,
          422,
        )
        assert.equal(prompts.length, 0)
        await preferences.write(initial.body.target, false)
        assert.equal(
          (await send("/api/publish", { ...unchecked, mode: "committed-only" })).status,
          202,
        )
        assert.equal(prompts.length, 1)
        assert.deepEqual(
          {
            repository: publishData(prompts[0]).repository,
            branch: publishData(prompts[0]).branch,
            commitSha: publishData(prompts[0]).commitSha,
            mode: publishData(prompts[0]).mode,
          },
          {
            repository: initial.body.target.repository,
            branch: initial.body.target.branch,
            commitSha: initial.body.target.commitSha,
            mode: "committed-only",
          },
        )
        assert.equal(await preferences.read(initial.body.target), false)
        assert.equal(await readFile(index, "utf8"), "invalid Git index")
        assert.equal(
          execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: context.repositoryPath,
            encoding: "utf8",
          }).trim(),
          initial.body.target.commitSha,
        )
        await rm(index)
        assert.equal((await send("/api/publish/prepare")).body.workingTree, "clean")
      } finally {
        await canvas.close()
      }
    })
  })

  it("checks changes on click, requires a publish choice, saves branch permission and rejects stale targets", async () => {
    await withContext(async (context) => {
      const directory = path.join(context.sessionWorkspacePath, "publish-settings")
      await writeFile(
        path.join(context.repositoryPath, ".git/info/exclude"),
        "replica-prototype/\npublish-settings/\n",
      )
      const prompts = []
      const canvas = await startCanvasServer(
        context,
        {
          send: ({ prompt }) => {
            prompts.push(prompt)
            return "publish-message"
          },
        },
        {
          publishPreferencesDirectory: directory,
          hubOptions: {
            directory: path.join(context.sessionWorkspacePath, "replica-prototype", "credentials"),
          },
        },
      )
      try {
        const html = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        async function send(route, body = {}) {
          const response = await fetch(new URL(route, canvas.url), {
            method: "POST",
            headers: { "X-Replica-Canvas-Token": token },
            body: JSON.stringify(body),
          })
          return { status: response.status, body: await response.json() }
        }
        const clean = await send("/api/publish/prepare")
        assert.equal(clean.status, 200)
        assert.equal(clean.body.workingTree, "clean")
        assert.equal(clean.body.remember, false)
        assert.equal(prompts.length, 0)
        await writeFile(path.join(context.repositoryPath, "prototype.txt"), "Local prototype edits")
        const initialHead = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: context.repositoryPath,
          encoding: "utf8",
        })
        const changed = await send("/api/publish/prepare")
        assert.equal(changed.body.workingTree, "changed")
        assert.equal(
          (
            await send("/api/publish", {
              target: clean.body.target,
              workingTree: "clean",
              mode: "committed-only",
            })
          ).status,
          409,
        )
        assert.equal((await send("/api/publish")).status, 409)
        assert.equal(prompts.length, 0)
        assert.equal((await send("/api/publish", { mode: "invalid" })).status, 422)
        assert.equal(
          (
            await send("/api/publish", {
              mode: "committed-only",
              remember: true,
            })
          ).status,
          422,
        )
        assert.equal(
          (
            await send("/api/publish", {
              target: { ...changed.body.target, commitSha: "0".repeat(40) },
              mode: "commit-changes",
              remember: true,
            })
          ).status,
          409,
        )
        assert.equal(await createPublishPreferences(directory).read(changed.body.target), false)
        assert.equal(
          (
            await send("/api/publish", {
              target: changed.body.target,
              mode: "committed-only",
            })
          ).status,
          202,
        )
        assert.equal(publishData(prompts[0]).mode, "committed-only")
        assert.equal(publishData(prompts[0]).commitSha, initialHead.trim())
        assert.equal(
          execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: context.repositoryPath,
            encoding: "utf8",
          }),
          initialHead,
        )
        assert.equal(
          await readFile(path.join(context.repositoryPath, "prototype.txt"), "utf8"),
          "Local prototype edits",
        )
        const state = await readState(context)
        state.publishRequest.state = "idle"
        await writeState(context, state)
        assert.equal(
          (
            await send("/api/publish", {
              target: changed.body.target,
              mode: "commit-changes",
              remember: true,
            })
          ).status,
          202,
        )
        assert.equal(publishData(prompts[1]).mode, "commit-changes")
        assert.equal(publishData(prompts[1]).branch, changed.body.target.branch)
        assert.equal((await send("/api/publish/prepare")).body.remember, true)
        assert.equal((await send("/api/publish", { target: changed.body.target })).status, 202)
        assert.equal(prompts.length, 2)
        assert.equal(
          (
            await send("/api/publish/preference", {
              target: changed.body.target,
              remember: false,
            })
          ).status,
          200,
        )
        assert.equal((await send("/api/publish/prepare")).body.remember, false)
        assert.equal((await send("/api/publish")).status, 409)
        const denied = await fetch(new URL("/api/publish/preference", canvas.url), {
          method: "POST",
          body: "{}",
        })
        assert.equal(denied.status, 403)
      } finally {
        await canvas.close()
      }
    })
  })

  it("requires a separate document capability before exposing the renderer or action token", async () => {
    const root = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(path.join(root, ".git"), { recursive: true })
    const context = {
      name: "Security fixture",
      repositoryPath: root,
      normalizedUrl: "http://localhost:5173/route?view=demo#/actions",
      sessionWorkspacePath: root,
    }
    let server
    let other
    let commands = 0
    try {
      server = await startCanvasServer(
        context,
        {},
        {
          prototypeStatus: async () => ({ available: true }),
          agentCommands: {
            next() {
              commands += 1
              return null
            },
            close() {},
          },
        },
      )
      other = await startCanvasServer(context, {})
      const url = new URL(server.url)
      const documentToken = url.searchParams.get("document")
      assert.match(documentToken, /^[A-Za-z0-9_-]{43}$/)
      assert.notEqual(documentToken, new URL(other.url).searchParams.get("document"))
      const page = await fetch(server.url)
      assert.equal(page.status, 200)
      assert.equal(page.headers.get("referrer-policy"), "no-referrer")
      assert.equal(page.headers.get("cache-control"), "no-store")
      const html = await page.text()
      const { token, prototypeUrl, previewUrl } = JSON.parse(
        html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1],
      )
      assert.equal(prototypeUrl, context.normalizedUrl)
      assert.notEqual(new URL(previewUrl).origin, url.origin)
      assert.equal(new URL(previewUrl).pathname, new URL(prototypeUrl).pathname)
      assert.notEqual(documentToken, token)
      assert.ok(!html.includes(documentToken))
      const headers = { "X-Replica-Canvas-Token": token }
      for (const search of [
        "",
        "?document=",
        "?document=wrong",
        `?document=${token}`,
        `?document=${new URL(other.url).searchParams.get("document")}`,
        `?document=${documentToken}&document=${documentToken}`,
      ]) {
        const denied = await fetch(`${url.origin}/${search}`, {
          headers: {
            ...headers,
            Origin: context.normalizedUrl,
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Dest": "iframe",
          },
        })
        assert.equal(denied.status, 403)
        assert.equal(denied.headers.get("location"), null)
        assert.equal(denied.headers.get("content-type"), "application/json; charset=utf-8")
        assert.deepEqual(await denied.json(), {
          error: "Invalid canvas document token.",
        })
      }
      assert.equal((await fetch(`${server.url}&view=extra`)).status, 200)
      const invalidHost = await new Promise((resolve, reject) => {
        const request = httpRequest(
          server.url,
          { headers: { Host: "attacker.example" } },
          (response) => {
            response.resume()
            response.on("end", () => resolve(response.statusCode))
          },
        )
        request.on("error", reject)
        request.end()
      })
      assert.equal(invalidHost, 403)
      const asset = await fetch(new URL("/assets/renderer.js?view=extra", server.url))
      assert.equal(asset.status, 200)
      const assetSource = await asset.text()
      assert.ok(!assetSource.includes(token))
      assert.ok(!assetSource.includes(documentToken))
      for (const [pathname, method] of [
        ["/api/agent/next", "GET"],
        ["/api/agent/result", "POST"],
        ["/api/prototype/status", "GET"],
        ["/api/hub/events", "GET"],
        ["/api/hub/mention-candidates?repositoryId=5&prototypeId=4", "GET"],
        ["/api/publish", "POST"],
      ]) {
        for (const supplied of [undefined, "wrong", documentToken]) {
          const actionUrl = new URL(`${pathname}?document=${documentToken}`, server.url)
          const denied = await fetch(actionUrl, {
            method,
            headers: supplied ? { "X-Replica-Canvas-Token": supplied } : {},
          })
          assert.equal(denied.status, 403)
          assert.deepEqual(await denied.json(), {
            error: "Invalid canvas request token.",
          })
        }
      }
      assert.equal(commands, 0)
      const next = await fetch(new URL("/api/agent/next?view=extra", server.url), { headers })
      assert.deepEqual(await next.json(), {
        command: null,
        prototypeUrl: context.normalizedUrl,
      })
      assert.equal(commands, 1)
      const status = await fetch(new URL("/api/prototype/status?view=extra", server.url), {
        headers,
      })
      assert.deepEqual(await status.json(), { available: true })
      const loader = await (await fetch(new URL("/__replica/canvas/loader.js", previewUrl))).text()
      const runtimeSource = await (
        await fetch(
          new URL(
            `/__replica/canvas/runtime.js?parent=${encodeURIComponent(url.origin)}`,
            previewUrl,
          ),
        )
      ).text()
      for (const secret of [documentToken, token]) {
        assert.ok(!loader.includes(secret))
        assert.ok(!runtimeSource.includes(secret))
      }
      assert.match(loader, /installBridge/)
      assert.equal(
        (await fetch(new URL("/__replica/canvas/runtime.js?parent=http://127.0.0.1:1", previewUrl)))
          .status,
        403,
      )
      assert.equal((await fetch(new URL("/__replica/canvas/loader.js", server.url))).status, 403)
    } finally {
      await Promise.all([server?.close(), other?.close()])
      await rm(root, { recursive: true, force: true })
    }
  })

  it("protects sharing routes and never creates a link from an unconnected context read", async () => {
    const root = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(path.join(root, ".git"), { recursive: true })
    let server
    try {
      server = await startCanvasServer(
        {
          repositoryPath: root,
          normalizedUrl: "http://localhost:5173/",
          sessionWorkspacePath: root,
        },
        {
          send() {
            throw new Error("Sharing must not request publishing.")
          },
        },
        {
          hubOptions: { directory: path.join(root, "credentials") },
        },
      )
      const page = await (await fetch(server.url)).text()
      const token = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).token
      for (const action of ["context", "list", "create", "delete", "open", "controls-preference"]) {
        const url = new URL(`/api/hub/share-links/${action}`, server.url)
        assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 403)
        assert.equal(
          (await fetch(url, { headers: { "X-Replica-Canvas-Token": token } })).status,
          405,
        )
      }
    } finally {
      await server?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
  it("reuses a panel proxy until its upstream changes and closes only the associated proxy", async () => {
    const root = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(path.join(root, ".git"), { recursive: true })
    const context = {
      repositoryPath: path.join(root, "missing"),
      normalizedUrl: "http://localhost:5173/",
      sessionWorkspacePath: root,
    }
    let server
    let other
    try {
      server = await startCanvasServer(context, {})
      other = await startCanvasServer(context, {})
      assert.equal((await fetch(new URL("/assets/renderer.css", server.url))).status, 200)
      async function preview(canvas) {
        const html = await (await fetch(canvas.url)).text()
        return JSON.parse(html.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).previewUrl
      }
      const first = await preview(server)
      const second = await preview(other)
      assert.notEqual(first, second)
      await server.setContext({
        ...context,
        repositoryPath: root,
        name: "Renamed",
      })
      assert.equal(await preview(server), first)
      await server.setContext({
        ...context,
        normalizedUrl: "http://localhost:5173/another?view=1#form",
      })
      assert.equal(await preview(server), first)
      await assert.rejects(
        server.setContext({
          ...context,
          normalizedUrl: "http://user:pass@localhost:5173/",
        }),
        /unauthenticated loopback/,
      )
      await assert.rejects(server.setContext({ ...context, normalizedUrl: "invalid" }))
      assert.equal(await preview(server), first)
      await server.setContext({
        ...context,
        normalizedUrl: "http://localhost:5174/route?q=1#section",
      })
      const next = await preview(server)
      assert.notEqual(new URL(next).origin, new URL(first).origin)
      assert.equal(new URL(next).pathname, "/route")
      assert.equal(new URL(next).search, "?q=1")
      assert.equal(new URL(next).hash, "#section")
      await assert.rejects(fetch(new URL("/__replica/canvas/loader.js", first)))
      await server.close()
      server = undefined
      await assert.rejects(fetch(new URL("/__replica/canvas/loader.js", next)))
      assert.equal((await fetch(new URL("/__replica/canvas/loader.js", second))).status, 200)
    } finally {
      await Promise.all([server?.close(), other?.close()])
      await rm(root, { recursive: true, force: true })
    }
  })

  it("requires an explicit Hub URL when no development origin is configured", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    const originalOrigin = process.env.REPLICA_HUB_ORIGIN
    delete process.env.REPLICA_HUB_ORIGIN
    const originalPath = process.env.PATH
    let canvas
    let otherCanvas
    let futureCanvas
    const chat = []
    const openedUrls = []
    try {
      await writeFile(
        path.join(workspace, "git"),
        `#!/bin/sh
case "$1:$2" in
  remote:get-url) echo https://github.com/github/replica.git ;;
  branch:--show-current) echo prototype/first ;;
  rev-parse:HEAD) printf '%040d\\n' 1 ;;
esac
`,
        { mode: 0o755 },
      )
      await writeFile(
        path.join(workspace, "gh"),
        "#!/bin/sh\nprintf 'GitHub unavailable for this test\\n' >&2\nexit 1\n",
        { mode: 0o755 },
      )
      process.env.PATH = `${workspace}:${originalPath}`
      const config = "export default { plugins: [] }\n"
      const manifest = '{"private":true,"type":"module"}\n'
      await writeFile(path.join(workspace, "vite.config.ts"), config)
      await writeFile(path.join(workspace, "package.json"), manifest)
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        branch: "prototype/first",
        sessionWorkspacePath: workspace,
        repositoryPath: workspace,
      })
      canvas = await startCanvasServer(
        context,
        {
          send(message) {
            chat.push(message)
          },
        },
        {
          hubOptions: { directory: path.join(workspace, "credentials") },
          commentingDirectory: path.join(workspace, "commenting"),
          controlsDiagnosisDirectory: path.join(workspace, "controls-diagnosis"),
          openBrowser: async (url) => {
            openedUrls.push(url)
            return { ok: true }
          },
        },
      )
      const page = await (await fetch(canvas.url)).text()
      const token = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).token
      const headers = { "X-Replica-Canvas-Token": token }
      function open(url, authorized = true) {
        return fetch(new URL("/api/prototype/open", canvas.url), {
          method: "POST",
          headers: authorized ? headers : {},
          body: JSON.stringify({ url }),
        })
      }
      assert.equal((await open("http://localhost:3000/settings", false)).status, 403)
      assert.equal((await open("https://elsewhere.example/")).status, 422)
      assert.equal((await open("http://someone@localhost:3000/")).status, 422)
      assert.equal((await open("http://localhost:3000/settings")).status, 200)
      assert.deepEqual(openedUrls, ["http://localhost:3000/settings"])
      const setup = await fetch(new URL("/api/commenting/setup", canvas.url), {
        method: "POST",
        headers,
        body: "{}",
      })
      assert.equal(setup.status, 404, "the canvas cannot install or rewrite Vite configuration")
      assert.equal(
        await stat(path.join(workspace, ".replica")).catch((error) => error.code),
        "ENOENT",
      )
      assert.equal(await readFile(path.join(workspace, "vite.config.ts"), "utf8"), config)
      assert.equal(await readFile(path.join(workspace, "package.json"), "utf8"), manifest)
      assert.equal(chat.length, 0)
      const rejectedFix = await fetch(new URL("/api/commenting/fix", canvas.url), {
        method: "POST",
      })
      assert.equal(rejectedFix.status, 403)
      assert.equal(chat.length, 0)
      const fix = await fetch(new URL("/api/commenting/fix", canvas.url), {
        method: "POST",
        headers,
      })
      assert.equal(fix.status, 200)
      assert.equal(chat.length, 1)
      const diagnosisUrl = new URL("/api/controls/diagnose", canvas.url)
      const evidence = {
        status: "unsupported-runtime",
        runtimeAvailable: false,
        reconnectRequired: false,
        hasError: true,
        hasStorageError: false,
        previewUrl: "http://localhost:3000/settings?view=demo",
      }
      assert.equal(
        (
          await fetch(diagnosisUrl, {
            method: "POST",
            body: JSON.stringify(evidence),
          })
        ).status,
        403,
      )
      assert.equal((await fetch(diagnosisUrl, { method: "POST", headers, body: "{}" })).status, 400)
      for (const invalid of [
        { ...evidence, error: "Raw action exception with a control value." },
        { ...evidence, hasError: { nested: true } },
        { ...evidence, previewUrl: "https://foreign.example/" },
      ])
        assert.equal(
          (
            await fetch(diagnosisUrl, {
              method: "POST",
              headers,
              body: JSON.stringify(invalid),
            })
          ).status,
          400,
        )
      assert.equal(
        (
          await fetch(diagnosisUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...evidence,
              previewUrl: "x".repeat(20_000),
            }),
          })
        ).status,
        413,
      )
      assert.equal(chat.length, 1)
      const diagnosis = await fetch(diagnosisUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(evidence),
      })
      assert.equal(diagnosis.status, 200)
      assert.deepEqual(await diagnosis.json(), { requested: true })
      assert.equal(chat.length, 2)
      assert.match(chat[1].prompt, /Diagnose with Copilot/)
      const { previewUrl, ...reported } = evidence
      assert.ok(chat[1].prompt.includes(JSON.stringify(reported)))
      assert.ok(chat[1].prompt.includes(JSON.stringify(previewUrl)))
      assert.equal(await readFile(path.join(workspace, "vite.config.ts"), "utf8"), config)
      assert.equal(await readFile(path.join(workspace, "package.json"), "utf8"), manifest)
      const status = await fetch(new URL("/api/hub/status", canvas.url), {
        headers,
      })
      const unconfigured = await status.json()
      assert.equal(unconfigured.state, "unconfigured")
      assert.equal(unconfigured.repository, "github/replica")
      assert.equal(unconfigured.message, "Enter a Hub URL to connect.")
      assert.equal(unconfigured.discovery.state, "unreachable")
      await writeFile(path.join(workspace, ".prototype"), JSON.stringify({ startPage: "/local" }))
      const localStatus = await fetch(new URL("/api/hub/open", canvas.url), {
        method: "POST",
        headers,
      })
      assert.equal((await localStatus.json()).localStartPage, "/local")
      const pairing = await fetch(new URL("/api/hub/pair", canvas.url), {
        method: "POST",
        headers,
      })
      assert.equal(pairing.status, 409)
      const selection = await fetch(new URL("/api/hub/origin", canvas.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ origin: "https://team.example.com" }),
      })
      assert.equal(selection.status, 200)
      const selected = await fetch(new URL("/api/hub/status", canvas.url), {
        headers,
      })
      assert.equal((await selected.json()).hubOrigin, "https://team.example.com")
      otherCanvas = await startCanvasServer(
        context,
        { send() {} },
        { hubOptions: { directory: path.join(workspace, "credentials") } },
      )
      const otherPage = await (await fetch(otherCanvas.url)).text()
      const otherToken = JSON.parse(
        otherPage.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1],
      ).token
      const otherHeaders = { "X-Replica-Canvas-Token": otherToken }
      const otherSelection = await fetch(new URL("/api/hub/origin", otherCanvas.url), {
        method: "POST",
        headers: otherHeaders,
        body: JSON.stringify({ origin: "https://another.example.com" }),
      })
      assert.equal(otherSelection.status, 200)
      canvas.setContext({ ...context, name: "Reopened prototype" })
      assert.equal(
        (await (await fetch(new URL("/api/hub/status", canvas.url), { headers })).json()).hubOrigin,
        "https://team.example.com",
      )
      futureCanvas = await startCanvasServer(
        context,
        { send() {} },
        { hubOptions: { directory: path.join(workspace, "credentials") } },
      )
      const futurePage = await (await fetch(futureCanvas.url)).text()
      const futureToken = JSON.parse(
        futurePage.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1],
      ).token
      const futureStatus = await fetch(new URL("/api/hub/status", futureCanvas.url), {
        headers: { "X-Replica-Canvas-Token": futureToken },
      })
      assert.equal((await futureStatus.json()).hubOrigin, "https://another.example.com")
    } finally {
      if (canvas) await canvas.close()
      if (otherCanvas) await otherCanvas.close()
      if (futureCanvas) await futureCanvas.close()
      process.env.PATH = originalPath
      if (originalOrigin === undefined) delete process.env.REPLICA_HUB_ORIGIN
      else process.env.REPLICA_HUB_ORIGIN = originalOrigin
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it("warns about a mismatched CLI account without blocking login-only local comments", async () => {
    await withContext(async (context) => {
      const workspace = context.sessionWorkspacePath
      execFileSync("git", ["remote", "add", "origin", "https://github.com/github/replica.git"], {
        cwd: context.repositoryPath,
      })
      const bin = path.join(workspace, "bin")
      await mkdir(bin)
      await writeFile(
        path.join(bin, "gh"),
        `#!/bin/sh
if [ "$*" = "api --hostname github.com user" ]; then
  printf '%s\\n' '{"login":"another-reviewer","name":"Another Reviewer","avatar_url":"https://avatars.githubusercontent.com/u/1002"}'
  exit 0
fi
exit 1
`,
        { mode: 0o755 },
      )
      const hubWrites = []
      const hub = createServer((request, response) => {
        request.resume()
        response.setHeader("X-Replica-Canvas-Version", "1")
        response.setHeader("Content-Type", "application/json")
        if (request.method !== "GET") hubWrites.push(request.url)
        if (request.url === "/api/canvas/pairings") {
          response.end(
            JSON.stringify({
              deviceCode: "device",
              userCode: "ABCD",
              verificationUrl: `http://${request.headers.host}/canvas/pair/ABCD`,
            }),
          )
        } else if (request.url === "/api/canvas/pairings/token") {
          response.end(
            JSON.stringify({
              status: "approved",
              repository: "github/replica",
              accessToken: "rp_test",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
          )
        } else if (request.url === "/api/canvas/connection") {
          response.end(JSON.stringify({ repository: "github/replica", viewerLogin: "octocat" }))
        } else {
          response.writeHead(404)
          response.end(JSON.stringify({ error: "Hub has not discovered this branch." }))
        }
      })
      await new Promise((resolve) => hub.listen(0, "127.0.0.1", resolve))
      const originalPath = process.env.PATH
      let canvas
      try {
        process.env.PATH = `${bin}:${originalPath}`
        canvas = await startCanvasServer(
          context,
          { send() {} },
          {
            localCommentsDirectory: path.join(workspace, "local-comments"),
            hubOptions: {
              origin: `http://127.0.0.1:${hub.address().port}`,
              directory: path.join(workspace, "credentials"),
            },
          },
        )
        const page = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        async function send(route, method = "GET", body) {
          const response = await fetch(new URL(route, canvas.url), {
            method,
            headers: { "X-Replica-Canvas-Token": token },
            ...(body ? { body: JSON.stringify(body) } : {}),
          })
          return { status: response.status, body: await response.json() }
        }
        await send("/api/hub/pair", "POST", {})
        assert.equal((await send("/api/hub/poll", "POST", {})).body.status, "approved")
        const status = await send("/api/hub/status")
        assert.equal(status.status, 200)
        assert.equal(status.body.repository, "github/replica")
        assert.equal(status.body.repositoryAuthorized, true)
        assert.match(status.body.localCommentsError, /profile.*different reviewer/i)
        assert.ok(status.body.reviewRevision.id > 0)
        const beforeSave = hubWrites.length
        const posted = await send("/api/hub/comments", "POST", {
          review_revision: status.body.reviewRevision,
          review_comment: {
            body: "Keep reviewing without a profile photo",
            anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
          },
        })
        assert.equal(posted.status, 201, JSON.stringify(posted.body))
        assert.deepEqual(posted.body.comments[0].author, {
          login: "octocat",
          name: null,
          avatarUrl: null,
        })
        const comments = (await send("/api/hub/comments")).body.comments
        assert.equal(comments.length, 1)
        assert.equal(comments[0].body, "Keep reviewing without a profile photo")
        assert.equal(comments[0].draftRevisionId, status.body.reviewRevision.id)
        assert.deepEqual(comments[0].author, {
          login: "octocat",
          name: null,
          avatarUrl: null,
        })
        assert.equal(hubWrites.length, beforeSave)
      } finally {
        if (canvas) await canvas.close()
        process.env.PATH = originalPath
        await new Promise((resolve, reject) =>
          hub.close((error) => (error ? reject(error) : resolve())),
        )
      }
    })
  })

  it("proxies only protected review actions for the current checkout", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    const originalPath = process.env.PATH
    const originalOrigin = process.env.REPLICA_HUB_ORIGIN
    const calls = []
    const publishPrompts = []
    const prototypes = new Map()
    let currentPrototypeId = 4
    let currentBuildNumber = 2
    let currentBuildCommit = "1".padStart(40, "0")
    let accessToken = "rp_secret"
    let canRegister = true
    let registrationError = false
    let registrationPending
    let releaseRegistration
    const browserUrls = []
    let sharingPublished = false
    const sharedLinks = []
    let browserUnavailable = false
    let startPageSet = false
    const hub = createServer(async (request, response) => {
      response.setHeader("X-Replica-Canvas-Version", "1")
      let body = ""
      for await (const chunk of request) body += chunk.toString()
      calls.push({
        path: request.url,
        method: request.method,
        auth: request.headers.authorization,
        activity: request.headers["x-replica-canvas-activity"],
        body,
      })
      let result
      if (request.url?.startsWith("/api/canvas/prototype?")) {
        const branch = new URL(request.url, "http://localhost").searchParams.get("branch")
        if (branch === "prototype/second") {
          response.writeHead(404, { "Content-Type": "application/json" })
          response.end(
            JSON.stringify({
              error: "Hub has not discovered this branch.",
              registrationReason: "remote_branch_missing",
            }),
          )
          return
        }
        result = {
          id: currentPrototypeId,
          repositoryId: 5,
          repository: "github/replica",
          viewerLogin: "octocat",
          branch,
          registered: prototypes.has(branch),
          canEdit: true,
          canRegister,
          canManageShareLinks: true,
          published: sharingPublished,
          build: sharingPublished
            ? {
                number: currentBuildNumber,
                commitSha: currentBuildCommit,
                publishedAt: "2099-01-01T00:00:00Z",
              }
            : null,
          name: prototypes.get(branch)?.name ?? null,
          description: null,
          startPage: null,
          startPageSet,
        }
      } else if (request.url === "/api/canvas/prototype" && request.method === "PATCH") {
        if (registrationError) {
          response.writeHead(403, { "Content-Type": "application/json" })
          response.end(JSON.stringify({ error: "Registration permission denied." }))
          return
        }
        if (registrationPending) {
          registrationPending()
          await new Promise((resolve) => (releaseRegistration = resolve))
        }
        const { branch, name } = JSON.parse(body)
        prototypes.set(branch, { name })
        result = { name, registered: true }
      } else if (request.url === "/api/canvas/pairings") {
        result = {
          deviceCode: "device",
          userCode: "ABCD",
          verificationUrl: `http://${request.headers.host}/canvas/pair/ABCD`,
        }
      } else if (request.url === "/api/canvas/pairings/token" && request.method === "POST") {
        result = {
          status: "approved",
          repository: "github/replica",
          accessToken,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }
      } else if (request.url === "/api/canvas/connection") {
        result = {
          repository: "github/replica",
          repositoryId: 5,
          viewerLogin: "octocat",
        }
      } else if (request.url === "/api/canvas/repositories/5/prototypes/4/share_links") {
        if (request.method === "POST") {
          const { share_link: input } = JSON.parse(body)
          result = {
            id: 1,
            url: `${process.env.REPLICA_HUB_ORIGIN}/share/12345678-1234-1234-1234-123456789abc`,
            buildNumber: input.build_number,
            label: input.label,
            expiresAt: null,
          }
          sharedLinks.push({
            ...result,
            createdAt: "2026-10-05T07:00:00Z",
            createdBy: { login: "octocat", name: null },
          })
        } else {
          result = {
            shareLinks: sharedLinks,
            hasMore: false,
            nextCursor: null,
          }
        }
      } else if (
        request.url === "/api/canvas/repositories/5/prototypes/4/share_links/1" &&
        request.method === "DELETE"
      ) {
        sharedLinks.length = 0
        response.writeHead(204)
        response.end()
        return
      } else if (request.url === "/api/canvas/repositories/5/prototypes/4/mention_candidates") {
        result = {
          candidates: [{ githubId: 1002, login: "mona", avatarUrl: null }],
        }
      } else if (request.url?.includes("/review_comment_summaries")) {
        result = { comments: [], hasMore: false, nextCursor: null }
      } else if (request.url?.includes("/review_comments/7/thread")) {
        result = {
          root: {
            id: 7,
            kind: "root",
            body: "Review the button",
            author: { login: "octocat", name: null, avatarUrl: null },
            createdAt: "2026-10-01T00:00:00Z",
            updatedAt: "2026-10-01T00:00:00Z",
            editedAt: null,
            deletedAt: null,
            buildNumber: 2,
            anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
            resolvedAt: null,
            resolvedBy: null,
            activityVersion: 1,
            viewerLastSeenActivityVersion: null,
            prototype: { id: 4, name: null, branch: "prototype/first" },
          },
          replies: [],
          replyCount: 0,
          hasMore: false,
          nextCursor: null,
        }
      } else if (request.url?.includes("/review_comments")) {
        const attributes = body ? JSON.parse(body).review_comment : null
        result = {
          comments:
            request.method === "POST" && request.url.endsWith("/review_comments")
              ? [
                  {
                    id: 9,
                    kind: "root",
                    body: attributes.body,
                    anchor: attributes.anchor,
                    author: { login: "octocat" },
                    buildNumber: attributes.build_number,
                  },
                ]
              : [],
          hasMore: false,
          nextCursor: null,
        }
      } else {
        result = { name: "Updated" }
      }
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify(result))
    })
    await new Promise((resolve) => hub.listen(0, "127.0.0.1", resolve))
    let canvas
    try {
      await writeFile(
        path.join(workspace, "git"),
        `#!/bin/sh
while [ "$1" = "-c" ]; do shift 2; done
case "$1:$2" in
  remote:get-url) echo https://github.com/\${TEST_REPOSITORY:-github/replica}.git ;;
  branch:--show-current) echo "\${TEST_BRANCH:-prototype/first}" ;;
  rev-parse:HEAD) printf '%040d\\n' "\${TEST_HEAD:-1}" ;;
  rev-parse:HEAD^{tree}) printf '%040d\\n' "\${TEST_HEAD_TREE:-2}" ;;
  rev-parse:*^{tree}) printf '%040d\\n' "\${TEST_HEAD_TREE:-2}" ;;
  write-tree:) printf '%040d\\n' "\${TEST_TREE:-2}" ;;
  config:*) exit 1 ;;
esac
`,
        { mode: 0o755 },
      )
      await writeFile(
        path.join(workspace, "gh"),
        `#!/bin/sh
if [ "$*" = "api --hostname github.com user" ]; then
  printf '%s\\n' '{"login":"octocat","name":"The Octocat","avatar_url":"https://avatars.githubusercontent.com/u/583231"}'
  exit 0
fi
exit 1
`,
        { mode: 0o755 },
      )
      process.env.PATH = `${workspace}:${originalPath}`
      process.env.REPLICA_HUB_ORIGIN = `http://127.0.0.1:${hub.address().port}`
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        name: "Review rules",
        repository: "github/replica",
        branch: "prototype/first",
        sessionWorkspacePath: workspace,
        repositoryPath: workspace,
      })
      function startCanvas() {
        return startCanvasServer(
          context,
          {
            send(message) {
              publishPrompts.push({
                prompt: message.prompt,
                registrations: calls.filter(
                  ({ path, method }) => path === "/api/canvas/prototype" && method === "PATCH",
                ).length,
              })
              return "message"
            },
          },
          {
            localCommentsDirectory: path.join(workspace, "local-comments"),
            hubOptions: { directory: path.join(workspace, "credentials") },
            openBrowser: async (url) => {
              browserUrls.push(url)
              return browserUnavailable
                ? { ok: false, error: "No browser available." }
                : { ok: true }
            },
          },
        )
      }
      canvas = await startCanvas()
      const page = await (await fetch(canvas.url)).text()
      let token = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).token
      assert.equal((await fetch(new URL("/api/hub/status", canvas.url))).status, 403)
      async function send(route, method = "GET", body) {
        const response = await fetch(new URL(route, canvas.url), {
          method,
          headers: { "X-Replica-Canvas-Token": token },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return { status: response.status, body: await response.json() }
      }
      const [beforePairing, simultaneousStatus] = await Promise.all([
        send("/api/hub/status"),
        send("/api/hub/status"),
      ])
      assert.equal(beforePairing.body.state, "disconnected")
      assert.equal(simultaneousStatus.body.state, "disconnected")
      assert.deepEqual(browserUrls, [])
      assert.equal(
        (
          await fetch(new URL("/api/hub/connect", canvas.url), {
            method: "POST",
          })
        ).status,
        403,
      )
      assert.deepEqual(browserUrls, [])
      const pairing = await send("/api/hub/pair", "POST", {})
      assert.equal(pairing.body.userCode, "ABCD")
      assert.deepEqual(browserUrls, [])
      const connected = await send("/api/hub/connect", "POST", {})
      assert.equal(connected.body.userCode, "ABCD")
      assert.deepEqual(browserUrls, [pairing.body.verificationUrl])
      browserUnavailable = true
      const retry = await send("/api/hub/connect", "POST", {})
      assert.equal(retry.status, 201)
      assert.equal(retry.body.browserError, "No browser available.")
      assert.equal(retry.body.verificationUrl, pairing.body.verificationUrl)
      assert.equal(calls.filter(({ path }) => path === "/api/canvas/pairings").length, 1)
      assert.equal((await send("/api/hub/poll", "POST", {})).body.status, "approved")
      assert.ok(!calls.some(({ path }) => path.includes("device")))
      const beforeComments = calls.length
      const agentPage = await canvas.reviewAction("list_comments", {
        read: "unread",
      })
      assert.equal(agentPage.scanComplete, true)
      assert.deepEqual(agentPage.threads, [])
      assert.equal(agentPage.target.viewerLogin, "octocat")
      const commentReads = calls.slice(beforeComments)
      assert.equal(commentReads.length, 3)
      assert.ok(commentReads.every(({ method }) => method === "GET"))
      assert.ok(commentReads.every(({ activity }) => activity === undefined))
      assert.ok(commentReads.some(({ path }) => path.endsWith("/review_comments")))
      assert.ok(!JSON.stringify(agentPage).includes("rp_secret"))
      const beforeRepositoryComments = calls.length
      const repositoryPage = await canvas.reviewAction("list_repository_comments", {})
      assert.equal(repositoryPage.scanComplete, true)
      assert.equal(repositoryPage.target.scope, "repository")
      assert.deepEqual(repositoryPage.threads, [])
      const repositoryReads = calls.slice(beforeRepositoryComments)
      assert.equal(repositoryReads.length, 3)
      assert.ok(
        repositoryReads.every(({ method, activity }) => method === "GET" && activity === undefined),
      )
      assert.ok(
        repositoryReads.some(({ path }) => path === "/api/canvas/repositories/5/review_comments"),
      )
      assert.ok(!JSON.stringify(repositoryPage).includes("rp_secret"))
      const beforeCompactReads = calls.length
      const compactPage = await canvas.reviewAction("list_repository_comment_summaries", {})
      assert.equal(compactPage.target.scope, "repository")
      assert.deepEqual(compactPage.comments, [])
      assert.equal(compactPage.hasMore, false)
      assert.equal(calls.length, beforeCompactReads + 2)
      assert.ok(calls.at(-1).path.includes("/review_comment_summaries?pageSize=200"))
      const threadPage = await canvas.reviewAction("get_repository_thread", {
        target: compactPage.target,
        prototypeId: 4,
        threadId: 7,
      })
      assert.equal(threadPage.thread.id, 7)
      assert.equal(threadPage.thread.replyCount, 0)
      assert.deepEqual(threadPage.thread.replies, [])
      assert.equal(calls.length, beforeCompactReads + 4)
      assert.ok(calls.at(-1).path.endsWith("/review_comments/7/thread?pageSize=200"))
      assert.ok(
        calls
          .slice(beforeCompactReads)
          .every(({ method, activity }) => method === "GET" && activity === undefined),
      )
      assert.ok(!JSON.stringify([compactPage, threadPage]).includes("rp_secret"))
      sharingPublished = true
      const contextCalls = calls.length
      const sharingContext = (await send("/api/hub/share-links/context", "POST", {})).body
      assert.equal(calls.length, contextCalls + 1)
      assert.equal(calls.at(-1).method, "GET")
      assert.equal(calls.at(-1).activity, undefined)
      assert.equal(publishPrompts.length, 0)
      const sharingTarget = { target: sharingContext.target }
      const createdShare = await send("/api/hub/share-links/create", "POST", {
        ...sharingTarget,
        buildNumber: 2,
        label: "Review",
        expiration: "never",
      })
      assert.equal(createdShare.status, 201)
      assert.equal(calls.at(-1).activity, "interactive")
      assert.deepEqual(JSON.parse(calls.at(-1).body), {
        share_link: { build_number: 2, label: "Review", expiration: "never" },
      })
      const activeShares = await send("/api/hub/share-links/list", "POST", sharingTarget)
      assert.equal(activeShares.body.shareLinks.length, 1)
      browserUnavailable = false
      assert.equal(
        (
          await send("/api/hub/share-links/open", "POST", {
            ...sharingTarget,
            id: 1,
          })
        ).status,
        200,
      )
      assert.equal(browserUrls.at(-1), createdShare.body.url)
      assert.equal(
        (
          await send("/api/hub/share-links/delete", "POST", {
            ...sharingTarget,
            id: 1,
          })
        ).body.deleted,
        true,
      )
      assert.equal(
        (await send("/api/hub/share-links/list", "POST", sharingTarget)).body.shareLinks.length,
        0,
      )
      assert.ok(!JSON.stringify(sharingContext).includes("rp_secret"))
      assert.equal(publishPrompts.length, 0)
      sharingPublished = false
      const status = (await send("/api/hub/status")).body
      assert.equal(status.prototype.id, 4)
      await writeFile(path.join(workspace, ".prototype"), "{invalid")
      assert.match((await send("/api/hub/status")).body.localStartPageError, /Could not read/)
      startPageSet = true
      const ownedStatus = (await send("/api/hub/status")).body
      assert.equal(ownedStatus.prototype.startPageSet, true)
      assert.equal(ownedStatus.localStartPage, undefined)
      assert.equal(ownedStatus.localStartPageError, undefined)
      assert.equal(status.prototype.registered, false)
      assert.ok(!JSON.stringify(status).includes("rp_secret"))
      assert.equal((await canvas.getHubStatus()).prototype.id, 4)
      assert.equal((await send("/api/publish", "POST", {})).status, 202)
      assert.equal(prototypes.get("prototype/first")?.name, "Review rules")
      assert.equal(
        Object.hasOwn(
          JSON.parse(calls.findLast(({ method }) => method === "PATCH").body),
          "start_page",
        ),
        false,
      )
      assert.equal(publishPrompts.length, 1)
      assert.equal(publishData(publishPrompts[0].prompt).mode, "committed-only")
      assert.equal(publishData(publishPrompts[0].prompt).branch, "prototype/first")
      assert.equal(publishData(publishPrompts[0].prompt).repository, "github/replica")
      canRegister = false
      process.env.TEST_BRANCH = "prototype/third"
      assert.equal((await send("/api/publish", "POST", {})).status, 403)
      assert.equal(publishPrompts.length, 1)
      assert.equal((await send("/api/state")).body.publishRequest.state, "idle")
      canRegister = true
      registrationError = true
      const denied = await send("/api/publish", "POST", {})
      assert.equal(denied.status, 403)
      assert.equal(denied.body.error, "Registration permission denied.")
      assert.equal(publishPrompts.length, 1)
      assert.equal((await send("/api/state")).body.publishRequest.state, "idle")
      registrationError = false
      const registrationStarted = new Promise((resolve) => (registrationPending = resolve))
      const driftingPublish = send("/api/publish", "POST", {})
      await registrationStarted
      process.env.TEST_HEAD = "2"
      releaseRegistration()
      const changed = await driftingPublish
      assert.equal(changed.status, 409)
      assert.match(changed.body.error, /checkout changed while preparing to publish/)
      assert.equal(publishPrompts.length, 1)
      assert.equal((await send("/api/state")).body.publishRequest.state, "idle")
      registrationPending = undefined
      prototypes.delete("prototype/third")
      delete process.env.TEST_HEAD
      process.env.TEST_BRANCH = "prototype/first"
      const registrationAttempts = calls.filter(
        ({ path, method }) => path === "/api/canvas/prototype" && method === "PATCH",
      ).length
      assert.equal((await send("/api/publish", "POST", {})).status, 202)
      assert.equal(prototypes.get("prototype/first")?.name, "Review rules")
      assert.equal(publishPrompts.at(-1).registrations, 1)
      assert.equal(registrationAttempts, 3)
      assert.equal((await send("/api/hub/status")).body.prototype.registered, true)
      assert.deepEqual((await send("/api/hub/comments")).body.comments, [])
      const suggestions = await send("/api/hub/mention-candidates?repositoryId=5&prototypeId=4")
      assert.equal(suggestions.status, 200)
      assert.deepEqual(suggestions.body.candidates, [
        { githubId: 1002, login: "mona", avatarUrl: null },
      ])
      assert.equal(calls.at(-1).auth, "Bearer rp_secret")
      assert.ok(!JSON.stringify(suggestions.body).includes("rp_secret"))
      assert.equal(
        (await send("/api/hub/mention-candidates?repositoryId=5&prototypeId=99")).status,
        409,
      )
      const previousRevision = (await send("/api/hub/status")).body.reviewRevision
      const beforeChangedRevision = calls.filter(
        ({ path, method }) => path.endsWith("/review_comments") && method === "POST",
      ).length
      process.env.TEST_TREE = "3"
      const posted = await send("/api/hub/comments", "POST", {
        review_revision: previousRevision,
        review_comment: {
          body: "New thread",
          anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
        },
      })
      assert.equal(posted.status, 201)
      const localRoots = (await send("/api/hub/comments")).body.comments
      assert.equal(localRoots.length, 1)
      assert.equal(localRoots[0].body, "New thread")
      assert.equal(localRoots[0].draftRevisionId, previousRevision.id)
      assert.equal(localRoots[0].buildNumber, null)
      await canvas.close()
      canvas = await startCanvas()
      const reloadedPage = await (await fetch(canvas.url)).text()
      token = JSON.parse(reloadedPage.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).token
      assert.deepEqual((await send("/api/hub/comments")).body.comments, localRoots)
      assert.equal(
        calls.filter(({ path, method }) => path.endsWith("/review_comments") && method === "POST")
          .length,
        beforeChangedRevision,
      )
      delete process.env.TEST_TREE
      sharingPublished = true
      const selectedBuild = (await send("/api/hub/status")).body.reviewRevision
      assert.equal(selectedBuild.id, null)
      assert.equal(selectedBuild.buildNumber, 2)
      assert.equal((await send("/api/hub/comments")).body.comments.length, 0)
      process.env.TEST_TREE = "3"
      process.env.TEST_HEAD = "2"
      process.env.TEST_HEAD_TREE = "3"
      currentBuildNumber = 3
      currentBuildCommit = "2".padStart(40, "0")
      assert.equal(
        (
          await send("/api/hub/comments", "POST", {
            review_revision: selectedBuild,
            review_comment: {
              body: "Keep the selected Build",
              anchor: { schemaVersion: 1 },
            },
          })
        ).status,
        201,
      )
      assert.equal(JSON.parse(calls.at(-1).body).review_comment.build_number, 2)
      sharingPublished = false
      currentBuildNumber = 2
      currentBuildCommit = "1".padStart(40, "0")
      delete process.env.TEST_HEAD
      delete process.env.TEST_HEAD_TREE
      delete process.env.TEST_TREE
      assert.equal(
        (
          await send("/api/hub/comments", "POST", {
            review_revision: {
              ...previousRevision,
              hubOrigin: "https://another-hub.example.com",
            },
            review_comment: { body: "Wrong Hub", anchor: { schemaVersion: 1 } },
          })
        ).status,
        409,
      )
      currentPrototypeId = 9
      assert.equal(
        (
          await send("/api/hub/comments", "POST", {
            review_revision: previousRevision,
            review_comment: {
              body: "Stale Hub target",
              anchor: { schemaVersion: 1 },
            },
          })
        ).status,
        409,
      )
      currentPrototypeId = 4
      assert.equal(
        calls.filter(({ path, method }) => path.endsWith("/review_comments") && method === "POST")
          .length,
        beforeChangedRevision + 2,
      )
      assert.equal(
        (
          await send("/api/hub/comments/9/replies", "POST", {
            review_comment: { body: "Reply" },
          })
        ).status,
        200,
      )
      assert.ok(
        calls.some(
          ({ path, method, activity }) =>
            path.endsWith("/review_comments") && method === "POST" && activity === "interactive",
        ),
      )
      assert.ok(
        calls
          .filter((call) => call.method === "GET")
          .every(({ activity }) => activity === undefined),
      )
      assert.equal((await send("/api/hub/comments/9/resolution", "POST")).status, 200)
      assert.equal(
        (
          await send("/api/hub/comments/9/read", "POST", {
            review_thread_read: { activity_version: 1 },
          })
        ).status,
        200,
      )
      assert.equal(calls.at(-1).activity, undefined)
      assert.equal((await send("/api/hub/comments/9/read", "DELETE")).status, 200)
      assert.ok(calls.at(-1).path.endsWith("/review_comments/9/read"))
      assert.equal(calls.at(-1).method, "DELETE")
      assert.equal(calls.at(-1).body, "")
      assert.equal(calls.at(-1).activity, "interactive")
      assert.equal(
        (
          await send("/api/hub/comments/9/reactions/%2B1", "DELETE", {
            review_comment_reaction: { activity_version: 1 },
          })
        ).status,
        200,
      )
      assert.equal(
        (
          await send("/api/hub/metadata", "PATCH", {
            name: "Updated",
            description: "",
            startPage: "http://localhost:3000/settings?q=a%20b#details",
          })
        ).body.name,
        "Updated",
      )
      const metadata = JSON.parse(calls.findLast(({ method }) => method === "PATCH").body)
      assert.equal(metadata.start_page, "/settings?q=a%20b#details")
      assert.equal(metadata.branch, "prototype/first")
      for (const startPage of ["", "/welcome", "https://preview.example.com/settings"]) {
        assert.equal((await send("/api/hub/metadata", "PATCH", { startPage })).status, 200)
        assert.equal(
          JSON.parse(calls.findLast(({ method }) => method === "PATCH").body).start_page,
          startPage,
        )
      }
      for (const path of ["/...", "/settings%2Ejson", "/settings?next=/../page#/./intro"]) {
        assert.equal(
          (
            await send("/api/hub/metadata", "PATCH", {
              startPage: `http://localhost:3000${path}`,
            })
          ).status,
          200,
        )
        assert.equal(
          JSON.parse(calls.findLast(({ method }) => method === "PATCH").body).start_page,
          path,
        )
      }
      const beforeInvalid = calls.length
      for (const startPage of [
        "http://user:secret@localhost:3000/settings",
        "http://localhost:3000/set\ttings",
        "http://localhost:3000/\\settings",
        "http://[invalid",
        "http://localhost:3000/a/../settings",
        "http://localhost:3000/a/./settings",
        "http://localhost:3000/a/%2e%2E/settings",
        "http://localhost:3000/a/.%2e/settings",
        "http://localhost:3000/a/%2e./settings",
        "http://localhost:3000/a/%2e/settings",
        "http://localhost:3000/a/..",
      ]) {
        assert.equal((await send("/api/hub/metadata", "PATCH", { startPage })).status, 422)
      }
      assert.equal(calls.length, beforeInvalid)
      assert.equal(
        (
          await canvas.updateMetadata({
            name: "Agent updated",
            description: "Published by Copilot",
            startPage: "http://localhost:3000/#/agent-start",
          })
        ).name,
        "Agent updated",
      )
      assert.equal(
        JSON.parse(calls.findLast(({ method }) => method === "PATCH").body).start_page,
        "/#/agent-start",
      )
      assert.ok(
        calls.some(
          ({ path, method, auth }) =>
            path.endsWith("/9/replies") && method === "POST" && auth === "Bearer rp_secret",
        ),
      )

      const original = (await send("/api/state")).body
      const previousRegistrations = calls.filter(
        ({ path, method }) => path === "/api/canvas/prototype" && method === "PATCH",
      ).length
      const previousPrompts = publishPrompts.length
      assert.equal((await send("/api/publish", "POST", {})).status, 202)
      assert.equal(publishPrompts.length, previousPrompts)
      assert.equal(
        calls.filter(({ path, method }) => path === "/api/canvas/prototype" && method === "PATCH")
          .length,
        previousRegistrations,
      )
      process.env.TEST_BRANCH = "prototype/second"
      const switched = (await send("/api/state")).body
      assert.notEqual(switched.stateId, original.stateId)
      assert.equal(switched.publishStatus.state, "unavailable")
      const unpublishedRepositoryPage = await canvas.reviewAction("list_repository_comments", {})
      assert.equal(unpublishedRepositoryPage.scanComplete, true)
      assert.equal(unpublishedRepositoryPage.target.branch, "prototype/second")
      const draftOnly = (await send("/api/hub/status")).body
      assert.equal(draftOnly.state, "undiscovered")
      assert.equal(draftOnly.prototype, undefined)
      const beforeUnpublishedSave = calls.length
      assert.equal(
        (
          await send("/api/hub/comments", "POST", {
            review_revision: draftOnly.reviewRevision,
            review_comment: {
              body: "Review before Hub discovers the branch",
              anchor: { schemaVersion: 1, kind: "element", selector: "#save" },
            },
          })
        ).status,
        201,
      )
      const localComment = (await send("/api/hub/comments")).body.comments[0]
      assert.equal(localComment.buildNumber, null)
      assert.deepEqual(localComment.author, {
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/583231",
      })
      assert.ok(
        calls.slice(beforeUnpublishedSave).every(({ method }) => method === "GET"),
        "Saving unpublished feedback must not create any Hub records.",
      )
      assert.equal((await send("/api/publish", "POST", {})).status, 202)
      assert.equal(publishData(publishPrompts.at(-1).prompt).branch, "prototype/second")
      assert.equal(publishPrompts.at(-1).registrations, previousRegistrations)
      process.env.TEST_BRANCH = "prototype/third"
      assert.equal((await send("/api/publish", "POST", {})).status, 202)
      assert.equal(prototypes.get("prototype/third")?.name, "third")
      assert.equal(publishPrompts.at(-1).registrations, previousRegistrations + 1)
      assert.equal(publishData(publishPrompts.at(-1).prompt).branch, "prototype/third")
      process.env.TEST_BRANCH = "prototype/first"
      assert.equal((await send("/api/state")).body.publishRequest.state, "requested")

      const payload = Buffer.from(JSON.stringify({ name: "Café", description: "" }))
      const split = payload.indexOf(0xc3) + 1
      const echoed = await new Promise((resolve, reject) => {
        const local = httpRequest(
          new URL("/api/hub/metadata", canvas.url),
          {
            method: "PATCH",
            headers: { "X-Replica-Canvas-Token": token },
          },
          (response) => {
            let body = ""
            response.on("data", (chunk) => {
              body += chunk
            })
            response.on("end", () => resolve(JSON.parse(body)))
          },
        )
        local.on("error", reject)
        local.write(payload.subarray(0, split))
        setTimeout(() => local.end(payload.subarray(split)), 10)
      })
      assert.equal(echoed.name, "Café")
      assert.ok(
        calls.some(
          ({ path, body }) => path === "/api/canvas/prototype" && JSON.parse(body).name === "Café",
        ),
      )
      assert.ok(
        calls.some(
          ({ path, body }) =>
            path === "/api/canvas/prototype" && JSON.parse(body).name === "Agent updated",
        ),
      )

      const originalHub = process.env.REPLICA_HUB_ORIGIN
      const otherHub = `http://localhost:${hub.address().port}`
      assert.equal((await send("/api/hub/origin", "POST", { origin: otherHub })).status, 200)
      await send("/api/hub/pair", "POST", {})
      await send("/api/hub/poll", "POST", {})
      const otherHubStatus = (await send("/api/hub/status")).body
      assert.equal(otherHubStatus.state, "connected")
      const selectedConnection = otherHubStatus.reviewRevision
      await send("/api/hub/disconnect", "POST", {})
      accessToken = "rp_reconnected"
      await send("/api/hub/pair", "POST", {})
      await send("/api/hub/poll", "POST", {})
      const reconnectedStatus = (await send("/api/hub/status")).body
      assert.equal(reconnectedStatus.state, "connected")
      assert.notEqual(
        reconnectedStatus.reviewRevision.connectionId,
        selectedConnection.connectionId,
      )
      const beforeReconnectedSave = calls.filter(
        ({ path, method }) => path.endsWith("/review_comments") && method === "POST",
      ).length
      const reconnectedSave = await send("/api/hub/comments", "POST", {
        review_revision: selectedConnection,
        review_comment: {
          body: "Old connection",
          anchor: { schemaVersion: 1 },
        },
      })
      assert.equal(reconnectedSave.status, 409, JSON.stringify(reconnectedSave.body))
      assert.equal(
        calls.filter(({ path, method }) => path.endsWith("/review_comments") && method === "POST")
          .length,
        beforeReconnectedSave,
      )
      assert.equal((await send("/api/hub/origin", "POST", { origin: originalHub })).status, 200)
      await send("/api/hub/status")
      const invalid = await send("/api/hub/origin", "POST", {
        origin: "http://hub.example.com",
      })
      assert.equal(invalid.status, 422)
      assert.match(invalid.body.error, /require HTTPS/)
      assert.equal((await send("/api/hub/status")).body.hubOrigin, originalHub)

      const selectedHub = "https://hub.example.com"
      const saved = await send("/api/hub/origin", "POST", {
        origin: `${selectedHub}/repositories/123?tab=builds#latest`,
      })
      assert.equal(saved.status, 200)
      assert.deepEqual(saved.body, { hubOrigin: selectedHub })
      const credentialDirectory = path.join(workspace, "credentials")
      const selection = (await readdir(credentialDirectory)).find((name) =>
        name.endsWith(".origin.json"),
      )
      assert.ok(selection)
      assert.equal((await stat(path.join(credentialDirectory, selection))).mode & 0o077, 0)
      const selectionFile = path.join(credentialDirectory, selection)
      const storedSelection = await readFile(selectionFile, "utf8")
      assert.deepEqual(JSON.parse(storedSelection), {
        repository: "github/replica",
        origin: selectedHub,
      })
      for (const origin of [
        "http://hub.example.com/repositories/123",
        "https://user:password@hub.example.com/repositories/123",
        "ftp://hub.example.com/repositories/123",
        "not a URL",
      ]) {
        assert.equal((await send("/api/hub/origin", "POST", { origin })).status, 422)
        assert.equal((await send("/api/hub/status")).body.hubOrigin, selectedHub)
        assert.equal(await readFile(selectionFile, "utf8"), storedSelection)
      }
      assert.deepEqual(
        (({ state, hubOrigin }) => ({ state, hubOrigin }))((await send("/api/hub/status")).body),
        { state: "disconnected", hubOrigin: selectedHub },
      )
      await canvas.close()
      canvas = await startCanvasServer(
        context,
        { send() {} },
        {
          hubOptions: { directory: path.join(workspace, "credentials") },
          localCommentsDirectory: path.join(workspace, "local-comments"),
        },
      )
      const reopenedPage = await (await fetch(canvas.url)).text()
      token = JSON.parse(reopenedPage.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).token
      assert.equal((await send("/api/hub/status")).body.hubOrigin, selectedHub)

      process.env.TEST_REPOSITORY = "github/another"
      assert.equal((await send("/api/hub/status")).body.hubOrigin, originalHub)
      process.env.TEST_REPOSITORY = "github/replica"
      assert.equal((await send("/api/hub/origin", "POST", { origin: originalHub })).status, 200)
      assert.equal((await send("/api/hub/status")).body.state, "connected")
    } finally {
      if (canvas) await canvas.close()
      process.env.PATH = originalPath
      delete process.env.TEST_BRANCH
      delete process.env.TEST_REPOSITORY
      delete process.env.TEST_HEAD
      delete process.env.TEST_HEAD_TREE
      delete process.env.TEST_TREE
      if (originalOrigin === undefined) delete process.env.REPLICA_HUB_ORIGIN
      else process.env.REPLICA_HUB_ORIGIN = originalOrigin
      await new Promise((resolve, reject) =>
        hub.close((error) => (error ? reject(error) : resolve())),
      )
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it("serves isolated panels, cached state and protected actions", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    execFileSync("git", ["init", "-q", "-b", "prototype", workspace])
    execFileSync("git", [
      "-C",
      workspace,
      "remote",
      "add",
      "origin",
      "https://github.com/github/replica.git",
    ])
    const context = await createCanvasContext({
      prototypeUrl: "http://localhost:3000",
      repository: "github/replica",
      branch: "prototype",
      sessionWorkspacePath: workspace,
      repositoryPath: workspace,
    })
    const server = await startCanvasServer(context, {
      send() {
        throw new Error("Do not send")
      },
    })
    try {
      const page = await fetch(server.url)
      const html = await page.text()
      assert.match(html, /window\.__REPLICA_CANVAS__/)
      assert.match(page.headers.get("content-security-policy"), /frame-src http: https:/)
      assert.match(page.headers.get("content-security-policy"), /avatars\.githubusercontent\.com/)
      assert.equal(
        page.headers
          .get("content-security-policy")
          .split("; ")
          .find((directive) => directive.startsWith("img-src ")),
        "img-src 'self' data: https://avatars.githubusercontent.com",
      )
      const placeholder = await fetch(new URL("/avatar-placeholder.svg", server.url))
      assert.equal(placeholder.status, 200)
      assert.equal(placeholder.headers.get("content-type"), "image/svg+xml")
      assert.equal(
        await placeholder.text(),
        await readFile(
          new URL("../../../../hub/public/avatar-placeholder.svg", import.meta.url),
          "utf8",
        ),
      )
      const asset = await fetch(new URL("/assets/renderer.js", server.url))
      assert.equal(asset.status, 200)
      assert.match(await asset.text(), /renderer-vendor\.js/)
      for (const name of [
        "renderer-vendor.js",
        "renderer-rolldown-runtime.js",
        "renderer-improvement-notes-prototype.js",
        "renderer-improvement-notes-vendor.js",
        "renderer-prototype-canvas-thread-sample.js",
        "renderer-prototype-canvas-improvement-threads.js",
      ]) {
        const chunk = await fetch(new URL(`/assets/${name}`, server.url))
        assert.equal(chunk.status, 200)
        assert.equal(chunk.headers.get("content-type"), "text/javascript; charset=utf-8")
        assert.ok((await chunk.arrayBuffer()).byteLength > 0)
      }
      for (const name of [
        "configure-commenting.cjs",
        "canvas-bridge.js",
        "commenting/index.mjs",
        "renderer-controls-vendor.js",
      ]) {
        assert.notEqual((await fetch(new URL(`/assets/${name}`, server.url))).status, 200)
      }
      const stylesheet = await fetch(new URL("/assets/renderer.css", server.url))
      assert.equal(stylesheet.status, 200)
      assert.match(await stylesheet.text(), /\/assets\/MonaSansVF-wdth-wght-opsz\.woff2/)
      assert.match(page.headers.get("content-security-policy"), /font-src 'self'/)
      for (const name of [
        "Hubot-Sans.woff2",
        "MonaSansMonoVF-wght.woff2",
        "MonaSansVF-wdth-wght-opsz.woff2",
      ]) {
        const font = await fetch(new URL(`/assets/${name}`, server.url))
        assert.equal(font.status, 200)
        assert.equal(font.headers.get("content-type"), "font/woff2")
        assert.ok((await font.arrayBuffer()).byteLength > 0)
      }

      const stateResponse = await fetch(new URL("/api/state?view=extra", server.url))
      assert.equal(stateResponse.status, 200)
      const state = await stateResponse.json()
      assert.equal(state.publishStatus.state, "unavailable")
      assert.ok(!JSON.stringify(state).includes(new URL(server.url).searchParams.get("document")))
      const denied = await fetch(new URL("/api/publish", server.url), {
        method: "POST",
      })
      assert.equal(denied.status, 403)
      assert.equal((await denied.json()).error, "Invalid canvas request token.")
      assert.equal((await fetch(new URL("/missing", server.url))).status, 403)

      server.setContext({ ...context, name: "Reopened prototype" })
      const reopened = await (await fetch(new URL("/api/state", server.url))).json()
      assert.equal(reopened.name, "Reopened prototype")
    } finally {
      await server.close()
      await rm(workspace, { recursive: true, force: true })
    }
    await assert.rejects(fetch(server.url))
  })

  it("keeps local state and publishing available when the optional Hub origin is invalid", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    execFileSync("git", ["init", "-q", "-b", "prototype"], { cwd: workspace })
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
      { cwd: workspace },
    )
    const context = await createCanvasContext({
      prototypeUrl: "http://localhost:3000",
      repository: "github/replica",
      branch: "prototype",
      sessionWorkspacePath: workspace,
      repositoryPath: workspace,
    })
    const server = await startCanvasServer(
      context,
      {
        async send() {
          return "message"
        },
      },
      {
        hubOptions: {
          origin: "file:///invalid",
          directory: path.join(workspace, "credentials"),
        },
      },
    )
    try {
      const page = await (await fetch(server.url)).text()
      const token = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1]).token
      const headers = { "X-Replica-Canvas-Token": token }
      assert.equal((await fetch(new URL("/api/state", server.url))).status, 200)
      const hub = await fetch(new URL("/api/hub/status", server.url), {
        headers,
      })
      assert.equal(hub.status, 500)
      assert.match((await hub.json()).error, /REPLICA_HUB_ORIGIN/)
      const publish = await fetch(new URL("/api/publish", server.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "committed-only" }),
      })
      assert.equal(publish.status, 202)
    } finally {
      await server.close()
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
