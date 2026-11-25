import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { after, it } from "node:test"
import { fileURLToPath } from "node:url"
import { REMOTE, weekOneLabels, weekOneLog, weekTwoLog } from "../conformance/fixtures.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { STREAMS } from "../src/provider-contract.mjs"
import { createJsonLinesMemoryProvider } from "../src/providers/json-lines.mjs"
import { createSqliteMemoryProvider } from "../src/providers/sqlite.mjs"
import { migrateRepositoryScope } from "../src/scope-migration.mjs"
import { createLearningStore } from "../src/store.mjs"
import { createMemoryProvider } from "./fixtures/json-file-provider.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(path.resolve(".learning-scope-tests-"))
after(() => rmSync(work, { recursive: true, force: true }))
const bin = path.join(here, "../bin/replica-learning.mjs")
const scope = { host: "github.com", repository: "repositories/123456" }
const hubId = "11111111-2222-4333-8444-555555555555"

function checkout(name) {
  const repo = path.join(work, name)
  const tools = path.join(repo, "tools")
  mkdirSync(tools, { recursive: true })
  execFileSync("git", ["init", "-q", repo])
  execFileSync("git", ["-C", repo, "remote", "add", "origin", REMOTE])
  writeFileSync(path.join(repo, ".gitignore"), ".replica/\n")
  writeFileSync(path.join(repo, "log.json"), JSON.stringify(weekOneLog()))
  const gh = path.join(tools, "gh")
  writeFileSync(
    gh,
    `#!${process.execPath}
import { appendFileSync } from "node:fs"
appendFileSync(process.env.TEST_GH_LOG, JSON.stringify(process.argv.slice(2)) + "\\n")
if (process.env.TEST_GH_FAIL === "1") {
  process.stderr.write("GitHub is unavailable\\n")
  process.exit(1)
}
process.stdout.write("123456\\n")
`,
    { mode: 0o755 },
  )
  return repo
}

function cli(repo, args, { failLookup = false, extraEnv = {} } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args, "--json"], {
    cwd: repo,
    env: {
      ...process.env,
      PATH: `${path.join(repo, "tools")}${path.delimiter}${process.env.PATH}`,
      HOME: repo,
      GH_CONFIG_DIR: path.join(repo, "gh-config"),
      TEST_GH_LOG: path.join(repo, "gh-calls"),
      TEST_GH_FAIL: failLookup ? "1" : "0",
      ...extraEnv,
    },
    encoding: "utf8",
  })
  assert.equal(result.error, undefined)
  return result
}

function ok(repo, args, options) {
  const result = cli(repo, args, options)
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

// These databases were created with the previous scope rules, before the new resolver ran.
function installLegacyStore(repo, fixture) {
  const directory = path.join(repo, ".replica", "learning")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  copyFileSync(path.join(here, "fixtures", fixture), path.join(directory, "learning.sqlite"))
}

function configureCustomProvider(repo) {
  const directory = path.join(repo, ".replica", "learning")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  copyFileSync(
    path.join(here, "fixtures", "json-file-provider.mjs"),
    path.join(repo, "tools", "provider.mjs"),
  )
  writeFileSync(
    path.join(directory, "config.json"),
    JSON.stringify({
      schemaVersion: "replica.learning-config/v1",
      memory: { provider: { module: "./tools/provider.mjs" } },
    }),
  )
  return directory
}

it("uses a new custom-provider store when no legacy records exist", async () => {
  const repo = checkout("new-custom-provider")
  const directory = configureCustomProvider(repo)
  const grant = ok(repo, [
    "grants",
    "add",
    "--purpose",
    "review",
    "--basis",
    "The team agreed to learn from review comments.",
    "--by",
    "github:ana-designer",
  ])
  assert.equal(ok(repo, ["grants", "list"], { failLookup: true })[0].grant.id, grant.id)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  const provider = createMemoryProvider({ dataDirectory: directory })
  assert.deepEqual(await provider.readRecords("grants", { scope }), [grant])
})

it("copies legacy custom-provider data only after an explicit offline migration", async () => {
  const repo = checkout("legacy-custom-provider")
  const directory = configureCustomProvider(repo)
  const provider = createMemoryProvider({ dataDirectory: directory })
  const store = await createLearningStore({ provider })
  const legacyScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: legacyScope, principal: { kind: "human", id: "github:ana-designer" } }
  const grant = await store.addGrant(human, {
    purposes: ["review"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  })
  const file = path.join(directory, "json-file-store.json")
  const before = readFileSync(file, "utf8")
  await store.close()

  const refused = cli(repo, ["grants", "list"])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /migrate-scope.*--offline/)
  assert.equal(readFileSync(file, "utf8"), before)
  assert.deepEqual(await provider.readRecords("grants", { scope: legacyScope }), [grant])
  assert.deepEqual(await provider.readRecords("grants", { scope }), [])

  const missingOffline = cli(repo, ["migrate-scope"], { failLookup: true })
  assert.notEqual(missingOffline.status, 0)
  assert.match(missingOffline.stderr, /--offline/)
  assert.equal(readFileSync(file, "utf8"), before)
  const migration = ok(repo, ["migrate-scope", "--offline"], { failLookup: true })
  const copied = ok(repo, ["grants", "list"], { failLookup: true })[0].grant
  for (const field of ["id", "purposes", "sources", "basis", "grantedBy", "grantedAt"])
    assert.deepEqual(copied[field], grant[field], field)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  function sqliteFiles() {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".sqlite"))
      .sort()
  }
  const files = sqliteFiles()
  assert.equal(files.length, 1)
  const retry = ok(repo, ["migrate-scope", "--offline"], { failLookup: true })
  assert.equal(retry.file, migration.file)
  assert.deepEqual(sqliteFiles(), files)
  assert.equal(ok(repo, ["grants", "list"], { failLookup: true })[0].grant.id, grant.id)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  assert.equal(readFileSync(file, "utf8"), before)
  assert.deepEqual(await provider.readRecords("grants", { scope: legacyScope }), [grant])
})

it("keeps the original store selected when its source changes during an offline copy", async () => {
  const repo = checkout("offline-source-change")
  const directory = configureCustomProvider(repo)
  const configPath = path.join(directory, "config.json")
  const file = path.join(directory, "json-file-store.json")
  const legacyScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: legacyScope, principal: { kind: "human", id: "github:ana-designer" } }
  const source = createMemoryProvider({ dataDirectory: directory })
  const store = await createLearningStore({ provider: source })
  const grantInput = {
    purposes: ["review"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  }
  const first = await store.addGrant(human, grantInput)
  await store.close()

  const seed = createMemoryProvider({ dataDirectory: path.join(repo, ".replica", "seed") })
  const seedStore = await createLearningStore({ provider: seed })
  const second = await seedStore.addGrant(human, { ...grantInput, basis: "Another team agreed." })
  const audit = await seed.readRecords("audit", { scope: legacyScope })
  await seedStore.close()
  const delta = path.join(repo, ".replica", "source-change.json")
  writeFileSync(delta, JSON.stringify({ grant: second, audit }))
  writeFileSync(
    path.join(repo, "tools", "changing-provider.mjs"),
    `import { readFileSync, readdirSync } from "node:fs"
import { createMemoryProvider as createBase } from "./provider.mjs"

export function createMemoryProvider(options) {
  const provider = createBase(options)
  let changed = false
  return {
    ...provider,
    async readRecords(stream, query) {
      if (!changed && process.env.TEST_CHANGE_SOURCE === "1" && stream === "grants" &&
          query.scope.repository === "acme/checkout-prototypes" &&
          readdirSync(options.dataDirectory).some((name) => name.endsWith(".sqlite"))) {
        changed = true
        const delta = JSON.parse(readFileSync(process.env.TEST_SOURCE_CHANGE, "utf8"))
        await provider.appendRecords("grants", [delta.grant], { audit: delta.audit })
      }
      return provider.readRecords(stream, query)
    },
  }
}
`,
  )
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: "replica.learning-config/v1",
      memory: { provider: { module: "./tools/changing-provider.mjs" } },
    }),
  )
  assert.notEqual(cli(repo, ["grants", "list"]).status, 0)
  const configBefore = readFileSync(configPath, "utf8")
  const failed = cli(repo, ["migrate-scope", "--offline"], {
    failLookup: true,
    extraEnv: { TEST_CHANGE_SOURCE: "1", TEST_SOURCE_CHANGE: delta },
  })
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /source changed/i)
  assert.equal(readFileSync(configPath, "utf8"), configBefore)
  assert.deepEqual(
    (await source.readRecords("grants", { scope: legacyScope })).map((grant) => grant.id),
    [first.id, second.id],
  )
  const sourceAfterChange = readFileSync(file, "utf8")
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.endsWith(".sqlite")),
    [],
  )

  ok(repo, ["migrate-scope", "--offline"], { failLookup: true })
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  assert.deepEqual(
    ok(repo, ["grants", "list"], { failLookup: true })
      .map(({ grant }) => grant.id)
      .sort(),
    [first.id, second.id].sort(),
  )
  assert.equal(readFileSync(file, "utf8"), sourceAfterChange)
})

it("copies legacy JSON Lines data to SQLite offline without changing the source", async () => {
  const repo = checkout("offline-migration")
  const directory = path.join(repo, ".replica", "learning")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(
    path.join(directory, "config.json"),
    JSON.stringify({
      schemaVersion: "replica.learning-config/v1",
      memory: { provider: "jsonl" },
    }),
  )
  const legacyScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: legacyScope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = { scope: legacyScope, principal: { kind: "agent", id: "agent:copilot" } }
  const source = createJsonLinesMemoryProvider({ directory })
  const store = await createLearningStore({
    provider: source,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grant = await store.addGrant(human, {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  })
  await store.importHubReviewComments(agent, weekOneLog(), { grantIds: [grant.id] })
  await store.annotate(agent, weekOneLabels().labels)
  const run = await store.consolidate(agent, {
    consolidator: createRecurrenceConsolidator(),
    window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
  })
  assert.equal(run.proposals.length, 1)
  const proposal = run.proposals[0]
  await store.acceptMemory(human, proposal.id, { expectedDigest: proposal.reviewDigest })
  assert.equal((await store.redactHubComment(human, 102)).redacted.length, 2)
  assert.equal((await store.verify(human)).ok, true)
  const streams = ["grants", "withdrawals", "episodes", "events", "collections", "exports", "audit"]
  const original = Object.fromEntries(
    await Promise.all(
      streams.map(async (stream) => [
        stream,
        await source.readRecords(stream, { scope: legacyScope }),
      ]),
    ),
  )
  const versions = await source.readMemoryVersions({ scope: legacyScope })
  await store.close()
  const sourceDirectory = path.join(directory, "v1")
  function sourceFiles() {
    return readdirSync(sourceDirectory)
      .sort()
      .map((name) => [name, readFileSync(path.join(sourceDirectory, name), "utf8")])
  }
  const before = sourceFiles()

  const refused = cli(repo, ["memories"])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /migrate-scope.*--offline/)
  assert.deepEqual(sourceFiles(), before)
  ok(repo, ["migrate-scope", "--offline"], { failLookup: true })
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  const manifest = ok(repo, ["doctor"], { failLookup: true }).provider.manifest
  assert.equal(manifest.id, "sqlite")
  assert.deepEqual(sourceFiles(), before)

  const target = createSqliteMemoryProvider({
    directory,
    file: path.basename(manifest.storage.location),
  })
  try {
    for (const stream of streams) {
      const copied = await target.readRecords(stream, { scope })
      const copiedIds = new Set(copied.map((record) => record.id))
      assert.ok(
        original[stream].every((record) => copiedIds.has(record.id)),
        stream,
      )
    }
    const copiedVersions = await target.readMemoryVersions({ scope })
    assert.deepEqual(
      copiedVersions.map(({ id, version, state, content }) => ({ id, version, state, content })),
      versions.map(({ id, version, state, content }) => ({ id, version, state, content })),
    )
    assert.deepEqual(copiedVersions.at(-1).accepted.by, versions.at(-1).accepted.by)
    assert.equal(copiedVersions.at(-1).accepted.at, versions.at(-1).accepted.at)
    const events = await target.readRecords("events", { scope })
    const redacted = events.filter((event) => event.redaction)
    assert.equal(redacted.length, 2)
    assert.ok(redacted.every((event) => !Object.hasOwn(event, "payload")))
    for (const originalEvent of original.events) {
      const copiedEvent = events.find((event) => event.id === originalEvent.id)
      assert.deepEqual(copiedEvent.payload, originalEvent.payload)
      assert.deepEqual(copiedEvent.redaction, originalEvent.redaction)
    }
  } finally {
    await target.close()
  }
})

it("retries a failed lookup and reuses the saved repository ID offline", () => {
  const repo = checkout("lookup")
  const config = path.join(repo, ".replica", "learning", "config.json")
  const failed = cli(repo, ["grants", "list"], { failLookup: true })
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /GitHub|repository|gh/i)
  if (existsSync(config))
    assert.equal(JSON.parse(readFileSync(config, "utf8")).githubRepository?.id, undefined)

  ok(repo, ["grants", "list"])
  assert.deepEqual(JSON.parse(readFileSync(config, "utf8")).githubRepository, {
    id: "123456",
    remote: "github.com/acme/checkout-prototypes",
    legacyRepository: "acme/checkout-prototypes",
  })
  const calls = readFileSync(path.join(repo, "gh-calls"), "utf8").trim().split("\n").map(JSON.parse)
  assert.deepEqual(calls, [
    ["api", "--hostname", "github.com", "repos/acme/checkout-prototypes", "--jq", ".id"],
    ["api", "--hostname", "github.com", "repos/acme/checkout-prototypes", "--jq", ".id"],
  ])
  assert.deepEqual(ok(repo, ["doctor"], { failLookup: true }).scope, scope)
  ok(repo, ["grants", "list"], { failLookup: true })
  assert.equal(readFileSync(path.join(repo, "gh-calls"), "utf8").trim().split("\n").length, 2)
})

it("migrates Solo history and keeps redactions across retries and replay", async () => {
  await checkMigratedHistory("solo")
})

it("migrates Hub history and keeps redactions across retries and replay", async () => {
  await checkMigratedHistory("hosted")
})

async function checkMigratedHistory(kind) {
  const repo = checkout(`migration-${kind}`)
  const hosted = kind === "hosted"
  installLegacyStore(repo, hosted ? "legacy-hub-scope.sqlite" : "legacy-scope.sqlite")
  if (!hosted) {
    const oldScope = { host: "github.com", repository: "acme/checkout-prototypes" }
    const provider = createSqliteMemoryProvider({
      directory: path.join(repo, ".replica", "learning"),
    })
    try {
      const grants = await provider.readRecords("grants", { scope: oldScope })
      const events = await provider.readRecords("events", { scope: oldScope })
      const versions = await provider.readMemoryVersions({ scope: oldScope })
      assert.equal(grants.length, 1)
      assert.equal(events.length, 23)
      assert.equal(versions.length, 2)
      const refused = cli(repo, ["memories"])
      assert.notEqual(refused.status, 0)
      assert.match(refused.stderr, /migrate-scope.*--offline/)
      assert.deepEqual(await provider.readRecords("grants", { scope: oldScope }), grants)
      assert.deepEqual(await provider.readRecords("events", { scope: oldScope }), events)
      assert.deepEqual(await provider.readMemoryVersions({ scope: oldScope }), versions)
      assert.deepEqual(await provider.readRecords("grants", { scope }), [])
      assert.deepEqual(await provider.readMemoryVersions({ scope }), [])
    } finally {
      await provider.close()
    }
    ok(repo, ["migrate-scope", "--offline"], { failLookup: true })
  }
  const options = hosted
    ? [
        "--dir",
        ".replica/learning",
        "--repository",
        "github.com/repositories/123456",
        "--legacy-repository",
        `github.com/repositories/${hubId}`,
      ]
    : []
  if (hosted) {
    const log = weekOneLog()
    for (const call of log.calls) {
      call.result.target.repository = `repositories/${hubId}`
      call.result.target.repositoryId = hubId
    }
    writeFileSync(path.join(repo, "log.json"), JSON.stringify(log))
  }
  function command(args, config) {
    return ok(repo, [...args, ...options], config)
  }
  const memories = command(["memories"])
  assert.equal(memories.length, 1)
  const history = command(["show", memories[0].record.id, "--history"])
  assert.deepEqual(
    history.versions.map((version) => version.state),
    ["proposed", "accepted"],
  )
  assert.equal(history.record.state, "accepted")
  assert.equal(history.record.accepted.by.id, "github:ana-designer")
  assert.equal(history.withheld, true)
  assert.equal(command(["verify"]).ok, true)

  const directory = path.join(repo, ".replica", "learning")
  async function stored() {
    const provider = createSqliteMemoryProvider({ directory })
    try {
      return {
        episodes: await provider.readRecords("episodes", { scope }),
        events: await provider.readRecords("events", { scope }),
        collections: await provider.readRecords("collections", { scope }),
        grants: await provider.readRecords("grants", { scope }),
        versions: await provider.readMemoryVersions({ scope }),
      }
    } finally {
      await provider.close()
    }
  }
  const before = await stored()
  assert.equal(before.episodes.length, 9)
  assert.equal(before.events.length, 23)
  assert.equal(before.collections.length, 1)
  assert.equal(before.grants.length, 1)
  assert.deepEqual(
    before.versions.map((version) => version.state),
    ["proposed", "accepted"],
  )
  assert.match(before.versions[1].content, /visible label above every form field/)
  const redacted = before.events.filter((event) => event.redaction)
  assert.equal(redacted.length, 2)
  assert.ok(redacted.every((event) => !Object.hasOwn(event, "payload")))
  assert.ok(redacted.some((event) => event.redaction.commentId === 102))
  const grant = command(["grants", "list"])[0].grant
  for (let attempt = 0; attempt < 2; attempt++)
    command(["import", "hub-comments", "log.json", "--grant", grant.id], { failLookup: true })
  if (!hosted) {
    const wrongRepository = weekTwoLog()
    for (const call of wrongRepository.calls) call.result.target.repository = "other/not-the-origin"
    writeFileSync(path.join(repo, "wrong-repository.json"), JSON.stringify(wrongRepository))
    const refused = cli(
      repo,
      ["import", "hub-comments", "wrong-repository.json", "--grant", grant.id],
      { failLookup: true },
    )
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /repository/i)
  }
  const after = await stored()
  assert.deepEqual(after, before)
  assert.equal(command(["verify"], { failLookup: true }).ok, true)
  if (hosted) {
    const rebound = cli(repo, [
      "memories",
      "--dir",
      ".replica/learning",
      "--repository",
      "github.com/repositories/654321",
      "--legacy-repository",
      `github.com/repositories/${hubId}`,
    ])
    assert.notEqual(rebound.status, 0)
    assert.deepEqual(await stored(), before)
  }
  assert.deepEqual(
    command(["show", memories[0].record.id, "--history"], { failLookup: true }).versions.map(
      (version) => version.state,
    ),
    ["proposed", "accepted"],
  )
}

it("replays an old-name snapshot after a rename but rejects a new old-name snapshot", async () => {
  const repo = checkout("renamed-origin")
  installLegacyStore(repo, "legacy-scope.sqlite")
  ok(repo, ["migrate-scope", "--offline"])
  const grant = ok(repo, ["grants", "list"])[0].grant
  const directory = path.join(repo, ".replica", "learning")
  async function evidence() {
    const provider = createSqliteMemoryProvider({ directory })
    try {
      return {
        events: await provider.readRecords("events", { scope }),
        collections: await provider.readRecords("collections", { scope }),
      }
    } finally {
      await provider.close()
    }
  }
  const before = await evidence()
  execFileSync("git", [
    "-C",
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/NewOrg/Renamed-Prototypes.git",
  ])
  ok(repo, ["import", "hub-comments", "log.json", "--grant", grant.id])
  const calls = readFileSync(path.join(repo, "gh-calls"), "utf8").trim().split("\n").map(JSON.parse)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].includes("repos/neworg/renamed-prototypes"))
  assert.deepEqual(await evidence(), before)

  const changed = weekOneLog()
  changed.calls.find((call) => call.result.threads?.length).result.threads[0].body =
    "A different comment under the old snapshot ID."
  writeFileSync(path.join(repo, "changed-old-name.json"), JSON.stringify(changed))
  const conflict = cli(
    repo,
    ["import", "hub-comments", "changed-old-name.json", "--grant", grant.id],
    {
      failLookup: true,
    },
  )
  assert.notEqual(conflict.status, 0)
  assert.match(conflict.stderr, /snapshot|different|conflict/i)

  writeFileSync(path.join(repo, "new-old-name.json"), JSON.stringify(weekTwoLog()))
  const refused = cli(repo, ["import", "hub-comments", "new-old-name.json", "--grant", grant.id], {
    failLookup: true,
  })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /repository|scope/i)
  assert.deepEqual(await evidence(), before)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
})

it("preserves old history when confirming a rename before the upgrade", () => {
  const repo = checkout("renamed-before-upgrade")
  installLegacyStore(repo, "legacy-scope.sqlite")
  execFileSync("git", [
    "-C",
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/NewOrg/Renamed-Prototypes.git",
  ])
  ok(repo, [
    "migrate-scope",
    "--offline",
    "--legacy-repository",
    "github.com/acme/checkout-prototypes",
  ])
  const memories = ok(repo, ["memories"], { failLookup: true })
  assert.equal(memories.length, 1)
  const history = ok(repo, ["show", memories[0].record.id, "--history"], { failLookup: true })
  assert.deepEqual(
    history.versions.map((version) => version.state),
    ["proposed", "accepted"],
  )
  assert.equal(history.record.accepted.by.id, "github:ana-designer")
  const grant = ok(repo, ["grants", "list"], { failLookup: true })[0].grant
  ok(repo, ["import", "hub-comments", "log.json", "--grant", grant.id], { failLookup: true })
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
})

it("reuses the existing replacement proposal when consolidating migrated history", async () => {
  const repo = checkout("replacement-proposal")
  installLegacyStore(repo, "legacy-scope.sqlite")
  const provider = createSqliteMemoryProvider({
    directory: path.join(repo, ".replica", "learning"),
  })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-10T12:00:00Z"),
  })
  const legacyScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: legacyScope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = { scope: legacyScope, principal: { kind: "agent", id: "agent:copilot" } }
  let replacement
  try {
    await store.redactHubComment(human, 101)
    const result = await store.consolidate(agent, {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    assert.equal(result.proposals.length, 1)
    replacement = result.proposals[0]
  } finally {
    await store.close()
  }

  const migratedProvider = createSqliteMemoryProvider({
    directory: path.join(repo, ".replica", "learning"),
  })
  const migration = await migrateRepositoryScope({
    provider: migratedProvider,
    oldScope: legacyScope,
    newScope: scope,
    clock: () => Date.parse("2026-10-10T12:00:00Z"),
  })
  const digestMappings = Object.fromEntries(
    migration.digestMappings
      .filter((mapping) => mapping.kind === "memory" && mapping.field === "digest")
      .map((mapping) => [mapping.oldDigest, mapping.newDigest]),
  )
  const migrated = await createLearningStore({
    provider: migratedProvider,
    legacyScopes: [legacyScope],
    digestMappings,
    clock: () => Date.parse("2026-10-10T12:00:00Z"),
  })
  const migratedAgent = { ...agent, scope }
  try {
    const before = await migrated.queryMemory(migratedAgent)
    assert.equal(before.length, 2)
    assert.ok(
      before.some(({ record }) => record.id === replacement.id && record.state === "proposed"),
    )
    await migrated.consolidate(migratedAgent, {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const after = await migrated.queryMemory(migratedAgent)
    assert.deepEqual(
      after.map(({ record }) => record.id).sort(),
      before.map(({ record }) => record.id).sort(),
    )
    assert.equal((await migrated.verify(migratedAgent)).ok, true)
  } finally {
    await migrated.close()
  }
})

it("fences an already-open writer from appending to the migrated scope", async () => {
  const repo = checkout("fenced-writer")
  installLegacyStore(repo, "legacy-scope.sqlite")
  const directory = path.join(repo, ".replica", "learning")
  const oldScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  const writer = createSqliteMemoryProvider({ directory })
  const oldStore = await createLearningStore({ provider: writer })
  const migrator = createSqliteMemoryProvider({ directory })
  try {
    assert.equal((await writer.readRecords("grants", { scope: oldScope })).length, 1)
    await migrateRepositoryScope({ provider: migrator, oldScope, newScope: scope })
    const before = await migrator.readRecords("grants", { scope })
    await assert.rejects(
      oldStore.addGrant(human, {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "A stale client tries to add consent.",
      }),
      /scope has migrated/i,
    )
    assert.deepEqual(await writer.readRecords("grants", { scope: oldScope }), [])
    assert.deepEqual(await migrator.readRecords("grants", { scope }), before)
    const migratedStore = await createLearningStore({ provider: migrator })
    assert.equal((await migratedStore.verify({ ...human, scope })).ok, true)
  } finally {
    await oldStore.close()
    await migrator.close()
  }
})

it("rolls back both scopes and leaves the old scope writable when a transform fails", async () => {
  const repo = checkout("rollback-transform")
  installLegacyStore(repo, "legacy-scope.sqlite")
  const directory = path.join(repo, ".replica", "learning")
  const oldScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  const provider = createSqliteMemoryProvider({ directory })
  async function snapshot(queryScope) {
    return {
      records: Object.fromEntries(
        await Promise.all(
          Object.keys(STREAMS).map(async (stream) => [
            stream,
            await provider.readRecords(stream, { scope: queryScope }),
          ]),
        ),
      ),
      memories: await provider.readMemoryVersions({ scope: queryScope }),
    }
  }
  try {
    const beforeOld = await snapshot(oldScope)
    const beforeNew = await snapshot(scope)
    await assert.rejects(
      provider.migrateScope({
        oldScope,
        newScope: scope,
        transform: async ({ records, memories }) => {
          const changed = Object.fromEntries(
            Object.entries(records).map(([stream, items]) => [
              stream,
              items.map((record) => ({ ...record, scope })),
            ]),
          )
          changed.events[0].id = "invalid-event-identity"
          return {
            records: changed,
            memories: memories.map((record) => ({ ...record, scope })),
            metadata: {},
          }
        },
      }),
      /changed a record identity/i,
    )
    assert.deepEqual(await snapshot(oldScope), beforeOld)
    assert.deepEqual(await snapshot(scope), beforeNew)
    const store = await createLearningStore({ provider })
    await store.addGrant(human, {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "A person can still grant consent after a failed migration.",
    })
    assert.equal((await store.verify(human)).ok, true)
  } finally {
    await provider.close()
  }
})
