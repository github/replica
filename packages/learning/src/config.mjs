import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { canonicalJson, decodeUtf8, digestOf, parseJson } from "./canonical-json.mjs"
import { createNoopConsolidator } from "./consolidators/noop.mjs"
import { createRecurrenceConsolidator } from "./consolidators/recurrence.mjs"
import { LearningError } from "./errors.mjs"
import { createCopilotLabeler } from "./labelers/copilot.mjs"
import { STREAMS } from "./provider-contract.mjs"
import { createInMemoryProvider } from "./providers/in-memory.mjs"
import { createJsonLinesMemoryProvider } from "./providers/json-lines.mjs"
import { createFileLock } from "./providers/lock.mjs"
import { createPostgresMemoryProvider } from "./providers/postgres.mjs"
import { createSqliteMemoryProvider } from "./providers/sqlite.mjs"
import { migrateRepositoryScope } from "./scope-migration.mjs"
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
 * In a checkout the origin remote identifies the repository. Its GitHub ID is saved with the
 * remote so later commands can use the same scope without a network request.
 *
 * A host such as Hub keeps each repository's store outside any checkout. It names the
 * repository with `repository` (github.com/repositories/ID) and the store with `directory`; Git is then
 * consulted only to keep the store out of a checkout's committed files.
 *
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, directory?: string, repository?: string, legacyRepository?: string, resolveIdentity?: boolean }} [options]
 */
export async function resolveEnvironment({
  cwd = process.cwd(),
  env = process.env,
  directory,
  repository,
  legacyRepository,
  legacyRedaction = false,
  resolveIdentity = true,
} = {}) {
  if (legacyRedaction)
    return resolveHostedEnvironment({
      cwd,
      directory: directory ?? env.REPLICA_LEARNING_DIR,
      repository: legacyRepository,
      legacyRedaction: true,
      env,
    })
  if (repository !== undefined)
    return resolveHostedEnvironment({
      cwd,
      directory: directory ?? env.REPLICA_LEARNING_DIR,
      repository,
      legacyRepository,
      env,
    })
  const requestedLegacyScope =
    legacyRepository === undefined ? null : legacyScopeFromName(legacyRepository)
  if (legacyRepository !== undefined && requestedLegacyScope?.host !== "github.com")
    throw new LearningError("invalid_input", "--legacy-repository must name a GitHub repository.")
  const checkout = await git(cwd, ["rev-parse", "--show-toplevel"])
  const root = await realLocation(checkout ?? path.resolve(cwd))
  const chosen = directory ?? env.REPLICA_LEARNING_DIR
  const dataDirectory = await realLocation(
    chosen ? path.resolve(cwd, chosen) : path.join(root, ".replica", "learning"),
  )
  const configPath = path.join(dataDirectory, "config.json")
  const config = await readConfig(configPath)
  const remote = await git(root, ["config", "--get", "remote.origin.url"])
  const originScope = remote ? scopeFromRemote(remote) : null
  const placement = placeIn(root, dataDirectory)
  const environment = {
    hosted: false,
    root,
    checkout: checkout ? root : null,
    dataDirectory,
    configPath,
    configFound: config !== null,
    config: config ?? {},
    env: { REPLICA_LEARNING_DATABASE_URL: env.REPLICA_LEARNING_DATABASE_URL },
    scope: null,
    sourceRepository: originScope?.repository ?? null,
    legacyScope: originScope,
    explicitLegacyScope: legacyRepository !== undefined,
    scopeSource: remote ? `git remote origin (${withoutCredentials(remote)})` : null,
    insideCheckout: placement.inside,
    underReplica: placement.underReplica,
    ignoredByGit: placement.inside
      ? await isIgnoredByGit(root, placement.relative, { directory: true })
      : null,
  }
  if (!resolveIdentity || !originScope || originScope.host !== "github.com") return environment
  const problem = await placementProblem(environment, dataDirectory)
  if (problem) return environment
  const identity = await resolveGitHubIdentity(environment, originScope, env)
  environment.scope = { host: "github.com", repository: `repositories/${identity.id}` }
  environment.legacyScope = requestedLegacyScope ?? {
    host: "github.com",
    repository: identity.legacyRepository,
  }
  environment.config = identity.config
  environment.configFound = true
  return environment
}

/** The environment for a store a host names, with no checkout behind it. */
async function resolveHostedEnvironment({
  cwd,
  directory,
  repository,
  legacyRepository,
  legacyRedaction = false,
  env,
}) {
  if (!directory)
    throw new LearningError(
      "invalid_input",
      "--repository needs --dir, the directory that holds this repository's learning data.",
    )
  const scope = legacyRedaction ? legacyScopeFromName(repository) : scopeFromName(repository)
  if (
    legacyRedaction &&
    (scope?.host !== "github.com" ||
      !/^repositories\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        scope.repository,
      ))
  )
    throw new LearningError(
      "invalid_input",
      "Legacy redaction needs the Hub repository UUID as github.com/repositories/<uuid>.",
    )
  if (!scope)
    throw new LearningError(
      "invalid_input",
      `--repository must be github.com/repositories/<numeric GitHub repository ID>, not ${JSON.stringify(repository)}.`,
    )
  const legacyScope = legacyRepository === undefined ? null : legacyScopeFromName(legacyRepository)
  if (legacyRepository !== undefined && legacyScope?.host !== "github.com")
    throw new LearningError("invalid_input", "--legacy-repository must name a GitHub repository.")
  const dataDirectory = await realLocation(path.resolve(cwd, directory))
  const configPath = path.join(dataDirectory, "config.json")
  const config = await readConfig(configPath)
  const checkout = await checkoutAround(dataDirectory)
  const placement = checkout ? placeIn(checkout, dataDirectory) : null
  return {
    hosted: true,
    legacyRedaction,
    root: dataDirectory,
    checkout,
    dataDirectory,
    configPath,
    configFound: config !== null,
    config: config ?? {},
    env: { REPLICA_LEARNING_DATABASE_URL: env.REPLICA_LEARNING_DATABASE_URL },
    scope,
    legacyScope,
    explicitLegacyScope: legacyRepository !== undefined,
    sourceRepository: legacyScope?.repository ?? scope.repository,
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
 * The stable GitHub repository scope a host names. Null when it is malformed.
 */
export function scopeFromName(name) {
  const match = /^github\.com\/repositories\/([1-9][0-9]*)$/.exec(String(name ?? "").trim())
  if (!match) return null
  return { host: "github.com", repository: `repositories/${match[1]}` }
}

function legacyScopeFromName(name) {
  const match = /^([^/\s]+)\/([^/\s]+)\/([^/\s]+)$/.exec(String(name ?? "").trim())
  if (!match) return null
  const scope = {
    host: match[1].toLowerCase(),
    repository: `${match[2]}/${match[3]}`.toLowerCase(),
  }
  return scopeProblem(scope) ? null : scope
}

async function resolveGitHubIdentity(environment, originScope, env) {
  const remote = `${originScope.host}/${originScope.repository}`
  const cached = environment.config.githubRepository
  if (cached?.remote === remote) return { ...cached, config: environment.config }
  await mkdir(environment.dataDirectory, { recursive: true, mode: 0o700 })
  const directory = await lstat(environment.dataDirectory)
  if (!directory.isDirectory() || (process.platform !== "win32" && (directory.mode & 0o077) !== 0))
    throw new LearningError(
      "storage_corrupt",
      `${environment.dataDirectory} must be a private directory.`,
    )
  const lock = createFileLock({ path: path.join(environment.dataDirectory, ".config.lock") })
  return lock.run(async () => {
    const config = (await readConfig(environment.configPath)) ?? {
      schemaVersion: CONFIG_SCHEMA_VERSION,
    }
    if (config.githubRepository?.remote === remote) return { ...config.githubRepository, config }
    let id
    try {
      const { stdout } = await run(
        "gh",
        ["api", "--hostname", "github.com", `repos/${originScope.repository}`, "--jq", ".id"],
        { cwd: environment.root, env, timeout: 15_000 },
      )
      id = stdout.trim()
    } catch {
      throw new LearningError(
        "unavailable",
        `Cannot look up the GitHub repository ID for ${remote}. Sign in with gh and try again.`,
      )
    }
    if (!/^[1-9][0-9]*$/.test(id))
      throw new LearningError(
        "invalid_input",
        `GitHub returned an invalid repository ID for ${remote}.`,
      )
    const githubRepository = {
      id,
      remote,
      legacyRepository:
        config.githubRepository?.id === id
          ? config.githubRepository.legacyRepository
          : originScope.repository,
      ...(config.githubRepository?.id === id && config.githubRepository.legacyConfirmed
        ? { legacyConfirmed: true }
        : {}),
    }
    const updated = { ...config, githubRepository }
    const current = (await readConfig(environment.configPath)) ?? {
      schemaVersion: CONFIG_SCHEMA_VERSION,
    }
    if (canonicalJson(current) !== canonicalJson(config))
      throw new LearningError("conflict", "The learning configuration changed. Try again.")
    await writePrivateConfig(environment.configPath, updated)
    return { ...githubRepository, config: updated }
  })
}

async function writePrivateConfig(target, config) {
  const existing = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null
    throw error
  })
  if (existing && (!existing.isFile() || existing.nlink !== 1))
    throw new LearningError("storage_corrupt", `${target} must be a private regular file.`)
  const temporary = `${target}.${randomBytes(12).toString("hex")}.tmp`
  let handle
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, target)
    if (process.platform !== "win32") {
      try {
        const directory = await open(path.dirname(target), "r")
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      } catch {
        throw new LearningError(
          "storage_outcome_unknown",
          "The configuration may have changed, but its directory could not be synced. Read it before retrying.",
        )
      }
    }
  } finally {
    await handle?.close()
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error
    })
  }
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
  const checkout = await checkoutAround(target)
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
    await run("git", ["-C", root, "check-ignore", "-q", "--no-index", target], { timeout: 10_000 })
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
  const problem = await placementProblem(environment, environment.dataDirectory)
  if (problem) throw new LearningError("invalid_input", problem)
  if (!environment.scope)
    throw new LearningError(
      "invalid_input",
      environment.scopeSource
        ? `Cannot read a host and owner/name from ${environment.scopeSource}, so the repository scope is unknown.`
        : "This checkout has no origin remote, so its repository scope is unknown. Add the GitHub remote as origin.",
    )
  const migration = environment.config.memory?.migration
  if (migration && migration.repository !== environment.scope.repository)
    throw new LearningError(
      "conflict",
      "This migrated store belongs to another repository. Restore the original provider to migrate that repository.",
    )
  const { provider, source } = await openProvider(environment)
  try {
    let result = null
    if (
      !environment.hosted &&
      !environment.config.githubRepository?.legacyConfirmed &&
      source.startsWith("module ") &&
      typeof provider.legacyScopes !== "function"
    )
      throw new LearningError(
        "conflict",
        "This provider cannot discover old repository names. Stop older clients and run migrate-scope --offline with --legacy-repository, or --empty for a new store.",
      )
    if (environment.legacyScope && typeof provider.migrateScope === "function") {
      if (!environment.hosted && !environment.config.githubRepository?.legacyConfirmed) {
        const scopes =
          typeof provider.legacyScopes === "function" ? await provider.legacyScopes() : []
        const query = { scope: environment.legacyScope }
        const records = await Promise.all([
          ...Object.keys(STREAMS).map((stream) => provider.readRecords(stream, query)),
          provider.readMemoryVersions(query),
        ])
        if (scopes.length || records.some((items) => items.length))
          throw new LearningError(
            "conflict",
            "Confirm which repository owns the old learning data, stop older clients, then run replica-learning migrate-scope --offline.",
          )
      }
      const previous =
        typeof provider.scopeMigrationFrom === "function"
          ? await provider.scopeMigrationFrom(environment.legacyScope)
          : null
      if (previous) {
        if (
          !previous.oldScope ||
          canonicalJson(previous.oldScope) !== canonicalJson(environment.legacyScope)
        )
          throw new LearningError("storage_corrupt", "The repository migration mapping is invalid.")
        if (
          !previous.newScope ||
          canonicalJson(previous.newScope) !== canonicalJson(environment.scope)
        )
          throw new LearningError("conflict", "The old scope was migrated to another repository.")
      }
      if (previous && canonicalJson(environment.legacyScope) !== canonicalJson(environment.scope))
        result = previous
      else
        result = await migrateRepositoryScope({
          provider,
          oldScope: environment.legacyScope,
          newScope: environment.scope,
          clock,
        })
    } else if (environment.legacyScope) {
      const query = { scope: environment.legacyScope }
      const scopes =
        !environment.hosted && typeof provider.legacyScopes === "function"
          ? await provider.legacyScopes()
          : []
      const records = await Promise.all([
        ...Object.keys(STREAMS).map((stream) => provider.readRecords(stream, query)),
        provider.readMemoryVersions(query),
      ])
      if (scopes.length || records.some((items) => items.length))
        throw new LearningError(
          "unsupported",
          "This store has data under its old repository scope. Stop older clients, then run replica-learning migrate-scope --offline.",
        )
    }
    const migrations =
      typeof provider.scopeMigrations === "function"
        ? await provider.scopeMigrations(environment.scope)
        : result
          ? [result]
          : []
    const digestMappings = Object.fromEntries(
      migrations
        .flatMap((migration) => migration.digestMappings ?? [])
        .filter((entry) => entry.kind === "memory" && entry.field === "digest")
        .map((entry) => [entry.oldDigest, entry.newDigest]),
    )
    return {
      store: await createLearningStore({
        provider,
        clock,
        legacyScopes: migrations.map((migration) => migration.oldScope),
        digestMappings,
      }),
      providerSource: source,
      migrationRedactionFollowUps: migrations
        .map((item) => item.redactionFollowUps)
        .filter(Boolean),
    }
  } catch (error) {
    await provider.close?.()
    throw error
  }
}

/** Open only the known Hub store for a deleted-comment maintenance operation. */
export async function openLegacyRedactionStore(environment, { clock = Date.now } = {}) {
  const problem = await placementProblem(environment, environment.dataDirectory)
  if (problem) throw new LearningError("invalid_input", problem)
  if (!environment.legacyRedaction)
    throw new LearningError("invalid_input", "This is not a legacy redaction request.")
  const { provider } = await openProvider(environment)
  try {
    if (
      typeof provider.scopeMigrationFrom !== "function" &&
      (typeof provider.migrateScope === "function" || environment.config.memory?.migration)
    )
      throw new LearningError(
        "conflict",
        "The store cannot identify the migrated repository scope for redaction.",
      )
    const migration = await provider.scopeMigrationFrom?.(environment.scope)
    if (migration) {
      const target = scopeFromName(`github.com/${migration.newScope?.repository}`)
      if (
        canonicalJson(migration.oldScope) !== canonicalJson(environment.scope) ||
        !target ||
        canonicalJson(migration.newScope) !== canonicalJson(target) ||
        (environment.config.memory?.migration &&
          environment.config.memory.migration.repository !== migration.newScope.repository)
      )
        throw new LearningError("storage_corrupt", "The repository migration mapping is invalid.")
      environment.scope = target
    } else if (environment.config.memory?.migration)
      throw new LearningError(
        "conflict",
        "The migrated store has no mapping for this Hub repository.",
      )
    return { store: await createLearningStore({ provider, clock }) }
  } catch (error) {
    await provider.close?.()
    throw error
  }
}

/** Open the configured memory provider. The default is one SQLite file. */
export async function openProvider(environment) {
  const choice = environment.config.memory?.provider ?? "sqlite"
  if (choice?.builtin === "sqlite" && typeof choice.file !== "string")
    throw new LearningError("invalid_input", "A migrated SQLite provider needs its file name.")
  if (choice === "sqlite" || choice?.builtin === "sqlite")
    return {
      provider: createSqliteMemoryProvider({
        directory: environment.dataDirectory,
        ...(choice === "sqlite" ? {} : { file: choice.file }),
      }),
      source: "built-in sqlite",
    }
  if (choice === "jsonl")
    return {
      provider: createJsonLinesMemoryProvider({ directory: environment.dataDirectory }),
      source: "built-in jsonl",
    }
  if (choice === "in-memory")
    return { provider: createInMemoryProvider(), source: "built-in in-memory" }
  if (choice === "postgres")
    return {
      provider: createPostgresMemoryProvider({
        connectionString: environment.env?.REPLICA_LEARNING_DATABASE_URL,
      }),
      source: "built-in postgres",
    }
  const factory = await loadFactory(environment, choice, "createMemoryProvider", "memory.provider")
  const provider = await factory({
    ...(choice.options ?? {}),
    dataDirectory: environment.dataDirectory,
  })
  return { provider, source: `module ${choice.module}` }
}

/**
 * Copy one offline legacy store into SQLite without changing the source. The caller must stop
 * older clients first; provider contracts cannot prevent an old client from writing later.
 */
export async function migrateScopeOffline(environment, { clock = Date.now, empty = false } = {}) {
  const problem = await placementProblem(environment, environment.dataDirectory)
  if (problem) throw new LearningError("invalid_input", problem)
  if (!environment.scope || !environment.legacyScope)
    throw new LearningError("invalid_input", "This store needs both old and new repository scopes.")
  const lock = createFileLock({ path: path.join(environment.dataDirectory, ".config.lock") })
  return lock.run(async () => {
    const config = await readConfig(environment.configPath)
    if (!config || canonicalJson(config) !== canonicalJson(environment.config))
      throw new LearningError("conflict", "The learning configuration changed. Try again.")
    if (config.memory?.migration) {
      if (
        config.memory.migration.repository !== environment.scope.repository ||
        config.memory.provider?.builtin !== "sqlite"
      )
        throw new LearningError("conflict", "This configuration names another migrated store.")
      if (empty) throw new LearningError("invalid_input", "This store has already been migrated.")
      if (!environment.explicitLegacyScope) {
        const { store } = await openLearningStore(environment, { clock })
        let redactionFollowUps
        try {
          const context = {
            scope: environment.scope,
            principal: { kind: "system", id: "system:scope-migration" },
          }
          const verified = await store.verify(context)
          if (!verified.ok) throw new LearningError("storage_corrupt", verified.problems.join("; "))
          redactionFollowUps = (await store.status(context)).migrationRedactionFollowUps
        } finally {
          await store.close()
        }
        return {
          file: path.join(environment.dataDirectory, config.memory.provider.file),
          sourceProvider: config.memory.migration.sourceProvider,
          alreadyMigrated: true,
          ...(redactionFollowUps ? { redactionFollowUps } : {}),
        }
      }
    }
    const sourceEnvironment = config.memory?.migration
      ? {
          ...environment,
          config: {
            ...config,
            memory: { ...config.memory, provider: config.memory.migration.sourceProvider },
          },
        }
      : environment
    const { provider: source, source: sourceDescription } = await openProvider(sourceEnvironment)
    let destination
    let file
    let createdFile = false
    let switched = false
    let sourceClosed = false
    try {
      if (
        !environment.hosted &&
        sourceDescription.startsWith("module ") &&
        typeof source.legacyScopes !== "function" &&
        !environment.explicitLegacyScope &&
        !empty
      )
        throw new LearningError(
          "conflict",
          "Name the old repository with --legacy-repository, or use --empty to confirm this is a new store.",
        )
      const scopes = typeof source.legacyScopes === "function" ? await source.legacyScopes() : []
      if (config.memory?.migration)
        destination = createSqliteMemoryProvider({
          directory: environment.dataDirectory,
          file: config.memory.provider.file,
        })
      const migrations = config.memory?.migration
        ? await destination.scopeMigrations(environment.scope)
        : typeof source.scopeMigrations === "function"
          ? await source.scopeMigrations(environment.scope)
          : []
      const selectedScopeExists = scopes.some(
        (scope) => canonicalJson(scope) === canonicalJson(environment.legacyScope),
      )
      const selectedScopeMigrated = migrations.some(
        (migration) => canonicalJson(migration.oldScope) === canonicalJson(environment.legacyScope),
      )
      if (
        (scopes.length ||
          (environment.explicitLegacyScope && typeof source.legacyScopes === "function")) &&
        !selectedScopeExists &&
        !selectedScopeMigrated
      )
        throw new LearningError(
          "conflict",
          "No data matches that old repository name. Choose it with --legacy-repository github.com/owner/name.",
        )
      const confirmedConfig = environment.hosted
        ? config
        : {
            ...config,
            githubRepository: {
              ...config.githubRepository,
              legacyRepository: environment.legacyScope.repository,
              legacyConfirmed: true,
            },
          }
      if (typeof source.migrateScope === "function") {
        if (sourceDescription.startsWith("module ") && typeof source.legacyScopes !== "function") {
          const old = await readScope(source, environment.legacyScope)
          const current = await readScope(source, environment.scope)
          const oldHasRecords =
            Object.values(old.records).some((records) => records.length) || old.memories.length > 0
          const currentHasRecords =
            Object.values(current.records).some((records) => records.length) ||
            current.memories.length > 0
          if (empty) {
            if (oldHasRecords || currentHasRecords)
              throw new LearningError(
                "conflict",
                "This store is not empty; its data was not changed.",
              )
            await writePrivateConfig(environment.configPath, confirmedConfig)
            return { empty: true }
          }
          if (!oldHasRecords)
            throw new LearningError(
              "not_found",
              "No old data matches that repository name; the provider was not changed.",
            )
        } else if (empty)
          throw new LearningError("invalid_input", "--empty is not needed for this provider.")
        const result = await migrateRepositoryScope({
          provider: source,
          oldScope: environment.legacyScope,
          newScope: environment.scope,
          clock,
        })
        if (!environment.hosted) await writePrivateConfig(environment.configPath, confirmedConfig)
        return {
          file: source.manifest().storage.location,
          migrated: result.migrated,
          ...(result.redactionFollowUps ? { redactionFollowUps: result.redactionFollowUps } : {}),
        }
      }
      async function readScope(provider, scope) {
        return {
          records: Object.fromEntries(
            await Promise.all(
              Object.keys(STREAMS).map(async (stream) => [
                stream,
                await provider.readRecords(stream, { scope }),
              ]),
            ),
          ),
          memories: await provider.readMemoryVersions({ scope }),
        }
      }
      const old = await readScope(source, environment.legacyScope)
      const current = await readScope(source, environment.scope)
      const oldHasRecords =
        Object.values(old.records).some((records) => records.length) || old.memories.length > 0
      const currentHasRecords =
        Object.values(current.records).some((records) => records.length) ||
        current.memories.length > 0
      if (empty) {
        if (scopes.length || oldHasRecords || currentHasRecords)
          throw new LearningError("conflict", "This store is not empty; its data was not changed.")
        if (environment.hosted)
          throw new LearningError("invalid_input", "--empty is only for a new checkout store.")
        await writePrivateConfig(environment.configPath, confirmedConfig)
        return { empty: true }
      }
      if (!oldHasRecords)
        throw new LearningError(
          "not_found",
          "No old data matches that repository name; the provider was not changed.",
        )
      if (config.memory?.migration) {
        const previous = migrations.find(
          (migration) =>
            canonicalJson(migration.oldScope) === canonicalJson(environment.legacyScope),
        )
        if (previous) {
          if (previous.sourceDigest !== digestOf(old))
            throw new LearningError(
              "conflict",
              "The original source changed after migration. Keep it offline and investigate before retrying.",
            )
          return {
            file: path.join(environment.dataDirectory, config.memory.provider.file),
            sourceProvider: config.memory.migration.sourceProvider,
            alreadyMigrated: true,
            ...(previous.redactionFollowUps
              ? { redactionFollowUps: previous.redactionFollowUps }
              : {}),
          }
        }
      }
      if (currentHasRecords)
        throw new LearningError("conflict", "The new repository scope already contains records.")
      const originalStore = await createLearningStore({ provider: source, clock })
      const verified = await originalStore.verify({
        scope: environment.legacyScope,
        principal: { kind: "system", id: "system:scope-migration" },
      })
      if (!verified.ok)
        throw new LearningError(
          "storage_corrupt",
          `Scope migration refused: ${verified.problems.join("; ")}`,
        )
      if (config.memory?.migration) {
        const result = await migrateRepositoryScope({
          provider: destination,
          oldScope: environment.legacyScope,
          newScope: environment.scope,
          clock,
          sourceSnapshot: old,
          beforeCommit: async () => {
            if (
              canonicalJson(await readScope(source, environment.legacyScope)) !==
                canonicalJson(old) ||
              canonicalJson(await readScope(source, environment.scope)) !== canonicalJson(current)
            )
              throw new LearningError(
                "conflict",
                "The source changed during migration. Try again offline.",
              )
            if (canonicalJson(await readConfig(environment.configPath)) !== canonicalJson(config))
              throw new LearningError("conflict", "The learning configuration changed. Try again.")
          },
        })
        await writePrivateConfig(environment.configPath, confirmedConfig)
        return {
          file: path.join(environment.dataDirectory, config.memory.provider.file),
          sourceProvider: config.memory.migration.sourceProvider,
          ...(result.redactionFollowUps ? { redactionFollowUps: result.redactionFollowUps } : {}),
        }
      }
      file = `scope-migration-${randomBytes(12).toString("hex")}.sqlite`
      const target = path.join(environment.dataDirectory, file)
      const handle = await open(
        target,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      )
      createdFile = true
      await handle.close()
      destination = createSqliteMemoryProvider({ directory: environment.dataDirectory, file })
      await destination.appendBatch(old.records)
      for (const record of old.memories)
        await destination.appendMemoryVersion(record, {
          expectedPreviousDigest: record.previousDigest ?? null,
        })
      if (
        canonicalJson(await readScope(destination, environment.legacyScope)) !== canonicalJson(old)
      )
        throw new LearningError("storage_corrupt", "The copied store does not match the source.")
      const result = await migrateRepositoryScope({
        provider: destination,
        oldScope: environment.legacyScope,
        newScope: environment.scope,
        clock,
      })
      if (
        canonicalJson(await readScope(source, environment.legacyScope)) !== canonicalJson(old) ||
        canonicalJson(await readScope(source, environment.scope)) !== canonicalJson(current)
      )
        throw new LearningError(
          "conflict",
          "The source changed during migration. Try again offline.",
        )
      if (canonicalJson(await readConfig(environment.configPath)) !== canonicalJson(config))
        throw new LearningError("conflict", "The learning configuration changed. Try again.")
      await destination.close()
      destination = null
      await source.close?.()
      sourceClosed = true
      try {
        await writePrivateConfig(environment.configPath, {
          ...confirmedConfig,
          memory: {
            ...config.memory,
            provider: { builtin: "sqlite", file },
            migration: {
              repository: environment.scope.repository,
              sourceProvider: config.memory?.provider ?? "sqlite",
            },
          },
        })
      } catch (error) {
        const observed = await readConfig(environment.configPath).catch(() => null)
        switched = !observed || observed.memory?.provider?.file === file
        throw error
      }
      switched = true
      return {
        file: target,
        sourceProvider: config.memory?.provider ?? "sqlite",
        ...(result.redactionFollowUps ? { redactionFollowUps: result.redactionFollowUps } : {}),
      }
    } finally {
      try {
        await destination?.close()
      } finally {
        try {
          if (!sourceClosed) await source.close?.()
        } finally {
          if (createdFile && !switched)
            for (const suffix of ["", "-wal", "-shm", "-journal"])
              await unlink(path.join(environment.dataDirectory, file + suffix)).catch((error) => {
                if (error.code !== "ENOENT") throw error
              })
        }
      }
    }
  })
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
  let handle
  try {
    handle = await open(configPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1)
      throw new LearningError("storage_corrupt", `${configPath} must be a regular file.`)
    bytes = await handle.readFile()
  } catch (error) {
    if (error.code === "ENOENT") return null
    if (error.code === "ELOOP")
      throw new LearningError("storage_corrupt", `${configPath} must not be a symbolic link.`)
    throw error
  } finally {
    await handle?.close()
  }
  const config = parseJson(decodeUtf8(bytes, configPath), configPath)
  const allowed = ["schemaVersion", "memory", "consolidation", "labeling", "githubRepository"]
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
  if (config.githubRepository !== undefined) {
    const identity = config.githubRepository
    if (
      !identity ||
      typeof identity !== "object" ||
      Array.isArray(identity) ||
      Object.keys(identity).some(
        (key) => !["id", "remote", "legacyRepository", "legacyConfirmed"].includes(key),
      ) ||
      typeof identity.id !== "string" ||
      !/^[1-9][0-9]*$/.test(identity.id) ||
      typeof identity.remote !== "string" ||
      legacyScopeFromName(identity.remote)?.host !== "github.com" ||
      identity.remote !== identity.remote.toLowerCase() ||
      typeof identity.legacyRepository !== "string" ||
      !legacyScopeFromName(`github.com/${identity.legacyRepository}`) ||
      identity.legacyRepository !== identity.legacyRepository.toLowerCase() ||
      (identity.legacyConfirmed !== undefined && typeof identity.legacyConfirmed !== "boolean")
    )
      throw new LearningError(
        "invalid_input",
        `${configPath} has an invalid GitHub repository identity.`,
      )
  }
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
