import { execFile } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { decodeUtf8, parseJson } from "./canonical-json.mjs"
import { createNoopConsolidator } from "./consolidators/noop.mjs"
import { createRecurrenceConsolidator } from "./consolidators/recurrence.mjs"
import { LearningError } from "./errors.mjs"
import { createCopilotLabeler } from "./labelers/copilot.mjs"
import { createInMemoryProvider } from "./providers/in-memory.mjs"
import { createJsonLinesMemoryProvider } from "./providers/json-lines.mjs"
import { createSqliteMemoryProvider } from "./providers/sqlite.mjs"
import { createLearningStore, scopeProblem } from "./store.mjs"

/**
 * The package's own consolidators, handed to a consolidator module's factory as its second
 * argument so a module can build on them without importing this package.
 */
export const BUILTIN_CONSOLIDATORS = Object.freeze({
  createNoopConsolidator,
  createRecurrenceConsolidator,
})

const run = promisify(execFile)

export const CONFIG_SCHEMA_VERSION = "replica.learning-config/v1"

/**
 * Find the checkout, the data directory, the optional config file, and the repository scope.
 * In a checkout the scope comes only from its origin remote, as its host and owner/name, so a
 * file an agent writes cannot point the store at another repository's records, and the same
 * owner/name on two hosts never shares them.
 *
 * A host such as Hub keeps each repository's store outside any checkout. It names the
 * repository with `repository` (host/owner/name) and the store with `directory`; Git is then
 * consulted only to keep the store out of a checkout's committed files.
 *
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, directory?: string, repository?: string }} [options]
 */
export async function resolveEnvironment({
  cwd = process.cwd(),
  env = process.env,
  directory,
  repository,
} = {}) {
  if (repository !== undefined)
    return resolveHostedEnvironment({
      cwd,
      directory: directory ?? env.REPLICA_LEARNING_DIR,
      repository,
    })
  const checkout = await git(cwd, ["rev-parse", "--show-toplevel"])
  const root = await realLocation(checkout ?? path.resolve(cwd))
  const chosen = directory ?? env.REPLICA_LEARNING_DIR
  const dataDirectory = await realLocation(
    chosen ? path.resolve(cwd, chosen) : path.join(root, ".replica", "learning"),
  )
  const configPath = path.join(dataDirectory, "config.json")
  const config = await readConfig(configPath)
  const remote = await git(root, ["config", "--get", "remote.origin.url"])
  const scope = remote ? scopeFromRemote(remote) : null
  const placement = placeIn(root, dataDirectory)
  return {
    hosted: false,
    root,
    checkout: checkout ? root : null,
    dataDirectory,
    configPath,
    configFound: config !== null,
    config: config ?? {},
    scope,
    scopeSource: remote ? `git remote origin (${withoutCredentials(remote)})` : null,
    insideCheckout: placement.inside,
    underReplica: placement.underReplica,
    ignoredByGit: placement.inside
      ? await isIgnoredByGit(root, placement.relative, { directory: true })
      : null,
  }
}

/** The environment for a store a host names, with no checkout behind it. */
async function resolveHostedEnvironment({ cwd, directory, repository }) {
  if (!directory)
    throw new LearningError(
      "invalid_input",
      "--repository needs --dir, the directory that holds this repository's learning data.",
    )
  const scope = scopeFromName(repository)
  if (!scope)
    throw new LearningError(
      "invalid_input",
      `--repository must be host/owner/name, such as github.com/acme/prototypes, not ${JSON.stringify(repository)}.`,
    )
  const dataDirectory = await realLocation(path.resolve(cwd, directory))
  const configPath = path.join(dataDirectory, "config.json")
  const config = await readConfig(configPath)
  const checkout = await checkoutAround(dataDirectory)
  const placement = checkout ? placeIn(checkout, dataDirectory) : null
  return {
    hosted: true,
    root: dataDirectory,
    checkout,
    dataDirectory,
    configPath,
    configFound: config !== null,
    config: config ?? {},
    scope,
    scopeSource: "--repository",
    insideCheckout: Boolean(placement?.inside),
    underReplica: Boolean(placement?.underReplica),
    ignoredByGit: placement?.inside
      ? await isIgnoredByGit(checkout, placement.relative, { directory: true })
      : null,
  }
}

/** The root of the Git checkout that holds target, or null when none does. */
async function checkoutAround(target) {
  let current = path.resolve(target)
  while (!(await stat(current).catch(() => null))?.isDirectory()) {
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
  const top = await git(current, ["rev-parse", "--show-toplevel"])
  return top ? realLocation(top) : null
}

/**
 * Where a path sits relative to the checkout. Inside a checkout, learning data and exports
 * belong only under .replica/ at its root: Git may ignore other places, such as
 * public/.replica, that a dev server or build still serves.
 */
export function placeIn(root, target) {
  const relative = path.relative(root, target)
  const inside =
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  const underReplica =
    inside && (relative === ".replica" || relative.startsWith(`.replica${path.sep}`))
  return { inside, underReplica, relative: relative || "." }
}

/** A path with every existing parent resolved through symbolic links. */
export async function realLocation(target) {
  const absolute = path.resolve(target)
  const missing = []
  let current = absolute
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing.reverse())
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      const parent = path.dirname(current)
      if (parent === current) return absolute
      missing.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * The repository scope a Git remote names: its lowercase host, without a port, and owner/name.
 * Null when either part is missing or malformed, so the CLI refuses to guess.
 */
export function scopeFromRemote(remote) {
  const host = /^(?:[a-z+]+:\/\/(?:[^/]*@)?([^/:@]+)|[^@\s/]+@([^:\s/]+):)/i.exec(remote.trim())
  const repository = repositoryFromRemote(remote)
  if (!host || !repository) return null
  const scope = { host: (host[1] ?? host[2]).toLowerCase(), repository }
  return scopeProblem(scope) ? null : scope
}

/** A remote URL without its user name or password, safe to print. */
export function withoutCredentials(remote) {
  return remote.trim().replace(/^([a-z+]+:\/\/)[^/]*@/i, "$1")
}

/**
 * The scope a host names as host/owner/name, such as github.com/acme/prototypes, in lowercase.
 * Null when it is malformed, so the command refuses to guess.
 */
export function scopeFromName(name) {
  const match = /^([^/\s]+)\/([^/\s]+)\/([^/\s]+)$/.exec(String(name ?? "").trim())
  if (!match) return null
  const scope = {
    host: match[1].toLowerCase(),
    repository: `${match[2]}/${match[3]}`.toLowerCase(),
  }
  return scopeProblem(scope) ? null : scope
}

/**
 * Why learning data or an export may not be written at target, or null when it may. Inside a
 * Git checkout Git must ignore it, so review evidence is never committed. A checkout's own
 * store also keeps it under .replica/, because Git may ignore other places, such as
 * public/.replica, that a dev server or build still serves. A host that names the repository
 * chooses a directory outside what it serves.
 */
export async function placementProblem(
  environment,
  target,
  { what = "learning data", directory = true } = {},
) {
  const checkout = environment.hosted ? await checkoutAround(target) : environment.checkout
  if (!checkout) return null
  const placement = placeIn(checkout, target)
  if (!placement.inside) return null
  if (!environment.hosted && !placement.underReplica)
    return `${target} is inside the checkout but not under .replica/. Keep ${what} in .replica/, which no dev server or build serves.`
  if ((await isIgnoredByGit(checkout, placement.relative, { directory })) !== true)
    return environment.hosted
      ? `${target} is inside the checkout at ${checkout} but Git does not ignore it. Choose a directory Git ignores so review evidence is never committed.`
      : `${target} is inside the checkout but Git does not ignore it. Add .replica/ to .gitignore so review evidence is never committed.`
  return null
}

/**
 * Whether Git ignores a path in the checkout, or null when Git cannot say. A directory is
 * checked with a trailing slash, so patterns such as .replica/ match it before it exists.
 */
export async function isIgnoredByGit(root, relative, { directory = false } = {}) {
  const target = `${relative.split(path.sep).join("/")}${directory ? "/" : ""}`
  try {
    await run("git", ["-C", root, "check-ignore", "-q", "--no-index", target], {
      timeout: 10_000,
    })
    return true
  } catch (error) {
    return error.code === 1 ? false : null
  }
}

/** owner/name in lowercase from an HTTPS, SSH, or scp-style Git remote URL. */
export function repositoryFromRemote(remote) {
  const match =
    /^(?:[a-z+]+:\/\/(?:[^/]*@)?[^/@]+\/|[^@\s/]+@[^:\s/]+:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      remote.trim(),
    )
  if (!match) return null
  const repository = `${match[1]}/${match[2]}`.toLowerCase()
  return /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(repository) ? repository : null
}

/**
 * Open the learning store for a resolved environment. Refuses a checkout with no usable
 * scope, and data inside the checkout that is outside .replica/ or that Git would commit.
 *
 * @param {Awaited<ReturnType<typeof resolveEnvironment>>} environment
 * @param {{ clock?: () => number }} [options]
 */
export async function openLearningStore(environment, { clock = Date.now } = {}) {
  if (!environment.scope)
    throw new LearningError(
      "invalid_input",
      environment.scopeSource
        ? `Cannot read a host and owner/name from ${environment.scopeSource}, so the repository scope is unknown.`
        : "This checkout has no origin remote, so its repository scope is unknown. Add the GitHub remote as origin.",
    )
  const problem = await placementProblem(environment, environment.dataDirectory)
  if (problem) throw new LearningError("invalid_input", problem)
  const { provider, source } = await openProvider(environment)
  try {
    return { store: await createLearningStore({ provider, clock }), providerSource: source }
  } catch (error) {
    await provider.close?.()
    throw error
  }
}

/** Open the configured memory provider. The default is one SQLite file. */
export async function openProvider(environment) {
  const choice = environment.config.memory?.provider ?? "sqlite"
  if (choice === "sqlite")
    return {
      provider: createSqliteMemoryProvider({ directory: environment.dataDirectory }),
      source: "built-in sqlite",
    }
  if (choice === "jsonl")
    return {
      provider: createJsonLinesMemoryProvider({ directory: environment.dataDirectory }),
      source: "built-in jsonl",
    }
  if (choice === "in-memory")
    return { provider: createInMemoryProvider(), source: "built-in in-memory" }
  const factory = await loadFactory(environment, choice, "createMemoryProvider", "memory.provider")
  const provider = await factory({
    ...(choice.options ?? {}),
    dataDirectory: environment.dataDirectory,
  })
  return { provider, source: `module ${choice.module}` }
}

/** Open the configured consolidator. The default is the recurrence consolidator. */
export async function openConsolidator(environment) {
  const choice = environment.config.consolidation?.consolidator ?? "recurrence"
  const options = environment.config.consolidation?.options ?? {}
  if (choice === "recurrence")
    return { consolidator: createRecurrenceConsolidator(options), source: "built-in recurrence" }
  if (choice === "none") return { consolidator: createNoopConsolidator(), source: "built-in none" }
  const factory = await loadFactory(
    environment,
    choice,
    "createConsolidator",
    "consolidation.consolidator",
  )
  return {
    consolidator: await factory(options, BUILTIN_CONSOLIDATORS),
    source: `module ${choice.module}`,
  }
}

/**
 * Open the configured labeler, which labels review comments that no one labeled yet. The
 * default is Copilot. Its credential comes only from COPILOT_GITHUB_TOKEN in the environment,
 * never from the config file; without it, Copilot uses whoever is signed in on this machine.
 *
 * @param {Awaited<ReturnType<typeof resolveEnvironment>>} environment
 * @param {{ env?: Record<string, string | undefined>, model?: string }} [options]
 */
export async function openLabeler(environment, { env = process.env, model } = {}) {
  const choice = environment.config.labeling?.labeler ?? "copilot"
  const options = { ...(environment.config.labeling?.options ?? {}), ...(model ? { model } : {}) }
  if (choice === "copilot") {
    const unknown = Object.keys(options).filter((key) => !["model", "timeoutMs"].includes(key))
    if (unknown.length)
      throw new LearningError(
        "invalid_input",
        `labeling.options for Copilot take model and timeoutMs, not ${unknown.join(", ")}.`,
      )
    return {
      labeler: createCopilotLabeler({
        model: options.model,
        timeoutMs: options.timeoutMs,
        token: env.COPILOT_GITHUB_TOKEN || undefined,
      }),
      source: "built-in copilot",
    }
  }
  const factory = await loadFactory(environment, choice, "createLabeler", "labeling.labeler")
  return { labeler: await factory(options), source: `module ${choice.module}` }
}

async function readConfig(configPath) {
  let bytes
  try {
    bytes = await readFile(configPath)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  const config = parseJson(decodeUtf8(bytes, configPath), configPath)
  const allowed = ["schemaVersion", "memory", "consolidation", "labeling"]
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    config.schemaVersion !== CONFIG_SCHEMA_VERSION
  )
    throw new LearningError(
      "invalid_input",
      `${configPath} must be an object with "schemaVersion": "${CONFIG_SCHEMA_VERSION}".`,
    )
  const unknown = Object.keys(config).filter((key) => !allowed.includes(key))
  if (unknown.length)
    throw new LearningError(
      "invalid_input",
      `${configPath} has unknown settings: ${unknown.join(", ")}.`,
    )
  return config
}

async function loadFactory(environment, choice, defaultExport, label) {
  if (!choice || typeof choice !== "object" || typeof choice.module !== "string")
    throw new LearningError(
      "invalid_input",
      `${label} must be a built-in name or { "module": "./path.mjs" }.`,
    )
  if (!choice.module.startsWith("./") && !choice.module.startsWith("../"))
    throw new LearningError(
      "invalid_input",
      `${label}.module must be a relative path inside the repository.`,
    )
  const requested = path.resolve(environment.root, choice.module)
  if (!(await stat(requested).catch(() => null))?.isFile())
    throw new LearningError("invalid_input", `${label}.module ${choice.module} does not exist.`)
  const file = await realpath(requested)
  if (!placeIn(environment.root, file).inside)
    throw new LearningError(
      "invalid_input",
      `${label}.module must stay inside ${environment.root}, after following links.`,
    )
  const module = await import(pathToFileURL(file).href)
  const factory = module[choice.export ?? defaultExport]
  if (typeof factory !== "function")
    throw new LearningError(
      "invalid_input",
      `${choice.module} does not export ${choice.export ?? defaultExport}().`,
    )
  return factory
}

async function git(cwd, args) {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 10_000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}
