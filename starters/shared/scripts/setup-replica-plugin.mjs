import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

const pluginName = "replica-prototype"
const pluginId = `${pluginName}@replica`
let cliExecutable = process.platform === "win32" ? "copilot.exe" : "copilot"
let cliArguments = []
const enableHelp =
  "Open Customization, select Installed in the top-left bar, and enable both the Replica plugin and the Replica extension. Start a fresh Copilot session if the canvas is still missing."

function npm(args, options) {
  if (process.platform !== "win32") return execFileSync("npm", args, options)
  // Windows npm shims require a shell. Run npm's JavaScript entrypoint instead.
  const entrypoint = process.env.npm_execpath ??
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  if (!isAbsolute(entrypoint) || !existsSync(entrypoint)) {
    throw new Error("Cannot find npm's JavaScript entrypoint. Use a Node.js installation that includes npm, then rerun setup.")
  }
  return execFileSync(process.execPath, [entrypoint, ...args], options)
}

function cli(args, timeout = 10_000) {
  return execFileSync(cliExecutable, [...cliArguments, "plugin", ...args], {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function installCli() {
  try {
    const prefix = npm(["prefix", "--global"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
    if (!isAbsolute(prefix)) {
      throw new Error("npm did not return an absolute global installation path.")
    }
    function locateCli() {
      if (process.platform !== "win32") {
        cliExecutable = join(prefix, "bin", "copilot")
        return existsSync(cliExecutable)
      }
      const directory = join(prefix, "node_modules", "@github", "copilot")
      const manifest = join(directory, "package.json")
      if (!existsSync(manifest)) return false
      const { bin } = JSON.parse(readFileSync(manifest, "utf8"))
      const entry = typeof bin === "string" ? bin : bin?.copilot
      if (typeof entry !== "string") throw new Error("Copilot CLI has no npm executable entrypoint.")
      const path = resolve(directory, entry)
      const local = relative(directory, path)
      if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`) || !existsSync(path)) {
        throw new Error("Copilot CLI has an invalid npm executable entrypoint.")
      }
      cliExecutable = process.execPath
      cliArguments = [path]
      return true
    }
    if (locateCli()) return installedPlugin()
    console.log("Copilot CLI was not found. Installing it globally with npm.")
    npm(["install", "-g", "@github/copilot"], {
      encoding: "utf8",
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (!locateCli()) throw new Error("Copilot CLI was not found after npm installation.")
    return installedPlugin()
  } catch (error) {
    throw new Error(
      `Copilot CLI installation failed: ${error.message}. Check that npm is available and its global installation directory is writable, or install Copilot CLI manually, then rerun setup.`,
      { cause: error },
    )
  }
}

function list(args) {
  const entries = JSON.parse(cli([...args, "list", "--json"]))
  if (!Array.isArray(entries)) {
    throw new Error("Copilot returned an unsupported plugin list. Check the installed CLI version.")
  }
  return entries
}

function installedPlugin() {
  const matches = list([]).filter((plugin) => plugin.name === pluginName)
  if (matches.length === 0) return undefined
  if (
    matches.length !== 1 ||
    matches[0].marketplace !== "replica" ||
    matches[0].source !== "installed" ||
    typeof matches[0].enabled !== "boolean"
  ) {
    throw new Error("A different or ambiguous Replica installation exists. Review it before setup.")
  }
  return matches[0]
}

function setup() {
  let installed
  try {
    installed = installedPlugin()
  } catch (error) {
    if (error.code !== "ENOENT" || error.path !== cliExecutable) throw error
    installed = installCli()
  }
  if (installed?.enabled) return

  if (!installed) {
    const marketplaces = list(["marketplace"]).filter(
      (marketplace) => marketplace.name === "replica",
    )
    if (
      marketplaces.length > 1 ||
      (marketplaces.length === 1 &&
        !/^GitHub: github\/replica(?:#[^\s]+)?$/.test(marketplaces[0].source))
    ) {
      throw new Error(
        "The replica marketplace source could not be verified as github/replica. Review it before setup.",
      )
    }
    if (marketplaces.length === 0) {
      cli(["marketplace", "add", "github/replica"], 60_000)
    }
    cli(["install", pluginId], 60_000)
  } else {
    cli(["enable", pluginId])
  }

  const result = installedPlugin()
  if (!result?.enabled) {
    throw new Error("Copilot did not report the Replica plugin installed and enabled after setup.")
  }
  console.log(`Replica plugin enabled for future sessions. ${enableHelp}`)
}

const startup = process.argv.includes("--startup")
let pluginError
try {
  setup()
} catch (error) {
  pluginError = error
  console.error(`Warning: Replica plugin setup failed: ${error.message}`)
  console.error(
    "The Replica canvas is not ready. App dependencies can still be installed with npm ci. Resolve the error above, then rerun node scripts/setup-replica-plugin.mjs. If Replica is absent from Customization > Installed, installation has not completed; enabling it there cannot fix this failure.",
  )
  if (!startup) process.exitCode = 1
}

if (startup) {
  let dependencyError
  try {
    npm(["ci"], {
      stdio: ["ignore", "inherit", "inherit"],
    })
  } catch (error) {
    dependencyError = error
    console.error(`App dependency installation failed: ${error.message}`)
    process.exitCode = error.status || 1
  }

  console.log("\nSetup summary")
  console.log(`App dependencies: ${dependencyError ? "failed" : "installed"}`)
  if (dependencyError) {
    console.log(`Reason: ${dependencyError.message}`)
    console.log("Next step: resolve the npm error above, then rerun npm ci.")
  }
  if (pluginError) {
    console.log("Replica canvas: unavailable")
    console.log(`Reason: ${pluginError.message}`)
    console.log(
      "Next step: resolve the Replica setup error above, then run node scripts/setup-replica-plugin.mjs.",
    )
  } else {
    console.log("Replica plugin: installed and enabled")
    console.log(`Canvas activation: ${enableHelp}`)
  }
}
