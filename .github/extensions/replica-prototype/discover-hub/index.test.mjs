import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { discoverHub } from "./index.mjs"
import { startCanvasServer } from "../start-canvas-server/index.mjs"
import { createCanvasContext } from "../create-canvas-context/index.mjs"
import { createHubOriginStore } from "../create-hub-origin-store/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"
import { runCommand } from "../run-command/index.mjs"

async function fixture(action) {
  const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  await mkdir(workspace, { recursive: true })
  execFileSync("git", ["init", "-b", "prototype/uncommitted", workspace], {
    stdio: "ignore",
  })
  execFileSync("git", ["-C", workspace, "remote", "add", "origin", "git@github.com:team/fork.git"])
  execFileSync("git", [
    "-C",
    workspace,
    "remote",
    "add",
    "upstream",
    "git@github.com:team/upstream.git",
  ])
  const context = {
    repositoryPath: workspace,
    target: { repository: "spoofed/repository" },
  }
  const directory = path.join(workspace, "private")
  const calls = []
  const state = {
    text: JSON.stringify({
      version: 1,
      hub: { origin: "https://team.example.com" },
    }),
    sha: "a".repeat(40),
  }
  const options = {
    directory,
    runCommand: async (command, args) => {
      calls.push(args)
      assert.equal(command, "gh")
      assert.equal(args[args.indexOf("--hostname") + 1], "github.com")
      assert.ok(args.includes("owner=team"))
      assert.ok(args.includes("name=fork"))
      if (state.error) return { ok: false, error: state.error }
      const repository = args.some((arg) => arg.startsWith("expression="))
        ? {
            object: state.absent
              ? null
              : {
                  __typename: state.type || "Blob",
                  text: state.text,
                  byteSize: state.text.length,
                  isTruncated: state.truncated || false,
                },
          }
        : { defaultBranchRef: { name: "trunk", target: { oid: state.sha } } }
      return {
        ok: true,
        stdout: JSON.stringify({
          data: {
            repository: {
              nameWithOwner: state.identity || "team/fork",
              ...repository,
            },
          },
        }),
      }
    },
  }
  try {
    await action({ workspace, context, options, state, calls })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

describe("discoverHub()", () => {
  it("reports malformed GitHub envelopes as unavailable rather than selecting a Hub", () =>
    fixture(async ({ context, options }) => {
      for (const payload of [null, true, [], {}, { data: { repository: { nameWithOwner: 42 } } }]) {
        const result = await discoverHub(context, {
          ...options,
          force: true,
          runCommand: async () => ({ ok: true, stdout: JSON.stringify(payload) }),
        })
        assert.equal(result.state, "unreachable")
        assert.equal(result.origin, undefined)
        assert.match(result.message, /could not verify the origin repository/)
      }
    }))

  it("reads complete GraphQL responses larger than the shared command runner limit", () =>
    fixture(async ({ workspace, context, options }) => {
      const text = JSON.stringify({
        hub: { origin: "https://team.example.com" },
        templates: [{ description: "\\".repeat(600_000) }],
      })
      const response = JSON.stringify({
        data: {
          repository: {
            nameWithOwner: "team/fork",
            object: {
              __typename: "Blob",
              text,
              byteSize: Buffer.byteLength(text),
              isTruncated: false,
            },
          },
        },
      })
      assert.ok(Buffer.byteLength(response) > 1024 * 1024)
      const bin = path.join(workspace, "bin")
      await mkdir(bin)
      const responseFile = path.join(bin, "response.json")
      await writeFile(responseFile, response)
      await writeFile(
        path.join(bin, "gh"),
        `#!${process.execPath}
import { readFileSync } from "node:fs"
if (process.argv.some((arg) => arg.startsWith("expression="))) {
  process.stdout.write(readFileSync(${JSON.stringify(responseFile)}))
} else {
  process.stdout.write(JSON.stringify({
    data: { repository: {
      nameWithOwner: "team/fork",
      defaultBranchRef: { name: "trunk", target: { oid: "${"a".repeat(40)}" } },
    } },
  }))
}
`,
        { mode: 0o755 },
      )
      const originalPath = process.env.PATH
      process.env.PATH = `${bin}${path.delimiter}${originalPath || ""}`
      try {
        const bounded = await runCommand("gh", ["expression=fixture"], workspace)
        assert.equal(bounded.ok, false)
        assert.match(bounded.error, /maxBuffer/)
        const result = await discoverHub(context, { directory: options.directory })
        assert.equal(result.state, "valid")
        assert.equal(result.origin, "https://team.example.com")
        assert.equal(result.fingerprint, createHash("sha256").update(text).digest("hex"))
      } finally {
        if (originalPath === undefined) delete process.env.PATH
        else process.env.PATH = originalPath
      }
    }))

  it("validates only the Hub origin without rejecting the template catalog or unrelated schema fields", () =>
    fixture(async ({ context, options, state }) => {
      const templates = Array.from({ length: 100 }, (_, index) => ({
        id: `template-${index}`,
        name: `Template ${index}`,
        description: "A".repeat(200),
        path: "/#/issues",
      }))
      for (const version of [undefined, 1, 2]) {
        state.text = JSON.stringify({
          version,
          hub: { origin: "https://team.example.com/", additionalSetting: true },
          templates,
          anotherSetting: true,
        })
        assert.ok(state.text.length > 16 * 1024)
        const result = await discoverHub(context, { ...options, force: true })
        assert.equal(result.state, "valid")
        assert.equal(result.origin, "https://team.example.com")
        assert.equal(JSON.parse(state.text).templates.length, 100)
      }
      state.text = JSON.stringify({
        hub: { origin: "https://team.example.com" },
        templates: {},
      })
      assert.equal((await discoverHub(context, { ...options, force: true })).state, "valid")
    }))

  it("treats omitted and blank Hub origins as missing configuration", () =>
    fixture(async ({ context, options, state }) => {
      for (const value of [
        {},
        { version: 1, templates: [] },
        { hub: {} },
        { hub: { origin: null } },
        { hub: { origin: "" } },
        { hub: { origin: " \n " } },
      ]) {
        state.text = JSON.stringify(value)
        const result = await discoverHub(context, { ...options, force: true })
        assert.equal(result.state, "absent")
        assert.equal(result.origin, undefined)
      }
      for (const origin of [123, true, {}, []]) {
        state.text = JSON.stringify({ hub: { origin } })
        const invalid = await discoverHub(context, { ...options, force: true })
        assert.equal(invalid.state, "invalid")
        assert.match(invalid.message, /hub.origin must be a URL string/)
      }
    }))

  it("refreshes cached results from the old strict schema validator", () =>
    fixture(async ({ context, options, state, calls }) => {
      const key = `${createHash("sha256").update("team/fork").digest("hex")}.discovery.json`
      await createPrivateStore(options.directory).write(key, {
        repository: "team/fork",
        state: "invalid",
        message: "Old schema rejected templates.",
        checkedAt: Date.now(),
      })
      state.text = JSON.stringify({
        version: 1,
        hub: { origin: "https://team.example.com" },
        templates: [{ id: "issues", path: "/#/issues" }],
      })
      const refreshed = await discoverHub(context, options)
      assert.equal(refreshed.state, "valid")
      assert.equal(refreshed.cacheVersion, 2)
      assert.equal(calls.length, 2)
      await discoverHub(context, options)
      assert.equal(calls.length, 2)
    }))

  it("keeps manual URL entry available when the repository only configures templates", () =>
    fixture(async ({ workspace, options, state }) => {
      state.text = JSON.stringify({
        version: 1,
        templates: [{ id: "issues", path: "/#/issues" }],
      })
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        sessionWorkspacePath: workspace,
        repositoryPath: workspace,
      })
      const original = process.env.REPLICA_HUB_ORIGIN
      delete process.env.REPLICA_HUB_ORIGIN
      const canvas = await startCanvasServer(context, {}, { hubOptions: options })
      try {
        const page = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        const status = await (
          await fetch(new URL("/api/hub/status", canvas.url), {
            headers: { "X-Replica-Canvas-Token": token },
          })
        ).json()
        assert.equal(status.state, "unconfigured")
        assert.equal(status.discovery.state, "absent")
        assert.equal(status.hubOrigin, undefined)
        assert.equal(await createHubOriginStore(options).read("team/fork"), null)
      } finally {
        await canvas.close()
        if (original === undefined) delete process.env.REPLICA_HUB_ORIGIN
        else process.env.REPLICA_HUB_ORIGIN = original
      }
    }))

  it("uses origin, its actual default branch and immutable revision, never local config or caller hints", () =>
    fixture(async ({ workspace, context, options, calls }) => {
      await mkdir(path.join(workspace, ".github"))
      await writeFile(
        path.join(workspace, ".github/replica.json"),
        '{"version":1,"hub":{"origin":"https://attacker.example.com"}}',
      )
      const result = await discoverHub(context, options)
      assert.equal(result.state, "valid")
      assert.equal(result.repository, "team/fork")
      assert.equal(result.defaultBranch, "trunk")
      assert.equal(result.sourceRevision, "a".repeat(40))
      assert.equal(result.origin, "https://team.example.com")
      assert.ok(calls[1].includes(`expression=${"a".repeat(40)}:.github/replica.json`))
      await Promise.all([discoverHub(context, options), discoverHub(context, options)])
      assert.equal(calls.length, 2)
    }))

  it("distinguishes missing, invalid, changed and unavailable configuration and retries explicitly", () =>
    fixture(async ({ context, options, state }) => {
      const original = await discoverHub(context, options)
      state.text = JSON.stringify({
        version: 1,
        hub: { origin: "https://new.example.com" },
      })
      state.sha = "b".repeat(40)
      assert.equal((await discoverHub(context, options)).origin, original.origin)
      const changed = await discoverHub(context, { ...options, force: true })
      assert.equal(changed.changed, true)
      assert.equal(changed.sourceRevision, state.sha)
      state.text = "{not JSON"
      assert.equal((await discoverHub(context, { ...options, force: true })).state, "invalid")
      state.absent = true
      assert.equal((await discoverHub(context, { ...options, force: true })).state, "absent")
      state.error = "gh is not installed."
      const unavailable = await discoverHub(context, {
        ...options,
        force: true,
      })
      assert.equal(unavailable.state, "unreachable")
      assert.equal(unavailable.lastVerifiedRevision, state.sha)
      assert.equal(unavailable.origin, undefined)
    }))

  it("discovers the Hub alongside template metadata without using template routes as origins", () =>
    fixture(async ({ context, options, state }) => {
      const templates = [
        {
          id: "settings",
          name: "Settings",
          category: "Configuration",
          description: "Edit account settings.",
          path: "/templates/settings?tab=profile#details",
        },
      ]
      state.text = JSON.stringify({
        version: 1,
        hub: { origin: "https://team.example.com" },
        templates,
      })
      const configured = await discoverHub(context, options)
      assert.equal(configured.state, "valid")
      assert.equal(configured.origin, "https://team.example.com")

      state.text = JSON.stringify({ version: 1, templates })
      const unconfigured = await discoverHub(context, {
        ...options,
        force: true,
      })
      assert.equal(unconfigured.state, "absent")
      assert.equal(unconfigured.origin, undefined)
    }))

  it("rejects truncated and non-blob configuration even when the text is valid JSON", () =>
    fixture(async ({ context, options, state }) => {
      state.truncated = true
      const truncated = await discoverHub(context, options)
      assert.equal(truncated.state, "invalid")
      assert.match(truncated.message, /must be a complete JSON file/)
      state.truncated = false
      state.type = "Tree"
      const nonBlob = await discoverHub(context, { ...options, force: true })
      assert.equal(nonBlob.state, "invalid")
      assert.match(nonBlob.message, /must be a complete JSON file/)
    }))

  it("rejects repository redirects and non-origin or remote HTTP URLs", () =>
    fixture(async ({ context, options, state }) => {
      state.identity = "team/upstream"
      assert.equal((await discoverHub(context, options)).state, "unreachable")
      delete state.identity
      for (const origin of [
        "http://remote.example.com",
        "https://user:password@team.example.com",
        "https://team.example.com/path",
        "https://team.example.com/?next=evil",
        "https://team.example.com/#fragment",
        "not a URL",
      ]) {
        state.text = JSON.stringify({ version: 1, hub: { origin } })
        assert.equal((await discoverHub(context, { ...options, force: true })).state, "invalid")
      }
    }))

  it("skips GitHub discovery for explicit local-mode repositories", () =>
    fixture(async ({ workspace, options, calls }) => {
      const result = await discoverHub(
        {
          repositoryPath: path.join(workspace, ".local/prototypes/example"),
          target: { repository: "local/example" },
        },
        options,
      )
      assert.equal(result.state, "local")
      assert.equal(calls.length, 0)
    }))

  it("selects configuration before any commit, preserves mismatches and keeps polling off discovery", () =>
    fixture(async ({ workspace, options, state, calls }) => {
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        sessionWorkspacePath: workspace,
        repositoryPath: workspace,
      })
      const originalOrigin = process.env.REPLICA_HUB_ORIGIN
      delete process.env.REPLICA_HUB_ORIGIN
      const canvas = await startCanvasServer(context, {}, { hubOptions: options })
      try {
        const page = await (await fetch(canvas.url)).text()
        const { token } = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
        const headers = { "X-Replica-Canvas-Token": token }
        async function status() {
          return (await fetch(new URL("/api/hub/status", canvas.url), { headers })).json()
        }
        const first = await status()
        assert.equal(first.hubOrigin, "https://team.example.com")
        assert.equal(first.repository, "team/fork")
        assert.equal(first.state, "disconnected")
        assert.equal(await createHubOriginStore(options).read("team/fork"), first.hubOrigin)
        state.text = JSON.stringify({
          version: 1,
          hub: { origin: "https://new.example.com" },
        })
        await status()
        assert.equal(calls.length, 2)
        const changed = await (
          await fetch(new URL("/api/hub/discovery", canvas.url), {
            method: "POST",
            headers,
          })
        ).json()
        assert.equal(changed.hubOrigin, first.hubOrigin)
        assert.equal(changed.discovery.mismatch, true)
        assert.equal(calls.length, 4)
      } finally {
        await canvas.close()
        if (originalOrigin === undefined) delete process.env.REPLICA_HUB_ORIGIN
        else process.env.REPLICA_HUB_ORIGIN = originalOrigin
      }
    }))

  it("keeps saved selections ahead of explicit development origins, and those ahead of discovery", () =>
    fixture(async ({ workspace, options }) => {
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        sessionWorkspacePath: workspace,
        repositoryPath: workspace,
      })
      const original = process.env.REPLICA_HUB_ORIGIN
      process.env.REPLICA_HUB_ORIGIN = "http://replica.localhost:19500"
      async function origin() {
        const canvas = await startCanvasServer(context, {}, { hubOptions: options })
        try {
          const page = await (await fetch(canvas.url)).text()
          const { token } = JSON.parse(page.match(/window\.__REPLICA_CANVAS__ = ([^;]+);/)[1])
          return (
            await (
              await fetch(new URL("/api/hub/status", canvas.url), {
                headers: { "X-Replica-Canvas-Token": token },
              })
            ).json()
          ).hubOrigin
        } finally {
          await canvas.close()
        }
      }
      try {
        assert.equal(await origin(), "http://replica.localhost:19500")
        await createHubOriginStore(options).save("team/fork", "https://saved.example.com")
        assert.equal(await origin(), "https://saved.example.com")
      } finally {
        if (original === undefined) delete process.env.REPLICA_HUB_ORIGIN
        else process.env.REPLICA_HUB_ORIGIN = original
      }
    }))
})
