#!/usr/bin/env node

import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const responseLimit = 128 * 1024

/** Keeps one task's private proofs outside the checkout and out of command output. */
export function createTaskClient({ origin, stateDirectory, checkout, fetchImpl = fetch }) {
  let hub
  try {
    hub = new URL(origin)
  } catch {
    throw new Error("Use the canonical Hub HTTPS origin without credentials or a path.")
  }
  if (
    hub.protocol !== "https:" ||
    hub.username ||
    hub.password ||
    hub.pathname !== "/" ||
    hub.search ||
    hub.hash
  ) {
    throw new Error("Use the canonical Hub HTTPS origin without credentials or a path.")
  }
  const statePath = path.join(stateDirectory, "connection.json")

  async function privateDirectory() {
    if (!path.isAbsolute(stateDirectory)) throw new Error("Task state directory must be absolute.")
    const resolvedDirectory = path.resolve(stateDirectory)
    const root = await realpath(checkout)
    if (resolvedDirectory === root || resolvedDirectory.startsWith(`${root}${path.sep}`)) {
      throw new Error("Task state must be outside the repository checkout.")
    }
    await mkdir(stateDirectory, { mode: 0o700, recursive: true })
    const directory = await lstat(stateDirectory)
    if (
      directory.isSymbolicLink() ||
      !directory.isDirectory() ||
      directory.uid !== process.getuid() ||
      (directory.mode & 0o077) !== 0 ||
      (await realpath(stateDirectory)) !== resolvedDirectory
    ) {
      throw new Error("Task state must be an owner-only directory without symbolic links.")
    }
  }

  async function load() {
    await privateDirectory()
    const handle = await open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
        throw new Error("Task state file must be owner-only.")
      }
      let state
      try {
        state = JSON.parse(await handle.readFile("utf8"))
      } catch {
        throw new Error(
          "Task state is unreadable. Revoke the connection in Hub before starting again.",
        )
      }
      if (!state || typeof state !== "object") throw new Error("Task state is invalid.")
      if (state.origin !== hub.origin) throw new Error("Task state belongs to another Hub.")
      return state
    } finally {
      await handle.close()
    }
  }

  async function save(state, exclusive = false) {
    await privateDirectory()
    const temporary = `${statePath}.${process.pid}.tmp`
    const handle = await open(temporary, "wx", 0o600)
    try {
      try {
        await handle.writeFile(JSON.stringify({ ...state, origin: hub.origin }))
      } finally {
        await handle.close()
      }
      if (exclusive) {
        const reservation = await open(statePath, "wx", 0o600)
        await reservation.close()
      }
      await rename(temporary, statePath)
    } catch (error) {
      await unlink(temporary)
      throw error
    }
  }

  async function request(route, { method = "POST", body, token, allowUnauthorized = false } = {}) {
    const headers = { Accept: "application/json" }
    if (body) headers["Content-Type"] = "application/json"
    if (token) headers.Authorization = `Bearer ${token}`
    let response
    try {
      response = await fetchImpl(new URL(route, hub), {
        method,
        headers,
        body: body && JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new Error("Hub request failed. Check approved network access before retrying.")
    }
    if (allowUnauthorized && response.status === 401) return null
    if (!response.ok) throw new Error(`Hub rejected the request (HTTP ${response.status}).`)
    if (response.status === 204) return null
    if (!response.body) throw new Error("Hub returned an empty task response.")
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    let failed = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > responseLimit) throw new Error("response limit")
        chunks.push(Buffer.from(value))
      }
    } catch {
      failed = true
    } finally {
      try {
        await reader.cancel()
      } catch {
        failed = true
      }
    }
    if (failed) throw new Error("Hub task response could not be read within the client limit.")
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Invalid task envelope")
      }
      return result
    } catch {
      throw new Error("Hub returned an invalid task response.")
    }
  }

  function metadata(state) {
    return {
      connectionId: state.connectionId,
      repository: state.repository,
      branch: state.branch,
      expiresAt: state.expiresAt,
    }
  }

  async function verifiedMetadata(state) {
    if (!state.accessToken) {
      throw new Error("Finish browser approval and poll before checking the connection.")
    }
    const result = await request("/api/tasks/connection", {
      method: "GET",
      token: state.accessToken,
    })
    if (
      result.id !== state.connectionId ||
      result.repositoryId !== state.repositoryGitHubId ||
      result.repository !== state.repository ||
      result.branch !== state.branch ||
      result.expiresAt !== state.expiresAt
    ) {
      throw new Error("Hub returned a different task connection.")
    }
    return metadata(state)
  }

  return {
    async start({ repository, branch }) {
      await privateDirectory()
      try {
        await lstat(statePath)
        throw new Error(
          "This task already has private connection state. Disconnect or use another task directory.",
        )
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
      const result = await request("/api/tasks/connections", { body: { repository, branch } })
      if (
        typeof result.deviceCode !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(result.deviceCode) ||
        typeof result.userCode !== "string" ||
        !/^[A-F0-9]{10}$/.test(result.userCode) ||
        typeof result.verificationUrl !== "string" ||
        result.verificationUrl !== `${hub.origin}/tasks/approve/${result.userCode}` ||
        !Number.isFinite(Date.parse(result.expiresAt))
      ) {
        throw new Error("Hub returned an invalid approval request.")
      }
      await save(
        { repository, branch, deviceCode: result.deviceCode, approvalExpiresAt: result.expiresAt },
        true,
      )
      return {
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
        repository,
        branch,
        approvalExpiresAt: result.expiresAt,
        intervalSeconds: 3,
      }
    },
    async poll() {
      const state = await load()
      if (state.accessToken) return { status: "approved", ...(await verifiedMetadata(state)) }
      if (!state.deviceCode) throw new Error("Start a new approval request.")
      const result = await request("/api/tasks/connections/token", {
        body: { device_code: state.deviceCode },
      })
      if (result.status === "pending") return { status: "pending" }
      if (result.status !== "approved") {
        if (!["expired", "denied"].includes(result.status)) {
          throw new Error("Invalid approval status.")
        }
        return { status: result.status }
      }
      if (
        typeof state.repository !== "string" ||
        typeof result.repository !== "string" ||
        result.repository.toLowerCase() !== state.repository.toLowerCase() ||
        result.branch !== state.branch ||
        !Number.isSafeInteger(result.connectionId) ||
        result.connectionId <= 0 ||
        !Number.isSafeInteger(result.repositoryId) ||
        result.repositoryId <= 0 ||
        !/^rt_[A-Za-z0-9_-]{43}$/.test(result.accessToken) ||
        Date.parse(result.expiresAt) - Date.parse(result.approvedAt) !== 86_400_000
      ) {
        throw new Error("Hub returned an invalid task credential.")
      }
      const next = {
        repository: result.repository,
        branch: state.branch,
        connectionId: result.connectionId,
        repositoryGitHubId: result.repositoryId,
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
      }
      await save(next)
      return { status: "approved", ...metadata(next) }
    },
    async status() {
      return verifiedMetadata(await load())
    },
    async lookup() {
      const state = await load()
      if (!state.accessToken) {
        throw new Error("Finish browser approval and poll before resolving the prototype.")
      }
      const result = await request("/api/tasks/prototype", {
        method: "GET",
        token: state.accessToken,
      })
      if (
        result.branch !== state.branch ||
        result.repositoryGitHubId !== state.repositoryGitHubId ||
        (result.prototypeId !== null &&
          (!Number.isSafeInteger(result.prototypeId) || result.prototypeId <= 0))
      ) {
        throw new Error("Hub returned an invalid prototype target.")
      }
      return {
        repositoryGitHubId: result.repositoryGitHubId,
        branch: result.branch,
        prototypeId: result.prototypeId,
      }
    },
    async register({ prototypeId, commitSha }) {
      if (
        !Number.isSafeInteger(prototypeId) ||
        prototypeId <= 0 ||
        typeof commitSha !== "string" ||
        !/^[0-9a-f]{40}$/.test(commitSha)
      ) {
        throw new Error("Supply the expected prototype ID and exact full commit SHA.")
      }
      const state = await load()
      if (!state.accessToken) {
        throw new Error("Finish browser approval and poll before registering the prototype.")
      }
      const result = await request("/api/tasks/prototype/registration", {
        method: "PUT",
        token: state.accessToken,
        body: { prototype_id: prototypeId, commit_sha: commitSha },
      })
      if (
        !["pending", "ready", "failed", "superseded", "blocked"].includes(result.status) ||
        !["discovery", "registration", "workflow", "import"].includes(result.phase) ||
        result.repositoryGitHubId !== state.repositoryGitHubId ||
        result.prototypeId !== prototypeId ||
        result.branch !== state.branch ||
        result.commitSha !== commitSha ||
        typeof result.registered !== "boolean"
      ) {
        throw new Error("Hub returned a different or invalid registration target.")
      }
      const output = {
        status: result.status,
        phase: result.phase,
        repositoryGitHubId: result.repositoryGitHubId,
        prototypeId: result.prototypeId,
        branch: result.branch,
        commitSha: result.commitSha,
        registered: result.registered,
      }
      for (const field of ["buildId", "buildNumber", "runId", "runAttempt", "artifactId"]) {
        if (result[field] !== undefined && result[field] !== null) {
          if (!Number.isSafeInteger(result[field]) || result[field] <= 0) {
            throw new Error("Hub returned invalid Build evidence.")
          }
          output[field] = result[field]
        }
      }
      if (result.status !== "ready") {
        if (typeof result.reason !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(result.reason)) {
          throw new Error("Hub returned an invalid registration outcome.")
        }
        return { ...output, reason: result.reason }
      }
      let url
      try {
        url = new URL(result.url)
      } catch {
        throw new Error("Hub returned an invalid authenticated Build URL.")
      }
      if (
        !result.registered ||
        !["created", "existing"].includes(result.registration) ||
        ["buildId", "buildNumber", "runId", "runAttempt", "artifactId"].some(
          (field) => output[field] === undefined,
        ) ||
        url.origin !== hub.origin ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== `/repositories/${state.repositoryGitHubId}/prototypes/${prototypeId}` ||
        url.search !== `?build=${output.buildNumber}`
      ) {
        throw new Error("Hub did not return this exact registered Build.")
      }
      return { ...output, registration: result.registration, url: url.href }
    },
    async disconnect() {
      const state = await load()
      if (!state.accessToken) {
        throw new Error("Deny the pending request in Hub before removing its private state.")
      }
      await request("/api/tasks/connection", {
        method: "DELETE",
        token: state.accessToken,
        allowUnauthorized: true,
      })
      await unlink(statePath)
      return { status: "disconnected" }
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [command, origin, taskName, repository, branch] = process.argv.slice(2)
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(taskName || "")) {
      throw new Error("Supply a unique task name using letters, numbers, underscores or hyphens.")
    }
    let checkout
    try {
      checkout = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
    } catch {
      throw new Error("Run the task client from inside a Git repository checkout.")
    }
    const client = createTaskClient({
      origin,
      stateDirectory: path.join(homedir(), ".config", "replica", "tasks", taskName),
      checkout,
    })
    let result
    if (command === "start" && repository && branch) {
      result = await client.start({ repository, branch })
    } else if (command === "poll") {
      result = await client.poll()
    } else if (command === "status") {
      result = await client.status()
    } else if (command === "lookup") {
      result = await client.lookup()
    } else if (command === "register" && repository && branch) {
      result = await client.register({ prototypeId: Number(repository), commitSha: branch })
    } else if (command === "disconnect") {
      result = await client.disconnect()
    } else {
      throw new Error(
        "Use start HUB TASK REPOSITORY BRANCH, register HUB TASK ID SHA, or poll/status/lookup/disconnect HUB TASK.",
      )
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    const message = error.code ? `Task client failed (${error.code}).` : error.message
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
