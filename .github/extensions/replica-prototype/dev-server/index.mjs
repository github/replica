import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { stripVTControlCharacters } from "node:util"
import { discoverPrototypeServers } from "../discover-prototype-servers/index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"
import { runCommand } from "../run-command/index.mjs"
import { createStartupStatus, publicStartupError, StartupError } from "../startup-error/index.mjs"
import { readErrorCode } from "../read-error-code/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
const supportedCommand =
  /^(?:vite(?=\s|$)(?!\s+(?:build|preview)\b)|next\s+dev\b|astro\s+dev\b|webpack\s+serve\b|webpack-dev-server\b|vue-cli-service\s+serve\b|react-scripts\s+start\b)/
const lockfiles = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"],
}
async function readOptional(file) {
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000)
      throw new StartupError(`Cannot read linked, non-file, or oversized ${path.basename(file)}.`)
    return await readFile(file)
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") return null
    throw error
  }
}
export async function readDevScripts(directory) {
  const content = await readOptional(path.join(directory, "package.json"))
  if (!content)
    return {
      scripts: [],
      message: "No package.json in this directory. Start your server manually.",
    }
  let manifest
  try {
    manifest = readHubObject(JSON.parse(content.toString("utf8")))
  } catch {
    throw new StartupError("Cannot read dev scripts: package.json is not valid JSON.")
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new StartupError("Cannot read dev scripts: package.json must contain an object.")
  const present = await Promise.all(
    Object.entries(lockfiles).map(async ([manager, names]) => ({
      manager,
      files: await Promise.all(names.map((name) => readOptional(path.join(directory, name)))),
    })),
  )
  const managers = present.filter(({ files }) => files.some((file) => file !== null))
  const declared = manifest.packageManager
  if (
    declared != null &&
    (typeof declared !== "string" || !/^(npm|pnpm|yarn|bun)@\d[^ \t\r\n]*$/.test(declared))
  )
    throw new StartupError("Unsupported packageManager. Start your server manually.")
  const manager =
    (typeof declared === "string" && declared.split("@")[0]) || managers[0]?.manager || "npm"
  if (managers.some((entry) => entry.manager !== manager))
    throw new StartupError("Conflicting package managers. Start your server manually.")
  const revision = createHash("sha256").update(content)
  for (const entry of present) {
    revision.update(entry.manager)
    for (const file of entry.files) revision.update(file || "missing")
  }
  const fingerprint = revision.digest("hex")
  const manifestScripts = readHubObject(manifest.scripts)
  const scripts = ["dev", "start", "serve"].flatMap((name) => {
    const command = manifestScripts?.[name]
    if (
      typeof command !== "string" ||
      !supportedCommand.test(command.trim()) ||
      /[;&|`$<>\r\n]/.test(command)
    )
      return []
    const hooks = [`pre${name}`, `post${name}`].flatMap((hook) => {
      const script = manifestScripts?.[hook]
      return typeof script === "string" ? [`${hook}: ${script}`] : []
    })
    return [
      {
        id: `${fingerprint}:${name}`,
        name,
        command,
        invocation: `${manager} run ${name}`,
        manager,
        hooks,
        directory,
      },
    ]
  })
  return {
    scripts,
    message: scripts.length
      ? "Starting a script executes repository code, including any pre/post hooks."
      : "No supported dev, start, or serve script in this directory. Start your server manually.",
  }
}
export function createDevServerManager({
  discover = discoverPrototypeServers,
  command = runCommand,
  launch = spawn,
  timeout = 30_000,
  pollInterval = 250,
  store = createPrivateStore(path.join(os.homedir(), ".config", "replica", "dev-servers")),
} = {}) {
  const entries = new Map()
  const children = new Set()
  let closed = false
  function stop(entry) {
    if (entry.stopping) return entry.stopping
    const child = entry.child
    entry.child = null
    if (!child?.pid) {
      if (child) children.delete(child)
      return Promise.resolve()
    }
    const pid = child.pid
    function signal(value) {
      try {
        process.kill(-pid, value)
      } catch (error) {
        if (readErrorCode(error) !== "ESRCH") throw error
      }
    }
    async function terminateChild(child) {
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", () => resolve()))
      signal("SIGTERM")
      await delay(500)
      signal("SIGKILL")
      await exited
      children.delete(child)
    }
    entry.stopping = terminateChild(child).finally(() => {
      entry.stopping = null
    })
    return entry.stopping
  }
  async function start(entry, id) {
    await entry.stopping
    const plan = await readDevScripts(entry.directory)
    const script = plan.scripts.find((candidate) => candidate.id === id)
    if (!script)
      throw new StartupError("Dev scripts changed or are unavailable. Scan again before starting.")
    const found = await discover(entry.directory)
    if (found.servers.length === 1 && found.servers[0]) return found.servers[0].url
    if (found.servers.length > 1)
      throw new StartupError("Servers are already running. Scan again and choose one to connect.")
    await stop(entry)
    if (process.platform === "win32")
      throw new StartupError(
        "Starting dev servers is supported on macOS and Linux. Start it manually.",
      )
    const env = { ...process.env, NO_COLOR: "1", COREPACK_ENABLE_NETWORK: "0" }
    const version = await command(script.manager, ["--version"], entry.directory, { env })
    if (!version.ok)
      throw new StartupError(`${script.manager} is unavailable. Install it yourself, then retry.`)
    const latest = await discover(entry.directory)
    if (latest.servers.length === 1 && latest.servers[0]) return latest.servers[0].url
    if (latest.servers.length > 1)
      throw new StartupError("Servers are already running. Scan again and choose one to connect.")
    // Revalidate after the preflight: the click authorizes only the displayed manifest.
    if (!(await readDevScripts(entry.directory)).scripts.some((candidate) => candidate.id === id))
      throw new StartupError("Dev scripts changed. Scan again before starting.")
    if (entry.released || closed) throw new StartupError("The prototype panel was closed.")
    entry.output = ""
    entry.message = `Starting ${script.invocation}...`
    const child = launch(script.manager, ["run", script.name], {
      cwd: entry.directory,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    })
    entry.child = child
    children.add(child)
    let failure
    function append(chunk) {
      entry.output = stripVTControlCharacters(entry.output + chunk.toString("utf8")).slice(-8000)
    }
    child.stdout?.on("data", append)
    child.stderr?.on("data", append)
    child.on("error", () => {
      failure = new StartupError(
        `Could not launch ${script.invocation}. Check your package manager.`,
      )
    })
    child.on("exit", (code, signal) => {
      failure = new StartupError(
        `${script.invocation} exited (${signal || `code ${code}`}). Check the output below.`,
      )
      if (entry.child === child) {
        entry.message = failure.message
        stop(entry).catch((error) => {
          entry.message = publicStartupError(error, "Could not clean up the exited dev server.")
        })
      }
    })
    function checkStartup() {
      if (failure) throw failure
      if (entry.released || closed) throw new StartupError("The prototype panel was closed.")
    }
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      checkStartup()
      const processes = await command("ps", ["-axo", "pid=,pgid="], entry.directory)
      if (!processes.ok)
        throw new StartupError("Cannot identify the started server: ps is unavailable.")
      const owned = new Set(
        processes.stdout.split("\n").flatMap((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
          return match && Number(match[2]) === child.pid ? [Number(match[1])] : []
        }),
      )
      const result = await discover(entry.directory)
      checkStartup()
      const servers = result.servers.filter((server) => owned.has(server.pid))
      if (servers.length > 1)
        throw new StartupError(
          "The script started multiple servers and was stopped. Start it manually, then scan and choose one.",
        )
      if (servers.length === 1 && servers[0]) {
        entry.message = "Dev server ready."
        return servers[0].url
      }
      await delay(pollInterval)
    }
    throw new StartupError(
      "The dev server did not serve an HTML page within 30 seconds. Check the output below, then retry or start it manually.",
    )
  }
  function retire(entry) {
    if (entry.retiring) return entry.retiring
    entry.released = true
    entry.retiring = (async () => {
      await entry.pending?.catch(() => {})
      await store.lock(createHash("sha256").update(entry.directory).digest("hex"), () =>
        stop(entry),
      )
    })().finally(() => {
      if (entries.get(entry.directory) === entry) entries.delete(entry.directory)
    })
    return entry.retiring
  }
  return {
    terminate() {
      // Process exit cannot await teardown, including an in-flight graceful stop.
      for (const child of children) {
        if (!child.pid) continue
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch (error) {
          if (readErrorCode(error) !== "ESRCH") throw error
        }
      }
      children.clear()
    },
    async acquire(directory) {
      directory = await realpath(directory)
      if (closed) throw new Error("The dev server manager is closed.")
      let candidate = entries.get(directory)
      while (candidate?.retiring) {
        await candidate.retiring
        if (closed) throw new Error("The dev server manager is closed.")
        candidate = entries.get(directory)
      }
      if (!candidate) {
        candidate = {
          directory,
          users: 0,
          child: null,
          pending: null,
          output: "",
          message: "",
          released: false,
        }
        entries.set(directory, candidate)
      }
      const entry = candidate
      entry.users += 1
      let released = false
      return {
        describe: () => readDevScripts(directory),
        status: () =>
          createStartupStatus({
            starting: Boolean(entry.pending),
            message: entry.message,
            output: entry.output,
          }),
        async start(id) {
          if (released) throw new StartupError("The prototype panel was closed.")
          if (entry.pending) {
            if (entry.startingId !== id)
              throw new StartupError(
                "Another panel is starting a different script. Wait, then scan again.",
              )
            return entry.pending
          }
          entry.startingId = id
          entry.message = "Checking dev server startup..."
          entry.output = ""
          const previousChild = entry.child
          entry.pending = store
            .lock(createHash("sha256").update(directory).digest("hex"), async () => {
              try {
                return await start(entry, id)
              } catch (error) {
                if (entry.child !== previousChild || entry.stopping) await stop(entry)
                throw error
              }
            })
            .catch((error) => {
              entry.message = publicStartupError(error)
              throw error
            })
            .finally(() => {
              entry.pending = null
              entry.startingId = null
            })
          return entry.pending
        },
        async release() {
          if (released) return
          released = true
          entry.users -= 1
          if (entry.users) return
          await retire(entry)
        },
      }
    },
    async close() {
      closed = true
      await Promise.all([...entries.values()].map(retire))
      entries.clear()
    },
  }
}
