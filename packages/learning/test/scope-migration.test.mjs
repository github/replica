import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
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
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  collectionLog,
  HUB_ORIGIN,
  REMOTE,
  weekOneLabels,
  weekOneLog,
  weekTwoLog,
} from "../conformance/fixtures.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { labelComments } from "../src/labeling.mjs"
import { STREAMS } from "../src/provider-contract.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { createJsonLinesMemoryProvider } from "../src/providers/json-lines.mjs"
import { createSqliteMemoryProvider } from "../src/providers/sqlite.mjs"
import { sealRecord } from "../src/records.mjs"
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

function cli(repo, args, { failLookup = false, extraEnv = {}, json = true } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args, ...(json ? ["--json"] : [])], {
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
  chmodSync(path.join(directory, "learning.sqlite"), 0o600)
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

it("uses a new custom-provider store after confirming it is empty", async () => {
  const repo = checkout("new-custom-provider")
  const directory = configureCustomProvider(repo)
  const grantArgs = [
    "grants",
    "add",
    "--purpose",
    "review",
    "--basis",
    "The team agreed to learn from review comments.",
    "--by",
    "github:ana-designer",
  ]
  assert.notEqual(cli(repo, grantArgs).status, 0)
  assert.equal(existsSync(path.join(directory, "json-file-store.json")), false)
  ok(repo, ["migrate-scope", "--offline", "--empty"], { failLookup: true })
  const grant = ok(repo, grantArgs, { failLookup: true })
  assert.equal(ok(repo, ["grants", "list"], { failLookup: true })[0].grant.id, grant.id)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  assert.equal(ok(repo, ["doctor"], { failLookup: true }).provider.manifest.id, "json-file")
  const provider = createMemoryProvider({ dataDirectory: directory })
  assert.deepEqual(await provider.readRecords("grants", { scope }), [grant])
})

it("requires the old name before migrating a renamed custom-provider store", async () => {
  const repo = checkout("renamed-custom-provider")
  const directory = configureCustomProvider(repo)
  const provider = createMemoryProvider({ dataDirectory: directory })
  const store = await createLearningStore({ provider })
  const oldScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  const grant = await store.addGrant(human, {
    purposes: ["review"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  })
  await store.close()
  const file = path.join(directory, "json-file-store.json")
  const before = readFileSync(file, "utf8")
  execFileSync("git", [
    "-C",
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/NewOrg/Renamed-Prototypes.git",
  ])
  const attemptedWrite = cli(repo, [
    "grants",
    "add",
    "--purpose",
    "review",
    "--basis",
    "An unconfirmed write.",
    "--by",
    "github:ana-designer",
  ])
  assert.notEqual(attemptedWrite.status, 0)
  assert.equal(readFileSync(file, "utf8"), before)
  const missing = cli(repo, ["migrate-scope", "--offline"], { failLookup: true })
  assert.notEqual(missing.status, 0)
  const wrong = cli(
    repo,
    ["migrate-scope", "--offline", "--legacy-repository", "github.com/acme/misspelled"],
    { failLookup: true },
  )
  assert.notEqual(wrong.status, 0)
  assert.equal(readFileSync(file, "utf8"), before)
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.endsWith(".sqlite")),
    [],
  )
  const config = JSON.parse(readFileSync(path.join(directory, "config.json"), "utf8"))
  assert.deepEqual(config.memory.provider, { module: "./tools/provider.mjs" })

  ok(
    repo,
    ["migrate-scope", "--offline", "--legacy-repository", "github.com/acme/checkout-prototypes"],
    { failLookup: true },
  )
  assert.equal(ok(repo, ["grants", "list"], { failLookup: true })[0].grant.id, grant.id)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  assert.equal(readFileSync(file, "utf8"), before)
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
  const migrationArgs = [
    "migrate-scope",
    "--offline",
    "--legacy-repository",
    "github.com/acme/checkout-prototypes",
  ]
  const message = cli(repo, migrationArgs, { failLookup: true, json: false })
  assert.equal(message.status, 0, message.stderr)
  assert.match(message.stdout, /The original provider is unchanged/)
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
  const retry = ok(repo, migrationArgs, { failLookup: true })
  assert.equal(path.basename(retry.file), files[0])
  assert.deepEqual(sqliteFiles(), files)
  assert.equal(ok(repo, ["grants", "list"], { failLookup: true })[0].grant.id, grant.id)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  assert.equal(readFileSync(file, "utf8"), before)
  assert.deepEqual(await provider.readRecords("grants", { scope: legacyScope }), [grant])
})

it("adds a second confirmed custom-provider history to the migrated SQLite store", async () => {
  const repo = checkout("multiple-custom-histories")
  const directory = configureCustomProvider(repo)
  const source = createMemoryProvider({ dataDirectory: directory })
  const store = await createLearningStore({
    provider: source,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const firstScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const secondScope = { host: "github.com", repository: "acme/previous-name" }
  function human(scope) {
    return { scope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(scope) {
    return { scope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const firstLog = weekOneLog()
  const secondLog = weekOneLog({
    repository: secondScope.repository,
    snapshotId: "11111111-2222-4333-8444-666666666666",
  })
  for (const call of secondLog.calls) call.result.target.repositoryId = 84
  writeFileSync(path.join(repo, "previous-name.json"), JSON.stringify(secondLog))
  const histories = []
  for (const [oldScope, log] of [
    [firstScope, firstLog],
    [secondScope, secondLog],
  ]) {
    const grant = await store.addGrant(human(oldScope), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments.",
    })
    await store.importHubReviewComments(agent(oldScope), log, { grantIds: [grant.id] })
    await store.annotate(agent(oldScope), weekOneLabels().labels)
    const run = await store.consolidate(agent(oldScope), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    assert.equal(run.proposals.length, 1)
    const accepted = await store.acceptMemory(human(oldScope), run.proposals[0].id, {
      expectedDigest: run.proposals[0].reviewDigest,
    })
    histories.push({ grant, id: accepted.id })
  }
  await store.close()
  const sourceFile = path.join(directory, "json-file-store.json")
  const before = readFileSync(sourceFile, "utf8")
  const firstArgs = [
    "migrate-scope",
    "--offline",
    "--legacy-repository",
    "github.com/acme/checkout-prototypes",
  ]
  const secondArgs = [
    "migrate-scope",
    "--offline",
    "--legacy-repository",
    "github.com/acme/previous-name",
  ]
  const first = ok(repo, firstArgs)
  const second = ok(repo, secondArgs, { failLookup: true })
  assert.equal(second.file, first.file)
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.endsWith(".sqlite")),
    [path.basename(first.file)],
  )
  const memories = ok(repo, ["memories"], { failLookup: true })
  assert.deepEqual(
    memories.map(({ record }) => record.id).sort(),
    histories.map(({ id }) => id).sort(),
  )
  for (const { id } of histories) {
    const history = ok(repo, ["show", id, "--history"], { failLookup: true })
    assert.deepEqual(
      history.versions.map((version) => version.state),
      ["proposed", "accepted"],
    )
    assert.equal(history.record.accepted.by.id, "github:ana-designer")
  }
  const target = createSqliteMemoryProvider({ directory, file: path.basename(first.file) })
  try {
    const events = await target.readRecords("events", { scope })
    const collections = await target.readRecords("collections", { scope })
    ok(repo, ["import", "hub-comments", "log.json", "--grant", histories[0].grant.id], {
      failLookup: true,
    })
    ok(repo, ["import", "hub-comments", "previous-name.json", "--grant", histories[1].grant.id], {
      failLookup: true,
    })
    assert.equal(ok(repo, secondArgs, { failLookup: true }).file, first.file)
    assert.equal(ok(repo, firstArgs, { failLookup: true }).file, first.file)
    assert.deepEqual(await target.readRecords("events", { scope }), events)
    assert.deepEqual(await target.readRecords("collections", { scope }), collections)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
    assert.equal(readFileSync(sourceFile, "utf8"), before)
  } finally {
    await target.close()
  }
})

it("copies both explicitly named hosted histories from a custom provider", async () => {
  const repo = checkout("hosted-custom-second-history")
  const directory = configureCustomProvider(repo)
  mkdirSync(path.join(directory, "tools"))
  copyFileSync(
    path.join(repo, "tools", "provider.mjs"),
    path.join(directory, "tools", "provider.mjs"),
  )
  const first = {
    host: "github.com",
    repository: "repositories/11111111-2222-4333-8444-111111111111",
  }
  const second = {
    host: "github.com",
    repository: "repositories/11111111-2222-4333-8444-222222222222",
  }
  const source = createMemoryProvider({ dataDirectory: directory })
  const store = await createLearningStore({ provider: source })
  const grants = []
  for (const oldScope of [first, second])
    grants.push(
      await store.addGrant(
        { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } },
        {
          purposes: ["review"],
          sources: ["hub_review_comments"],
          basis: "The team agreed to learn from review comments.",
        },
      ),
    )
  await store.close()
  const original = readFileSync(path.join(directory, "json-file-store.json"), "utf8")
  const hosted = ["--dir", ".replica/learning", "--repository", "github.com/repositories/123456"]
  const firstArgs = [
    "migrate-scope",
    "--offline",
    ...hosted,
    "--legacy-repository",
    `github.com/${first.repository}`,
  ]
  const secondArgs = [
    "migrate-scope",
    "--offline",
    ...hosted,
    "--legacy-repository",
    `github.com/${second.repository}`,
  ]
  const copied = ok(repo, firstArgs, { failLookup: true })
  assert.equal(ok(repo, secondArgs, { failLookup: true }).file, copied.file)
  const listed = ok(repo, ["grants", "list", ...hosted], { failLookup: true })
  assert.deepEqual(
    listed.map(({ grant }) => grant.id).sort(),
    grants.map((grant) => grant.id).sort(),
  )
  assert.equal(ok(repo, secondArgs, { failLookup: true }).file, copied.file)
  assert.equal(ok(repo, ["verify", ...hosted], { failLookup: true }).ok, true)
  assert.equal(readFileSync(path.join(directory, "json-file-store.json"), "utf8"), original)
  assert.equal(existsSync(path.join(repo, "gh-calls")), false)
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
  const migrationArgs = [
    "migrate-scope",
    "--offline",
    "--legacy-repository",
    "github.com/acme/checkout-prototypes",
  ]
  const failed = cli(repo, migrationArgs, {
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

  ok(repo, migrationArgs, { failLookup: true })
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

it("lists decision models in a fresh checkout without GitHub access", () => {
  const repo = checkout("offline-decision-models")
  const result = cli(repo, ["decision", "models"], { failLookup: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).schemaVersion, "replica.decision-models/v1")
  assert.equal(existsSync(path.join(repo, "gh-calls")), false)
})

it("writes an offline decision taskset only in a private checkout location", async () => {
  const repo = checkout("offline-decision-taskset")
  const oldScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  const store = await createLearningStore({
    provider: createInMemoryProvider(),
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  let bundle
  try {
    const grant = await store.addGrant(human, {
      purposes: ["review", "instruction", "training"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments.",
    })
    await store.importHubReviewComments(agent, weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent, weekOneLabels().labels)
    const run = await store.consolidate(agent, {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    await store.acceptMemory(human, run.proposals[0].id, {
      expectedDigest: run.proposals[0].reviewDigest,
    })
    const exported = await store.exportRecords(human, {
      purpose: "training",
      destination: "offline-training.json",
    })
    bundle = exported.bundle
  } finally {
    await store.close()
  }
  const privateDir = path.join(repo, ".replica")
  mkdirSync(privateDir)
  writeFileSync(path.join(privateDir, "export.json"), JSON.stringify(bundle))
  writeFileSync(
    path.join(privateDir, "screen.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    ),
  )
  const screenshots = ["desktop", "narrow"].flatMap((size) =>
    ["light", "dark"].map((theme) => ({ route: "/checkout", size, theme, path: "screen.png" })),
  )
  writeFileSync(
    path.join(privateDir, "builds.json"),
    JSON.stringify({
      schemaVersion: "replica.decision-builds/v1",
      source: { hubOrigin: HUB_ORIGIN, repositoryId: 42 },
      builds: [
        { prototypeId: 11, number: 3 },
        { prototypeId: 12, number: 2 },
        { prototypeId: 13, number: 5 },
      ].map((build) => ({
        ...build,
        createdAt: "2026-09-29T08:00:00Z",
        publishedAt: "2026-09-29T09:00:00Z",
        screenshots,
      })),
    }),
  )
  const args = [
    "decision",
    "taskset",
    "--export",
    ".replica/export.json",
    "--builds",
    ".replica/builds.json",
  ]
  const unsafe = cli(repo, [...args, "--out", "tasksets/public"], { failLookup: true })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /not under \.replica/)
  assert.equal(existsSync(path.join(repo, "tasksets")), false)
  const result = ok(repo, [...args, "--out", ".replica/tasksets/private"], { failLookup: true })
  assert.ok(result.counts.tasks > 0)
  assert.equal(existsSync(path.join(privateDir, "tasksets", "private", "tasks.jsonl")), true)
  assert.equal(existsSync(path.join(repo, "gh-calls")), false)
  assert.equal(existsSync(path.join(privateDir, "learning")), false)
})

it("reuses a saved scope mapping without taking the migration write path", () => {
  const repo = checkout("saved-mapping-read")
  installLegacyStore(repo, "legacy-scope.sqlite")
  ok(repo, ["migrate-scope", "--offline"])
  const directory = path.join(repo, ".replica", "learning")
  const configPath = path.join(directory, "config.json")
  const config = JSON.parse(readFileSync(configPath, "utf8"))
  config.memory = { provider: { module: "./tools/sqlite-probe.mjs" } }
  writeFileSync(configPath, JSON.stringify(config))
  writeFileSync(
    path.join(repo, "tools", "sqlite-probe.mjs"),
    `import { writeFileSync } from "node:fs"
import path from "node:path"
import { createSqliteMemoryProvider } from ${JSON.stringify(pathToFileURL(path.join(here, "../src/providers/sqlite.mjs")).href)}
export function createMemoryProvider({ dataDirectory }) {
  const provider = createSqliteMemoryProvider({ directory: dataDirectory })
  return {
    ...provider,
    async migrateScope() {
      writeFileSync(path.join(dataDirectory, "migration-write-attempted"), "yes")
      throw new Error("migration write path reached")
    },
  }
}
`,
  )
  const marker = path.join(directory, "migration-write-attempted")
  const first = ok(repo, ["grants", "list"], { failLookup: true })
  assert.ok(first.length > 0)
  assert.deepEqual(ok(repo, ["grants", "list"], { failLookup: true }), first)
  assert.equal(existsSync(marker), false)

  config.githubRepository.id = "987654"
  writeFileSync(configPath, JSON.stringify(config))
  const conflict = cli(repo, ["grants", "list"], { failLookup: true })
  assert.notEqual(conflict.status, 0)
  assert.match(conflict.stderr, /old scope was migrated to another repository/i)
  assert.equal(existsSync(marker), false)

  config.githubRepository.id = "123456"
  config.githubRepository.legacyRepository = "acme/unmapped"
  writeFileSync(configPath, JSON.stringify(config))
  const unmapped = cli(repo, ["grants", "list"], { failLookup: true })
  assert.notEqual(unmapped.status, 0)
  assert.match(unmapped.stderr, /migration write path reached/)
  assert.equal(existsSync(marker), true)
})

it("uses migration metadata when a host reopens the store directly", async () => {
  const repo = checkout("direct-api-metadata")
  installLegacyStore(repo, "legacy-scope.sqlite")
  ok(repo, ["migrate-scope", "--offline"])
  const directory = path.join(repo, ".replica", "learning")
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({ provider })
  const human = { scope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = {
    scope,
    sourceRepository: "acme/checkout-prototypes",
    principal: { kind: "agent", id: "agent:copilot" },
  }
  const text = "Agree. I lost track of which field was which halfway through."
  try {
    const [grant] = await provider.readRecords("grants", { scope })
    const newer = weekOneLog({
      snapshotId: "11111111-2222-4333-8444-333333333333",
      capturedAt: "2026-10-08T18:00:00.000000Z",
    })
    await store.importHubReviewComments(agent, newer, { grantIds: [grant.id] })
    const events = await provider.readRecords("events", { scope })
    assert.ok(events.some((event) => event.redaction?.commentId === 102))
    assert.ok(!events.some((event) => event.payload?.body === text))
    const selected = await store.queryObservations(human, { purpose: "review" })
    assert.ok(!selected.events.some((event) => event.payload?.commentId === 102))
    assert.equal((await store.verify(human)).ok, true)
    const file = provider.manifest().storage.location
    for (const name of [file, `${file}-wal`])
      if (existsSync(name)) assert.equal(readFileSync(name).includes(text), false)
  } finally {
    await store.close()
  }
})

it("keeps a first-seen deletion from reviving an older comment", async () => {
  const repo = checkout("first-seen-deletion")
  const directory = path.join(repo, ".replica", "learning")
  const firstScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const secondScope = { host: "github.com", repository: "acme/previous-name" }
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  try {
    const input = {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments.",
    }
    const firstGrant = await store.addGrant(human(firstScope), input)
    await store.importHubReviewComments(agent(firstScope), weekOneLog(), {
      grantIds: [firstGrant.id],
    })
    await store.annotate(agent(firstScope), weekOneLabels().labels)
    const window = { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" }
    const run = await store.consolidate(agent(firstScope), {
      consolidator: createRecurrenceConsolidator(),
      window,
    })
    assert.equal(run.proposals.length, 1)
    await store.acceptMemory(human(firstScope), run.proposals[0].id, {
      expectedDigest: run.proposals[0].reviewDigest,
    })
    const original = (await provider.readRecords("events", { scope: firstScope })).find(
      (event) => event.payload?.commentId === 103,
    )
    assert.ok(original)
    const secondGrant = await store.addGrant(human(secondScope), input)
    const deleted = weekOneLog({
      repository: secondScope.repository,
      snapshotId: "11111111-2222-4333-8444-444444444444",
      capturedAt: "2026-10-08T18:00:00.000000Z",
    })
    for (const call of deleted.calls)
      for (const thread of call.result.threads ?? [])
        if (thread.id === 103) {
          thread.body = null
          thread.deletedAt = "2026-10-07T09:00:00.000000Z"
          thread.updatedAt = thread.deletedAt
        }
    await store.importHubReviewComments(agent(secondScope), deleted, { grantIds: [secondGrant.id] })
    const secondEvents = await provider.readRecords("events", { scope: secondScope })
    assert.ok(secondEvents.some((event) => event.payload?.commentId === 103))
    assert.ok(!secondEvents.some((event) => event.type === "retraction"))
    for (const oldScope of [firstScope, secondScope])
      ok(repo, [
        "migrate-scope",
        "--offline",
        "--legacy-repository",
        `github.com/${oldScope.repository}`,
      ])
    const selected = await store.queryObservations(human(scope), {
      purpose: "instruction",
      eventIds: [original.id],
    })
    assert.deepEqual(selected.events, [])
    assert.deepEqual((await store.recall(agent(scope))).memories, [])
    const result = await store.consolidate(agent(scope), {
      consolidator: createRecurrenceConsolidator(),
      window,
      dryRun: true,
    })
    assert.ok(
      result.proposals.every((proposal) =>
        proposal.evidence.every((reference) => !reference.eventIds.includes(original.id)),
      ),
    )
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

it("reports redaction follow-ups on migration and retry", async () => {
  const repo = checkout("redaction-follow-ups")
  const directory = path.join(repo, ".replica", "learning")
  const firstScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const secondScope = { host: "github.com", repository: `repositories/${hubId}` }
  const destination = "private/exports/team-\u001b[2J.json"
  const quotedDestination = JSON.stringify(destination)
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  try {
    const input = {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments.",
    }
    const firstGrant = await store.addGrant(human(firstScope), input)
    await store.importHubReviewComments(agent(firstScope), weekOneLog(), {
      grantIds: [firstGrant.id],
    })
    const secondGrant = await store.addGrant(human(secondScope), input)
    const secondLog = weekOneLog({
      repository: secondScope.repository,
      snapshotId: "11111111-2222-4333-8444-888888888888",
    })
    await store.importHubReviewComments(agent(secondScope), secondLog, {
      grantIds: [secondGrant.id],
    })
    await store.annotate(agent(secondScope), weekOneLabels().labels)
    const run = await store.consolidate(agent(secondScope), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    assert.equal(run.proposals.length, 1)
    const memory = await store.acceptMemory(human(secondScope), run.proposals[0].id, {
      expectedDigest: run.proposals[0].reviewDigest,
    })
    const exported = await store.exportRecords(human(secondScope), {
      purpose: "instruction",
      destination,
      contents: "learnings",
    })
    const anotherExport = await store.exportRecords(human(secondScope), {
      purpose: "instruction",
      destination: "private/exports/other.json",
      contents: "learnings",
    })
    const redacted = await store.redactHubComment(human(firstScope), 101)
    assert.ok(!redacted.exportsToFollowUp.some((item) => item.id === exported.manifest.id))
    const jsonlRepo = checkout("jsonl-redaction-follow-ups")
    const jsonlDirectory = path.join(jsonlRepo, ".replica", "learning")
    mkdirSync(jsonlDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(
      path.join(jsonlDirectory, "config.json"),
      JSON.stringify({
        schemaVersion: "replica.learning-config/v1",
        memory: { provider: "jsonl" },
      }),
      { mode: 0o600 },
    )
    const jsonl = createJsonLinesMemoryProvider({ directory: jsonlDirectory })
    const sourceHistories = []
    for (const oldScope of [firstScope, secondScope]) {
      const records = Object.fromEntries(
        await Promise.all(
          Object.keys(STREAMS).map(async (stream) => [
            stream,
            await provider.readRecords(stream, { scope: oldScope }),
          ]),
        ),
      )
      const memories = await provider.readMemoryVersions({ scope: oldScope })
      sourceHistories.push({ records, memories })
      await jsonl.appendBatch(records)
      for (const version of memories)
        await jsonl.appendMemoryVersion(version, {
          expectedPreviousDigest: version.previousDigest ?? null,
        })
    }
    await store.close()
    const hostedRepo = checkout("hosted-redaction-follow-ups")
    const jsonRepo = checkout("json-redaction-follow-ups")
    const autoRepo = checkout("automatic-redaction-follow-ups")
    for (const target of [hostedRepo, jsonRepo, autoRepo]) {
      const targetDirectory = path.join(target, ".replica", "learning")
      mkdirSync(targetDirectory, { recursive: true, mode: 0o700 })
      copyFileSync(
        path.join(directory, "learning.sqlite"),
        path.join(targetDirectory, "learning.sqlite"),
      )
      chmodSync(path.join(targetDirectory, "learning.sqlite"), 0o600)
    }
    ok(repo, [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      `github.com/${firstScope.repository}`,
    ])
    const migrate = [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      `github.com/${secondScope.repository}`,
    ]
    const initial = cli(repo, migrate, { failLookup: true, json: false })
    assert.equal(initial.status, 0, initial.stderr)
    for (const value of [memory.id, exported.manifest.id, quotedDestination])
      assert.ok(initial.stdout.includes(value), `Migration output should include ${value}`)
    assert.ok(!initial.stdout.includes("\u001b"))
    const followUps = ok(repo, ["status"], { failLookup: true }).migrationRedactionFollowUps
    assert.ok(followUps.memoriesNeedingRebuild.includes(memory.id))
    assert.ok(
      followUps.exportsToFollowUp.some(
        (item) => item.id === exported.manifest.id && item.destination === destination,
      ),
    )
    assert.ok(
      followUps.exportsToFollowUp.some(
        (item) =>
          item.id === anotherExport.manifest.id &&
          item.destination === "private/exports/other.json",
      ),
    )
    const retry = ok(repo, migrate, { failLookup: true })
    assert.deepEqual(retry.redactionFollowUps, followUps)
    const retryText = cli(repo, migrate, { failLookup: true, json: false })
    assert.equal(retryText.status, 0, retryText.stderr)
    for (const value of [memory.id, exported.manifest.id, quotedDestination])
      assert.ok(retryText.stdout.includes(value), `Migration retry should include ${value}`)
    assert.ok(!retryText.stdout.includes("\u001b"))
    const statusText = cli(repo, ["status"], { failLookup: true, json: false })
    assert.equal(statusText.status, 0, statusText.stderr)
    assert.match(statusText.stdout, /Needs attention:/)
    assert.ok(statusText.stdout.split("Needs attention:")[1].includes(memory.id))
    assert.ok(statusText.stdout.includes(exported.manifest.id))
    assert.ok(statusText.stdout.includes(quotedDestination.slice(1, -1)))
    assert.ok(!statusText.stdout.includes("\u001b"))
    assert.deepEqual(
      ok(repo, ["status"], { failLookup: true }).migrationRedactionFollowUps,
      followUps,
    )
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)

    for (const target of [jsonRepo, autoRepo, hostedRepo])
      ok(target, [
        "migrate-scope",
        "--offline",
        "--legacy-repository",
        `github.com/${firstScope.repository}`,
      ])
    assert.deepEqual(ok(jsonRepo, migrate, { failLookup: true }).redactionFollowUps, followUps)

    const copied = ok(jsonlRepo, [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      `github.com/${firstScope.repository}`,
    ])
    const merged = ok(jsonlRepo, migrate, { failLookup: true })
    assert.equal(merged.file, copied.file)
    assert.equal(merged.sourceProvider, "jsonl")
    assert.deepEqual(merged.redactionFollowUps, followUps)
    const copiedRetry = ok(jsonlRepo, migrate, { failLookup: true })
    assert.equal(copiedRetry.file, copied.file)
    assert.equal(copiedRetry.alreadyMigrated, true)
    assert.deepEqual(copiedRetry.redactionFollowUps, followUps)
    const copiedRetryText = cli(jsonlRepo, migrate, { failLookup: true, json: false })
    assert.equal(copiedRetryText.status, 0, copiedRetryText.stderr)
    for (const value of [memory.id, exported.manifest.id, quotedDestination])
      assert.ok(
        copiedRetryText.stdout.includes(value),
        `Copied migration retry should include ${value}`,
      )
    assert.ok(!copiedRetryText.stdout.includes("\u001b"))
    const defaultRetry = ["migrate-scope", "--offline"]
    const defaultRetryJson = ok(jsonlRepo, defaultRetry, { failLookup: true })
    assert.equal(defaultRetryJson.alreadyMigrated, true)
    assert.deepEqual(defaultRetryJson.redactionFollowUps, followUps)
    const defaultRetryText = cli(jsonlRepo, defaultRetry, { failLookup: true, json: false })
    assert.equal(defaultRetryText.status, 0, defaultRetryText.stderr)
    for (const id of followUps.memoriesNeedingRebuild)
      assert.ok(defaultRetryText.stdout.includes(id), `Default retry should include ${id}`)
    for (const item of followUps.exportsToFollowUp) {
      assert.ok(
        defaultRetryText.stdout.includes(item.id),
        `Default retry should include ${item.id}`,
      )
      assert.ok(
        defaultRetryText.stdout.includes(JSON.stringify(item.destination)),
        `Default retry should include the quoted destination for ${item.id}`,
      )
    }
    assert.ok(!defaultRetryText.stdout.includes("\u001b"))
    assert.deepEqual(
      ok(jsonlRepo, ["status"], { failLookup: true }).migrationRedactionFollowUps,
      followUps,
    )
    assert.equal(ok(jsonlRepo, ["verify"], { failLookup: true }).ok, true)
    for (const [index, oldScope] of [firstScope, secondScope].entries()) {
      for (const stream of Object.keys(STREAMS))
        assert.deepEqual(
          await jsonl.readRecords(stream, { scope: oldScope }),
          sourceHistories[index].records[stream],
        )
      assert.deepEqual(
        await jsonl.readMemoryVersions({ scope: oldScope }),
        sourceHistories[index].memories,
      )
    }

    const autoConfigPath = path.join(autoRepo, ".replica", "learning", "config.json")
    const autoConfig = JSON.parse(readFileSync(autoConfigPath, "utf8"))
    autoConfig.githubRepository.legacyRepository = secondScope.repository
    writeFileSync(autoConfigPath, JSON.stringify(autoConfig))
    for (let attempt = 0; attempt < 2; attempt++) {
      const automatic = cli(autoRepo, ["grants", "list"], { failLookup: true })
      assert.equal(automatic.status, 0, automatic.stderr)
      assert.ok(Array.isArray(JSON.parse(automatic.stdout)))
      for (const value of [memory.id, exported.manifest.id, quotedDestination])
        assert.ok(automatic.stderr.includes(value), `Automatic open should warn about ${value}`)
      assert.ok(!automatic.stderr.includes("\u001b"))
    }
    assert.deepEqual(
      ok(autoRepo, ["status"], { failLookup: true }).migrationRedactionFollowUps,
      followUps,
    )
    const hosted = [
      "--dir",
      ".replica/learning",
      "--repository",
      "github.com/repositories/123456",
      "--legacy-repository",
      `github.com/${secondScope.repository}`,
    ]
    assert.deepEqual(
      ok(hostedRepo, ["status", ...hosted], { failLookup: true }).migrationRedactionFollowUps,
      followUps,
    )
    assert.deepEqual(
      ok(hostedRepo, ["status", ...hosted], { failLookup: true }).migrationRedactionFollowUps,
      followUps,
    )
    assert.equal(ok(hostedRepo, ["verify", ...hosted], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

it("does not label the same migrated comment version twice", async () => {
  const repo = checkout("overlap-label-once")
  const directory = path.join(repo, ".replica", "learning")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({ provider })
  const requests = []
  const labeler = {
    manifest: { id: "copilot", name: "Copilot", version: "test" },
    async label(request) {
      requests.push(structuredClone(request))
      return { labels: [], usage: [] }
    },
  }
  try {
    for (const [index, oldScope] of scopes.entries()) {
      const grant = await store.addGrant(human(oldScope), {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      })
      const log = weekOneLog({
        repository: oldScope.repository,
        snapshotId: `11111111-2222-4333-8444-99999999999${index}`,
      })
      await store.importHubReviewComments(agent(oldScope), log, { grantIds: [grant.id] })
      if (index === 0)
        assert.ok((await labelComments(store, agent(oldScope), { labeler })).considered > 0)
    }
    for (const oldScope of scopes)
      ok(repo, [
        "migrate-scope",
        "--offline",
        "--legacy-repository",
        `github.com/${oldScope.repository}`,
      ])
    const before = requests.length
    const retry = await labelComments(store, agent(scope), { labeler })
    assert.equal(retry.considered, 0)
    assert.equal(requests.length, before)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

it("saves a new proposal after two old names rejected the same theme", async () => {
  const repo = checkout("multiple-rejected-themes")
  const directory = path.join(repo, ".replica", "learning")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const window = { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" }
  try {
    const rejected = []
    for (const [index, oldScope] of scopes.entries()) {
      const grant = await store.addGrant(human(oldScope), {
        purposes: ["review", "instruction"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      })
      const log = weekOneLog({
        repository: oldScope.repository,
        snapshotId: `11111111-2222-4333-8444-77777777777${index}`,
      })
      if (index === 1) for (const call of log.calls) call.result.target.repositoryId = 84
      await store.importHubReviewComments(agent(oldScope), log, { grantIds: [grant.id] })
      await store.annotate(agent(oldScope), weekOneLabels().labels)
      const run = await store.consolidate(agent(oldScope), {
        consolidator: createRecurrenceConsolidator(),
        window,
      })
      assert.equal(run.proposals.length, 1)
      const proposal = run.proposals[0]
      await store.rejectMemory(human(oldScope), proposal.id, {
        expectedDigest: proposal.reviewDigest,
        reason: "Wait for more evidence.",
      })
      rejected.push(proposal.id)
    }
    for (const oldScope of scopes)
      ok(repo, [
        "migrate-scope",
        "--offline",
        "--legacy-repository",
        `github.com/${oldScope.repository}`,
      ])
    const run = await store.consolidate(agent(scope), {
      consolidator: createRecurrenceConsolidator(),
      window,
    })
    assert.equal(run.proposals.length, 1, JSON.stringify(run.diagnostics))
    assert.ok(!rejected.includes(run.proposals[0].id))
    const versions = await provider.readMemoryVersions({ scope })
    assert.ok(
      rejected.every((id) =>
        versions.some((version) => version.id === id && version.state === "rejected"),
      ),
    )
    assert.ok(
      versions.some(
        (version) => version.id === run.proposals[0].id && version.state === "proposed",
      ),
    )
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

it("rolls back migration when a comment version has different stable authors", async () => {
  const repo = checkout("overlap-identity-conflict")
  const directory = path.join(repo, ".replica", "learning")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({ provider })
  const root = weekOneLog()
    .calls.flatMap((call) => call.result.threads ?? [])
    .find((thread) => thread.id === 101)
  async function snapshot(queryScope) {
    return Object.fromEntries(
      await Promise.all(
        Object.keys(STREAMS).map(async (stream) => [
          stream,
          await provider.readRecords(stream, { scope: queryScope }),
        ]),
      ),
    )
  }
  try {
    for (const [index, oldScope] of scopes.entries()) {
      const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
      const grant = await store.addGrant(human, {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      })
      const log = collectionLog({
        repository: oldScope.repository,
        snapshotId: `11111111-2222-4333-8444-66666666666${index}`,
        capturedAt: "2026-10-05T18:00:00.000000Z",
        threads: [
          {
            root: { ...root, author: { ...root.author, githubId: index === 0 ? 41 : 99 } },
            replies: [],
          },
        ],
      })
      await store.importHubReviewComments(human, log, { grantIds: [grant.id] })
    }
    const first = (await provider.readRecords("events", { scope: scopes[0] })).find(
      (event) => event.type === "human_comment",
    )
    const second = (await provider.readRecords("events", { scope: scopes[1] })).find(
      (event) => event.type === "human_comment",
    )
    assert.equal(first.payloadDigest, second.payloadDigest)
    assert.notEqual(first.actor.id, second.actor.id)
    ok(repo, [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      `github.com/${scopes[0].repository}`,
    ])
    const beforeTarget = await snapshot(scope)
    const beforeOld = await snapshot(scopes[1])
    const failed = cli(
      repo,
      ["migrate-scope", "--offline", "--legacy-repository", `github.com/${scopes[1].repository}`],
      { failLookup: true },
    )
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /author|identity|conflict/i)
    assert.deepEqual(await snapshot(scope), beforeTarget)
    assert.deepEqual(await snapshot(scopes[1]), beforeOld)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

it("migrates Solo history and keeps redactions across retries and replay", async () => {
  await checkMigratedHistory("solo")
})

it("migrates Hub history and keeps redactions across retries and replay", async () => {
  await checkMigratedHistory("hosted")
})

it("redacts a Hub UUID store before and after its migration without touching another scope", async () => {
  const repo = checkout("hub-legacy-redaction")
  installLegacyStore(repo, "legacy-hub-scope.sqlite")
  const directory = path.join(repo, ".replica", "learning")
  const legacyScope = { host: "github.com", repository: `repositories/${hubId}` }
  const otherId = "11111111-2222-4333-8444-777777777777"
  const otherScope = { host: "github.com", repository: `repositories/${otherId}` }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({ provider })
  const otherHuman = {
    scope: otherScope,
    principal: { kind: "human", id: "github:other-designer" },
  }
  try {
    const grant = await store.addGrant(otherHuman, {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "Synthetic consent for another repository.",
    })
    const otherLog = weekOneLog({ repository: otherScope.repository })
    for (const call of otherLog.calls) call.result.target.repositoryId = otherId
    await store.importHubReviewComments(otherHuman, otherLog, { grantIds: [grant.id] })
    const otherEvents = await provider.readRecords("events", { scope: otherScope })
    assert.ok(otherEvents.some((event) => event.payload?.commentId === 101))
    assert.ok(otherEvents.some((event) => event.payload?.commentId === 103))
    const flags = [
      "--dir",
      ".replica/learning",
      "--legacy-repository",
      `github.com/repositories/${hubId}`,
      "--legacy-redaction",
    ]
    function redact(commentId) {
      return ["redact", "--comment", String(commentId), "--by", "github:ana-designer", ...flags]
    }
    const legacyEvents = await provider.readRecords("events", { scope: legacyScope })
    const first = legacyEvents.find((event) => event.payload?.commentId === 101)
    const second = legacyEvents.find((event) => event.payload?.commentId === 103)
    assert.ok(first?.payload?.body)
    assert.ok(second?.payload?.body)
    assert.notEqual(cli(repo, ["memories", ...flags], { failLookup: true }).status, 0)
    assert.ok(ok(repo, redact(101), { failLookup: true }).removed > 0)
    assert.equal(ok(repo, redact(101), { failLookup: true }).removed, 0)
    const afterFirst = await provider.readRecords("events", { scope: legacyScope })
    assert.equal(afterFirst.find((event) => event.id === first.id).payload, undefined)
    assert.ok(afterFirst.find((event) => event.id === second.id).payload.body)
    assert.deepEqual(await provider.readRecords("events", { scope: otherScope }), otherEvents)

    const hosted = [
      "--dir",
      ".replica/learning",
      "--repository",
      "github.com/repositories/123456",
      "--legacy-repository",
      `github.com/repositories/${hubId}`,
    ]
    assert.equal(ok(repo, ["verify", ...hosted], { failLookup: true }).ok, true)
    assert.ok(ok(repo, redact(103), { failLookup: true }).removed > 0)
    assert.equal(ok(repo, redact(103), { failLookup: true }).removed, 0)
    const migratedEvents = await provider.readRecords("events", { scope })
    assert.equal(migratedEvents.find((event) => event.id === first.id).payload, undefined)
    assert.equal(migratedEvents.find((event) => event.id === second.id).payload, undefined)
    assert.deepEqual(await provider.readRecords("events", { scope: otherScope }), otherEvents)
    assert.equal(ok(repo, ["verify", ...hosted], { failLookup: true }).ok, true)
    assert.equal(existsSync(path.join(repo, "gh-calls")), false)
  } finally {
    await store.close()
  }
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
    const message = cli(repo, ["migrate-scope", "--offline"], { failLookup: true, json: false })
    assert.equal(message.status, 0, message.stderr)
    assert.match(message.stdout, /The provider is used in place/)
    assert.doesNotMatch(message.stdout, /original provider is unchanged/)
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

it("replays an intermediate repository name after two renames", async () => {
  const repo = checkout("two-renames")
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
  ok(repo, ["import", "hub-comments", "log.json", "--grant", grant.id])
  execFileSync("git", [
    "-C",
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/acme/intermediate-name.git",
  ])
  const intermediate = weekOneLog({
    repository: "acme/intermediate-name",
    snapshotId: "11111111-2222-4333-8444-555555555555",
    capturedAt: "2026-10-06T18:00:00.000000Z",
  })
  writeFileSync(path.join(repo, "intermediate.json"), JSON.stringify(intermediate))
  ok(repo, ["import", "hub-comments", "intermediate.json", "--grant", grant.id])
  execFileSync("git", [
    "-C",
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/acme/current-name.git",
  ])
  const provider = createSqliteMemoryProvider({
    directory: path.join(repo, ".replica", "learning"),
  })
  try {
    const beforeEvents = await provider.readRecords("events", { scope })
    const beforeCollections = await provider.readRecords("collections", { scope })
    ok(repo, ["import", "hub-comments", "intermediate.json", "--grant", grant.id])
    assert.deepEqual(await provider.readRecords("events", { scope }), beforeEvents)
    assert.deepEqual(await provider.readRecords("collections", { scope }), beforeCollections)
    const changed = structuredClone(intermediate)
    changed.calls.find((call) => call.result.threads?.length).result.threads[0].body =
      "A changed comment under the stored snapshot ID."
    writeFileSync(path.join(repo, "changed-intermediate.json"), JSON.stringify(changed))
    assert.notEqual(
      cli(repo, ["import", "hub-comments", "changed-intermediate.json", "--grant", grant.id], {
        failLookup: true,
      }).status,
      0,
    )
    assert.deepEqual(await provider.readRecords("events", { scope }), beforeEvents)
    assert.deepEqual(await provider.readRecords("collections", { scope }), beforeCollections)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await provider.close()
  }
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

it("merges two explicitly confirmed old names and keeps unrelated scopes separate", async () => {
  const repo = checkout("multiple-confirmed-names")
  installLegacyStore(repo, "legacy-scope.sqlite")
  const directory = path.join(repo, ".replica", "learning")
  const firstScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const secondScope = { host: "github.com", repository: "acme/previous-name" }
  const otherScope = { host: "github.com", repository: "other/unrelated" }
  function human(scope) {
    return { scope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(scope) {
    return { scope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  const writer = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grantInput = {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  }
  const secondLog = weekOneLog({
    repository: secondScope.repository,
    snapshotId: "11111111-2222-4333-8444-666666666666",
  })
  for (const call of secondLog.calls) call.result.target.repositoryId = 84
  writeFileSync(path.join(repo, "previous-name.json"), JSON.stringify(secondLog))
  try {
    const firstGrant = (await provider.readRecords("grants", { scope: firstScope }))[0]
    const firstVersions = await provider.readMemoryVersions({ scope: firstScope })
    const secondGrant = await writer.addGrant(human(secondScope), grantInput)
    await writer.importHubReviewComments(agent(secondScope), secondLog, {
      grantIds: [secondGrant.id],
    })
    await writer.annotate(agent(secondScope), weekOneLabels().labels)
    const run = await writer.consolidate(agent(secondScope), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    assert.equal(run.proposals.length, 1)
    await writer.acceptMemory(human(secondScope), run.proposals[0].id, {
      expectedDigest: run.proposals[0].reviewDigest,
    })
    const secondVersions = await provider.readMemoryVersions({ scope: secondScope })
    const otherGrant = await writer.addGrant(human(otherScope), grantInput)
    const firstArgs = [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      "github.com/acme/checkout-prototypes",
    ]
    const secondArgs = [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      "github.com/acme/previous-name",
    ]
    ok(repo, firstArgs)
    assert.deepEqual(await provider.readMemoryVersions({ scope: secondScope }), secondVersions)
    assert.deepEqual(await provider.readRecords("grants", { scope: otherScope }), [otherGrant])
    ok(repo, secondArgs, { failLookup: true })

    const memories = ok(repo, ["memories"], { failLookup: true })
    assert.deepEqual(
      memories.map(({ record }) => record.id).sort(),
      [firstVersions[0].id, secondVersions[0].id].sort(),
    )
    for (const id of [firstVersions[0].id, secondVersions[0].id]) {
      const history = ok(repo, ["show", id, "--history"], { failLookup: true })
      assert.deepEqual(
        history.versions.map((version) => version.state),
        ["proposed", "accepted"],
      )
      assert.equal(history.record.accepted.by.id, "github:ana-designer")
    }
    const migratedVersions = await provider.readMemoryVersions({ scope })
    for (const [oldScope, versions] of [
      [firstScope, firstVersions],
      [secondScope, secondVersions],
    ]) {
      const migration = await migrateRepositoryScope({ provider, oldScope, newScope: scope })
      for (const version of versions) {
        const mapping = migration.digestMappings.find(
          (entry) =>
            entry.kind === "memory" &&
            entry.field === "digest" &&
            entry.oldDigest === version.digest,
        )
        assert.ok(mapping)
        assert.equal(
          mapping.newDigest,
          migratedVersions.find(
            (record) => record.id === version.id && record.version === version.version,
          ).digest,
        )
      }
    }
    const beforeEvents = await provider.readRecords("events", { scope })
    const beforeCollections = await provider.readRecords("collections", { scope })
    ok(repo, ["import", "hub-comments", "log.json", "--grant", firstGrant.id], {
      failLookup: true,
    })
    ok(repo, ["import", "hub-comments", "previous-name.json", "--grant", secondGrant.id], {
      failLookup: true,
    })
    ok(repo, secondArgs, { failLookup: true })
    ok(repo, firstArgs, { failLookup: true })
    assert.deepEqual(await provider.readRecords("events", { scope }), beforeEvents)
    assert.deepEqual(await provider.readRecords("collections", { scope }), beforeCollections)
    assert.deepEqual(await provider.readMemoryVersions({ scope }), migratedVersions)
    assert.deepEqual(await provider.readRecords("grants", { scope: otherScope }), [otherGrant])
    for (const oldScope of [firstScope, secondScope])
      await assert.rejects(writer.addGrant(human(oldScope), grantInput), /scope has migrated/i)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await writer.close()
  }
})

it("preserves identical snapshots when the first history migrates first", async () => {
  const fixture = await identicalSnapshotHistories("same-snapshot-first")
  try {
    fixture.migrate(fixture.scopes[0])
    fixture.migrate(fixture.scopes[1])
    await assertIdenticalSnapshots(fixture)
  } finally {
    await fixture.store.close()
  }
})

it("preserves identical snapshots when the second history migrates first", async () => {
  const fixture = await identicalSnapshotHistories("same-snapshot-second")
  try {
    fixture.migrate(fixture.scopes[1])
    fixture.migrate(fixture.scopes[0])
    await assertIdenticalSnapshots(fixture)
  } finally {
    await fixture.store.close()
  }
})

it("refuses a replay if a later matching snapshot record has different contents", async () => {
  const provider = createInMemoryProvider()
  const store = await createLearningStore({ provider })
  const human = { scope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = {
    scope,
    sourceRepository: "acme/checkout-prototypes",
    principal: { kind: "agent", id: "agent:copilot" },
  }
  const grant = await store.addGrant(human, {
    purposes: ["review"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  })
  const log = weekOneLog({ repository: agent.sourceRepository })
  const imported = await store.importHubReviewComments(agent, log, { grantIds: [grant.id] })
  const conflicting = sealRecord({
    ...imported.collection,
    id: "col_conflictingsnapshot",
    snapshotDigest: `sha256:${"a".repeat(64)}`,
  })
  await provider.appendRecords("collections", [conflicting])
  const before = Object.fromEntries(
    await Promise.all(
      Object.keys(STREAMS).map(async (stream) => [
        stream,
        await provider.readRecords(stream, { scope }),
      ]),
    ),
  )
  assert.deepEqual(
    before.collections.map((record) => record.id),
    [imported.collection.id, conflicting.id],
  )
  await assert.rejects(store.importHubReviewComments(agent, log, { grantIds: [grant.id] }), {
    code: "storage_corrupt",
  })
  assert.equal((await store.verify(human)).ok, false)
  for (const stream of Object.keys(STREAMS))
    assert.deepEqual(await provider.readRecords(stream, { scope }), before[stream])
})

it("rolls back migration when equal snapshot digests have different metadata", async () => {
  const fixture = await identicalSnapshotHistories("same-snapshot-metadata-conflict")
  const { repo, provider, store, collections } = fixture
  const oldScope = { host: "github.com", repository: "acme/metadata-mismatch" }
  const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  async function snapshot(queryScope) {
    return Object.fromEntries(
      await Promise.all(
        Object.keys(STREAMS).map(async (stream) => [
          stream,
          await provider.readRecords(stream, { scope: queryScope }),
        ]),
      ),
    )
  }
  try {
    fixture.migrate(fixture.scopes[0])
    const conflicting = sealRecord({
      ...collections[1],
      id: "col_metadataconflict",
      scope: oldScope,
      capturedAt: "2026-10-05T19:00:00.000000Z",
    })
    const audit = sealRecord({
      ...fixture.audits[1],
      id: "audit_metadataconflict",
      scope: oldScope,
      subjects: [{ kind: "collection", id: conflicting.id, digest: conflicting.digest }],
    })
    await provider.appendRecords("collections", [conflicting], { audit: [audit] })
    const checked = await store.verify(human)
    assert.equal(checked.ok, true, JSON.stringify(checked.problems))
    const beforeTarget = await snapshot(scope)
    const beforeOld = await snapshot(oldScope)
    assert.equal(beforeTarget.collections[0].snapshotDigest, conflicting.snapshotDigest)
    assert.notEqual(beforeTarget.collections[0].capturedAt, conflicting.capturedAt)
    const refused = cli(
      repo,
      ["migrate-scope", "--offline", "--legacy-repository", "github.com/acme/metadata-mismatch"],
      { failLookup: true },
    )
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /snapshot|conflict|disagree/i)
    assert.deepEqual(await snapshot(scope), beforeTarget)
    assert.deepEqual(await snapshot(oldScope), beforeOld)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

it("refuses an import when a migration stores the same snapshot during its write", async () => {
  const fixture = await identicalSnapshotHistories("same-snapshot-import-race")
  const { provider, scopes } = fixture
  const ready = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const forwarding = {
    ...provider,
    async appendBatch(batch, options) {
      if (batch.collections?.length) {
        ready.resolve()
        await resume.promise
      }
      return provider.appendBatch(batch, options)
    },
  }
  const store = await createLearningStore({ provider: forwarding })
  const human = { scope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = {
    scope,
    sourceRepository: scopes[0].repository,
    principal: { kind: "agent", id: "agent:copilot" },
  }
  const seedScope = { host: "github.com", repository: "acme/earlier-name" }
  let pending
  try {
    const grant = await fixture.store.addGrant(
      { ...human, scope: seedScope },
      {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      },
    )
    fixture.migrate(seedScope)
    const changed = weekOneLog({ repository: agent.sourceRepository })
    changed.calls.find((call) => call.result.threads?.length).result.threads[0].body =
      "A different comment under the same snapshot ID."
    pending = store.importHubReviewComments(agent, changed, { grantIds: [grant.id] })
    await Promise.race([
      ready.promise,
      pending.then(
        () => {
          throw new Error("The import finished before the write was paused.")
        },
        (error) => {
          throw error
        },
      ),
    ])
    fixture.migrate(scopes[0])
    const before = Object.fromEntries(
      await Promise.all(
        Object.keys(STREAMS).map(async (stream) => [
          stream,
          await provider.readRecords(stream, { scope }),
        ]),
      ),
    )
    resume.resolve()
    await assert.rejects(pending, { code: "conflict" })
    for (const stream of Object.keys(STREAMS))
      assert.deepEqual(await provider.readRecords(stream, { scope }), before[stream])
    assert.equal(before.collections.length, 1)
    assert.equal(ok(fixture.repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    resume.resolve()
    if (pending) await pending.catch(() => {})
    await fixture.store.close()
  }
})

it("refuses a new snapshot when another history migrates during its import", async () => {
  const fixture = await identicalSnapshotHistories("new-snapshot-migration-race")
  const { provider, scopes } = fixture
  const ready = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const forwarding = {
    ...provider,
    async appendBatch(batch, options) {
      if (batch.collections?.length) {
        ready.resolve()
        await resume.promise
      }
      return provider.appendBatch(batch, options)
    },
  }
  const store = await createLearningStore({ provider: forwarding })
  const human = { scope, principal: { kind: "human", id: "github:ana-designer" } }
  const agent = {
    scope,
    sourceRepository: scopes[0].repository,
    principal: { kind: "agent", id: "agent:copilot" },
  }
  const seedScope = { host: "github.com", repository: "acme/earlier-name" }
  let pending
  try {
    const grant = await fixture.store.addGrant(
      { ...human, scope: seedScope },
      {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      },
    )
    fixture.migrate(seedScope)
    const snapshotId = "11111111-2222-4333-8444-333333333333"
    const log = weekOneLog({
      repository: agent.sourceRepository,
      snapshotId,
    })
    pending = store.importHubReviewComments(agent, log, { grantIds: [grant.id] })
    await Promise.race([
      ready.promise,
      pending.then(
        () => {
          throw new Error("The import finished before the write was paused.")
        },
        (error) => {
          throw error
        },
      ),
    ])
    fixture.migrate(scopes[0])
    const before = Object.fromEntries(
      await Promise.all(
        Object.keys(STREAMS).map(async (stream) => [
          stream,
          await provider.readRecords(stream, { scope }),
        ]),
      ),
    )
    resume.resolve()
    await assert.rejects(pending, { code: "conflict" })
    for (const stream of Object.keys(STREAMS))
      assert.deepEqual(await provider.readRecords(stream, { scope }), before[stream])
    assert.ok(before.collections.every((collection) => collection.snapshotId !== snapshotId))
    const retried = await store.importHubReviewComments(agent, log, { grantIds: [grant.id] })
    assert.equal(retried.collection.snapshotId, snapshotId)
    assert.equal(ok(fixture.repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    resume.resolve()
    if (pending) await pending.catch(() => {})
    await fixture.store.close()
  }
})

it("refuses a proposal when another history migrates during its write", async () => {
  const repo = checkout("proposal-migration-race")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({
    directory: path.join(repo, ".replica", "learning"),
  })
  function clock() {
    return Date.parse("2026-10-09T12:00:00Z")
  }
  const source = await createLearningStore({ provider, clock })
  const ready = Promise.withResolvers()
  const resume = Promise.withResolvers()
  const forwarding = {
    ...provider,
    async appendMemoryVersion(record, options) {
      ready.resolve()
      await resume.promise
      return provider.appendMemoryVersion(record, options)
    },
  }
  const store = await createLearningStore({ provider: forwarding, clock })
  let pending
  try {
    const grantInput = {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments.",
    }
    const grant = await source.addGrant(human(scopes[0]), grantInput)
    await source.importHubReviewComments(agent(scopes[0]), weekOneLog(), { grantIds: [grant.id] })
    await source.annotate(agent(scopes[0]), weekOneLabels().labels)
    await source.addGrant(human(scopes[1]), grantInput)
    await migrateRepositoryScope({ provider, oldScope: scopes[0], newScope: scope, clock })
    const preview = await store.consolidate(agent(scope), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
      dryRun: true,
    })
    assert.equal(preview.proposals.length, 1)
    pending = store.proposeMemory(agent(scope), preview.proposals[0])
    await Promise.race([
      ready.promise,
      pending.then(
        () => {
          throw new Error("The proposal finished before the write was paused.")
        },
        (error) => {
          throw error
        },
      ),
    ])
    await migrateRepositoryScope({ provider, oldScope: scopes[1], newScope: scope, clock })
    const beforeVersions = await provider.readMemoryVersions({ scope })
    const beforeAudit = await provider.readRecords("audit", { scope })
    assert.deepEqual(beforeVersions, [])
    resume.resolve()
    await assert.rejects(pending, { code: "conflict" })
    assert.deepEqual(await provider.readMemoryVersions({ scope }), beforeVersions)
    assert.deepEqual(await provider.readRecords("audit", { scope }), beforeAudit)
    const retried = await store.proposeMemory(agent(scope), preview.proposals[0])
    assert.equal(retried.state, "proposed")
    assert.equal((await source.verify(human(scope))).ok, true)
  } finally {
    resume.resolve()
    if (pending) await pending.catch(() => {})
    await source.close()
  }
})

async function identicalSnapshotHistories(name) {
  const repo = checkout(name)
  const directory = path.join(repo, ".replica", "learning")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  const provider = createSqliteMemoryProvider({ directory })
  let now = Date.parse("2026-10-09T12:00:00Z")
  const store = await createLearningStore({ provider, clock: () => now })
  const log = weekOneLog({ repository: scopes[0].repository })
  writeFileSync(path.join(repo, "same-snapshot.json"), JSON.stringify(log))
  const grants = []
  const collections = []
  const audits = []
  const exports = []
  try {
    for (let index = 0; index < scopes.length; index++) {
      const oldScope = scopes[index]
      const human = { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
      const agent = {
        scope: oldScope,
        sourceRepository: scopes[0].repository,
        principal: { kind: "agent", id: index === 0 ? "agent:copilot" : "agent:reviewer" },
      }
      const grant = await store.addGrant(human, {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      })
      grants.push(grant)
      const imported = await store.importHubReviewComments(agent, log, { grantIds: [grant.id] })
      collections.push(imported.collection)
      const entries = await provider.readRecords("audit", { scope: oldScope })
      audits.push(entries.find((entry) => entry.operation === "collection.import"))
      const exported = await store.exportRecords(human, {
        purpose: "review",
        destination: `history-${index}.json`,
      })
      exports.push(exported.manifest)
      now += 86_400_000
    }
    assert.notEqual(collections[0].id, collections[1].id)
    assert.equal(collections[0].snapshotId, collections[1].snapshotId)
    assert.equal(collections[0].snapshotDigest, collections[1].snapshotDigest)
    assert.notEqual(collections[0].importedAt, collections[1].importedAt)
    assert.notDeepEqual(collections[0].importedBy, collections[1].importedBy)
    return {
      repo,
      provider,
      store,
      scopes,
      grants,
      collections,
      audits,
      exports,
      migrate(oldScope) {
        return ok(repo, [
          "migrate-scope",
          "--offline",
          "--legacy-repository",
          `github.com/${oldScope.repository}`,
        ])
      },
    }
  } catch (error) {
    await store.close()
    throw error
  }
}

async function assertIdenticalSnapshots(fixture) {
  const { repo, provider, scopes, grants, collections, audits, exports } = fixture
  const migrated = await provider.readRecords("collections", { scope })
  assert.equal(migrated.length, 2)
  const migratedAudits = await provider.readRecords("audit", { scope })
  const migratedExports = await provider.readRecords("exports", { scope })
  for (let index = 0; index < scopes.length; index++) {
    const original = collections[index]
    const collection = migrated.find((record) => record.id === original.id)
    assert.ok(collection)
    assert.equal(collection.snapshotDigest, original.snapshotDigest)
    assert.equal(collection.importedAt, original.importedAt)
    assert.deepEqual(collection.importedBy, original.importedBy)
    const migration = await migrateRepositoryScope({
      provider,
      oldScope: scopes[index],
      newScope: scope,
    })
    assert.ok(
      migration.digestMappings.some(
        (entry) =>
          entry.kind === "collection" &&
          entry.id === original.id &&
          entry.oldDigest === original.digest &&
          entry.newDigest === collection.digest,
      ),
    )
    const audit = migratedAudits.find((entry) => entry.id === audits[index].id)
    assert.ok(
      audit?.subjects.some(
        (item) => item.id === collection.id && item.digest === collection.digest,
      ),
    )
    const manifest = migratedExports.find((entry) => entry.id === exports[index].id)
    assert.ok(
      manifest?.records.some(
        (item) => item.id === collection.id && item.digest === collection.digest,
      ),
    )
  }
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  const beforeEvents = await provider.readRecords("events", { scope })
  const beforeExports = await provider.readRecords("exports", { scope })
  for (const grant of grants)
    ok(repo, ["import", "hub-comments", "same-snapshot.json", "--grant", grant.id], {
      failLookup: true,
    })
  for (const oldScope of scopes) fixture.migrate(oldScope)
  assert.deepEqual(await provider.readRecords("collections", { scope }), migrated)
  assert.deepEqual(await provider.readRecords("events", { scope }), beforeEvents)
  assert.deepEqual(await provider.readRecords("exports", { scope }), beforeExports)
  assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
}

it("preserves overlapping histories when the redacted name migrates first", async () => {
  await checkOverlappingHistories("redacted-first")
})

it("preserves overlapping histories when the retracted name migrates first", async () => {
  await checkOverlappingHistories("retracted-first")
})

it("keeps separate withdrawn evidence withheld when its history migrates first", async () => {
  const fixture = await consentHistories("separate-withdrawn-first")
  const { store, human, agent, scopes, grants, memories, comments, grantInput } = fixture
  try {
    await store.withdrawGrant(human(scopes[0]), grants[0].id, {
      purposes: ["review", "instruction"],
    })
    assert.deepEqual((await store.recall(agent(scopes[0]))).memories, [])
    fixture.migrate(scopes[0])
    fixture.migrate(scopes[1])
    assert.equal(ok(fixture.repo, ["verify"], { failLookup: true }).ok, true)
    for (const purpose of ["review", "instruction"])
      assert.deepEqual(await fixture.observe(purpose), [comments[1]])
    assert.ok(!(await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
    await store.addGrant(human(scope), {
      ...grantInput,
      basis: "The team agreed to use the earlier evidence again.",
    })
    assert.deepEqual(new Set(await fixture.observe("instruction")), new Set(comments))
    assert.ok((await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
  } finally {
    await store.close()
  }
})

it("keeps separate withdrawn evidence withheld when its history migrates second", async () => {
  const fixture = await consentHistories("separate-withdrawn-second")
  const { store, human, agent, scopes, grants, memories, comments, grantInput } = fixture
  try {
    await store.withdrawGrant(human(scopes[0]), grants[0].id, {
      purposes: ["review", "instruction"],
    })
    assert.deepEqual((await store.recall(agent(scopes[0]))).memories, [])
    fixture.migrate(scopes[1])
    fixture.migrate(scopes[0])
    assert.equal(ok(fixture.repo, ["verify"], { failLookup: true }).ok, true)
    for (const purpose of ["review", "instruction"])
      assert.deepEqual(await fixture.observe(purpose), [comments[1]])
    assert.ok(!(await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
    await store.addGrant(human(scope), {
      ...grantInput,
      basis: "The team agreed to use the earlier evidence again.",
    })
    assert.deepEqual(new Set(await fixture.observe("instruction")), new Set(comments))
    assert.ok((await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
  } finally {
    await store.close()
  }
})

it("keeps overlapping withdrawn evidence withheld when its history migrates first", async () => {
  const fixture = await consentHistories("overlap-withdrawn-first", { overlapping: true })
  const { store, provider, human, agent, scopes, grants, memories, comments, grantInput } = fixture
  try {
    await store.withdrawGrant(human(scopes[0]), grants[0].id, {
      purposes: ["review", "instruction"],
    })
    assert.deepEqual((await store.recall(agent(scopes[0]))).memories, [])
    fixture.migrate(scopes[0])
    fixture.migrate(scopes[1])
    assert.equal(ok(fixture.repo, ["verify"], { failLookup: true }).ok, true)
    for (const purpose of ["review", "instruction"]) {
      assert.deepEqual(await fixture.observe(purpose), [])
      for (const id of comments) assert.deepEqual(await fixture.observe(purpose, [id]), [])
    }
    assert.ok(!(await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
    const laterLog = weekOneLog({
      repository: scopes[0].repository,
      snapshotId: "11111111-2222-4333-8444-bbbbbbbbbbbb",
      capturedAt: "2026-10-11T18:00:00.000000Z",
    })
    for (const call of laterLog.calls)
      for (const thread of call.result.threads ?? [])
        if (thread.id === 101) {
          thread.body = "The later edit keeps labels outside their fields."
          thread.editedAt = "2026-10-10T09:00:00.000000Z"
          thread.updatedAt = thread.editedAt
        }
    writeFileSync(path.join(fixture.repo, "later-edit.json"), JSON.stringify(laterLog))
    ok(fixture.repo, ["import", "hub-comments", "later-edit.json", "--grant", grants[1].id], {
      failLookup: true,
    })
    const edited = (await provider.readRecords("events", { scope })).find(
      (event) => event.payload?.body === "The later edit keeps labels outside their fields.",
    )
    assert.ok(edited)
    assert.deepEqual(await fixture.observe("instruction", [edited.id]), [edited.id])
    assert.deepEqual(await fixture.observe("instruction", comments), [])
    await store.addGrant(human(scope), {
      ...grantInput,
      basis: "The team agreed to use the earlier evidence again.",
    })
    assert.deepEqual(new Set(await fixture.observe("instruction")), new Set(comments))
    for (const id of comments) assert.deepEqual(await fixture.observe("instruction", [id]), [id])
    assert.ok((await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
  } finally {
    await store.close()
  }
})

it("keeps overlapping withdrawn evidence withheld when its history migrates second", async () => {
  const fixture = await consentHistories("overlap-withdrawn-second", { overlapping: true })
  const { store, human, agent, scopes, grants, memories, comments, grantInput } = fixture
  try {
    await store.withdrawGrant(human(scopes[0]), grants[0].id, {
      purposes: ["review", "instruction"],
    })
    assert.deepEqual((await store.recall(agent(scopes[0]))).memories, [])
    fixture.migrate(scopes[1])
    fixture.migrate(scopes[0])
    assert.equal(ok(fixture.repo, ["verify"], { failLookup: true }).ok, true)
    for (const purpose of ["review", "instruction"]) {
      assert.deepEqual(await fixture.observe(purpose), [])
      for (const id of comments) assert.deepEqual(await fixture.observe(purpose, [id]), [])
    }
    assert.ok(!(await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
    await store.addGrant(human(scope), {
      ...grantInput,
      basis: "The team agreed to use the earlier evidence again.",
    })
    assert.deepEqual(new Set(await fixture.observe("instruction")), new Set(comments))
    for (const id of comments) assert.deepEqual(await fixture.observe("instruction", [id]), [id])
    assert.ok((await store.recall(agent(scope))).memories.some((item) => item.id === memories[0]))
  } finally {
    await store.close()
  }
})

it("does not revive an older label when a newer comment version is withheld", async () => {
  const repo = checkout("withheld-newer-comment")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({
    directory: path.join(repo, ".replica", "learning"),
  })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grantInput = {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  }
  const root = weekOneLog()
    .calls.flatMap((call) => call.result.threads ?? [])
    .find((thread) => thread.id === 101)
  const label = weekOneLabels().labels.find((item) => item.target.commentId === 101)
  const window = { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-08T18:00:00.000000Z" }
  const consolidator = createRecurrenceConsolidator({
    minEpisodes: 1,
    minPrototypes: 1,
    minReviewers: 1,
  })
  try {
    const firstGrant = await store.addGrant(human(scopes[0]), grantInput)
    const first = collectionLog({
      repository: scopes[0].repository,
      snapshotId: "11111111-2222-4333-8444-111111111111",
      capturedAt: "2026-10-05T18:00:00.000000Z",
      threads: [{ root, replies: [] }],
    })
    await store.importHubReviewComments(agent(scopes[0]), first, { grantIds: [firstGrant.id] })
    await store.annotate(agent(scopes[0]), [label])
    assert.equal(
      (await store.consolidate(agent(scopes[0]), { consolidator, window, dryRun: true })).proposals
        .length,
      1,
    )
    const oldComment = (await provider.readRecords("events", { scope: scopes[0] })).find(
      (event) => event.type === "human_comment" && event.payload?.commentId === 101,
    )
    const secondGrant = await store.addGrant(human(scopes[1]), grantInput)
    const editedAt = "2026-10-07T09:00:00.000000Z"
    const second = collectionLog({
      repository: scopes[1].repository,
      snapshotId: "11111111-2222-4333-8444-222222222222",
      capturedAt: "2026-10-08T18:00:00.000000Z",
      threads: [
        { root: { ...root, body: "A newer version.", editedAt, updatedAt: editedAt }, replies: [] },
      ],
    })
    await store.importHubReviewComments(agent(scopes[1]), second, { grantIds: [secondGrant.id] })
    const newComment = (await provider.readRecords("events", { scope: scopes[1] })).find(
      (event) => event.type === "human_comment" && event.payload?.commentId === 101,
    )
    assert.equal(newComment.supersedes, undefined)
    await store.withdrawGrant(human(scopes[1]), secondGrant.id, {
      purposes: ["review", "instruction"],
    })
    for (const oldScope of scopes)
      await migrateRepositoryScope({ provider, oldScope, newScope: scope })
    const selected = await store.queryObservations(human(scope), {
      purpose: "instruction",
      eventIds: [oldComment.id, newComment.id],
    })
    assert.deepEqual(
      selected.events.map((event) => event.id),
      [oldComment.id],
    )
    const withheld = await store.consolidate(agent(scope), { consolidator, window, dryRun: true })
    assert.deepEqual(withheld.proposals, [])

    await store.addGrant(human(scope), grantInput)
    assert.deepEqual(
      (await store.consolidate(agent(scope), { consolidator, window, dryRun: true })).proposals,
      [],
    )
    await store.annotate(agent(scope), [{ ...label, target: { eventId: newComment.id } }])
    const current = await store.consolidate(agent(scope), { consolidator, window, dryRun: true })
    assert.equal(current.proposals.length, 1)
    assert.ok(current.proposals[0].evidence.some((item) => item.eventIds.includes(newComment.id)))
    assert.equal((await store.verify(human(scope))).ok, true)
  } finally {
    await store.close()
  }
})

it("records both historical grants for an export of overlapping evidence", async () => {
  const repo = checkout("overlap-export-grants")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({
    directory: path.join(repo, ".replica", "learning"),
  })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grants = []
  try {
    for (let index = 0; index < scopes.length; index++) {
      const oldScope = scopes[index]
      const grant = await store.addGrant(human(oldScope), {
        purposes: ["review", "instruction"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      })
      grants.push(grant)
      const log = weekOneLog({
        repository: oldScope.repository,
        snapshotId: `11111111-2222-4333-8444-99999999999${index}`,
      })
      await store.importHubReviewComments(agent(oldScope), log, { grantIds: [grant.id] })
      if (index === 0) {
        await store.annotate(agent(oldScope), weekOneLabels().labels)
        const run = await store.consolidate(agent(oldScope), {
          consolidator: createRecurrenceConsolidator(),
          window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
        })
        assert.equal(run.proposals.length, 1)
        await store.acceptMemory(human(oldScope), run.proposals[0].id, {
          expectedDigest: run.proposals[0].reviewDigest,
        })
      }
    }
    for (const oldScope of scopes)
      ok(repo, [
        "migrate-scope",
        "--offline",
        "--legacy-repository",
        `github.com/${oldScope.repository}`,
      ])
    const exported = await store.exportRecords(human(scope), {
      purpose: "instruction",
      destination: "synthetic-export.json",
      contents: "learnings",
    })
    assert.equal(exported.manifest.counts.memories, 1)
    assert.deepEqual(
      exported.manifest.records
        .filter((record) => record.kind === "grant")
        .map((record) => record.id)
        .sort(),
      grants.map((grant) => grant.id).sort(),
    )
    for (const grant of grants) {
      const result = await store.withdrawGrant(human(scope), grant.id, {
        purposes: ["instruction"],
      })
      assert.ok(result.exportsToFollowUp.some((item) => item.id === exported.manifest.id))
    }
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
})

async function consentHistories(name, { overlapping = false } = {}) {
  const repo = checkout(name)
  const directory = path.join(repo, ".replica", "learning")
  const scopes = [
    { host: "github.com", repository: "acme/checkout-prototypes" },
    { host: "github.com", repository: "acme/previous-name" },
  ]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({
    provider,
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grantInput = {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  }
  const grants = []
  const memories = []
  const comments = []
  try {
    for (let index = 0; index < scopes.length; index++) {
      const oldScope = scopes[index]
      const grant = await store.addGrant(human(oldScope), grantInput)
      grants.push(grant)
      const log = weekOneLog({
        repository: oldScope.repository,
        snapshotId: `11111111-2222-4333-8444-88888888888${index}`,
      })
      if (index === 1 && !overlapping)
        for (const call of log.calls) call.result.target.repositoryId = 84
      await store.importHubReviewComments(agent(oldScope), log, { grantIds: [grant.id] })
      await store.annotate(agent(oldScope), weekOneLabels().labels)
      const run = await store.consolidate(agent(oldScope), {
        consolidator: createRecurrenceConsolidator(),
        window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
      })
      assert.equal(run.proposals.length, 1)
      const memory = run.proposals[0]
      await store.acceptMemory(human(oldScope), memory.id, { expectedDigest: memory.reviewDigest })
      memories.push(memory.id)
      const events = await provider.readRecords("events", { scope: oldScope })
      comments.push(events.find((event) => event.payload?.commentId === 101).id)
    }
    return {
      repo,
      store,
      provider,
      human,
      agent,
      scopes,
      grants,
      memories,
      comments,
      grantInput,
      migrate(oldScope) {
        return ok(repo, [
          "migrate-scope",
          "--offline",
          "--legacy-repository",
          `github.com/${oldScope.repository}`,
        ])
      },
      async observe(purpose, eventIds = comments) {
        const selected = await store.queryObservations(human(scope), { purpose, eventIds })
        return selected.events.map((event) => event.id)
      },
    }
  } catch (error) {
    await store.close()
    throw error
  }
}

async function checkOverlappingHistories(order) {
  const repo = checkout(`overlapping-${order}`)
  const directory = path.join(repo, ".replica", "learning")
  const firstScope = { host: "github.com", repository: "acme/checkout-prototypes" }
  const secondScope = { host: "github.com", repository: "acme/previous-name" }
  const scopes = [firstScope, secondScope]
  function human(oldScope) {
    return { scope: oldScope, principal: { kind: "human", id: "github:ana-designer" } }
  }
  function agent(oldScope) {
    return { scope: oldScope, principal: { kind: "agent", id: "agent:copilot" } }
  }
  const provider = createSqliteMemoryProvider({ directory })
  let now = Date.parse("2026-10-09T12:00:00Z")
  const store = await createLearningStore({
    provider,
    clock: () => now,
  })
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
  const marker = "synthetic-redacted-overlap-7e8f"
  const logs = scopes.map((oldScope, index) =>
    JSON.parse(
      JSON.stringify(
        weekOneLog({
          repository: oldScope.repository,
          snapshotId: `11111111-2222-4333-8444-66666666666${index}`,
        }),
      ).replaceAll("Put each label above its field.", marker),
    ),
  )
  const deletedLog = JSON.parse(
    JSON.stringify(
      weekOneLog({
        repository: secondScope.repository,
        snapshotId: "11111111-2222-4333-8444-777777777777",
        capturedAt: "2026-10-08T18:00:00.000000Z",
      }),
    ).replaceAll("Put each label above its field.", marker),
  )
  for (const call of deletedLog.calls)
    for (const thread of call.result.threads ?? [])
      if (thread.id === 103) {
        thread.body = null
        thread.deletedAt = "2026-10-07T09:00:00.000000Z"
        thread.updatedAt = thread.deletedAt
      }
  writeFileSync(path.join(repo, "first-overlap.json"), JSON.stringify(logs[0]))
  writeFileSync(path.join(repo, "second-overlap.json"), JSON.stringify(logs[1]))
  writeFileSync(path.join(repo, "deleted-overlap.json"), JSON.stringify(deletedLog))
  const window = { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-08T18:00:00.000000Z" }
  try {
    const grants = []
    for (let index = 0; index < scopes.length; index++) {
      const oldScope = scopes[index]
      const grant = await store.addGrant(human(oldScope), {
        purposes: ["review", "instruction"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to learn from review comments.",
      })
      grants.push(grant)
      await store.importHubReviewComments(agent(oldScope), logs[index], { grantIds: [grant.id] })
      await store.annotate(agent(oldScope), weekOneLabels().labels)
      const run = await store.consolidate(agent(oldScope), {
        consolidator: createRecurrenceConsolidator(),
        window,
      })
      assert.equal(run.proposals.length, 1)
      await store.acceptMemory(human(oldScope), run.proposals[0].id, {
        expectedDigest: run.proposals[0].reviewDigest,
      })
    }
    const firstEvents = await provider.readRecords("events", { scope: firstScope })
    const secondEvents = await provider.readRecords("events", { scope: secondScope })
    const first103 = firstEvents.find((event) => event.payload?.commentId === 103)
    const second101 = secondEvents.find((event) => event.payload?.commentId === 101)
    const second103 = secondEvents.find((event) => event.payload?.commentId === 103)
    assert.ok(first103 && second101 && second103)
    await store.redactHubComment(human(firstScope), 101)
    await store.importHubReviewComments(agent(secondScope), deletedLog, {
      grantIds: [grants[1].id],
    })
    const originals = await Promise.all(scopes.map(snapshot))
    assert.ok(
      originals[1].records.events.some(
        (event) => event.type === "retraction" && event.parentEventId === second103.id,
      ),
    )
    const file = provider.manifest().storage.location
    assert.ok(readFileSync(file).includes(marker))
    const ordered = order === "redacted-first" ? scopes : [...scopes].reverse()
    function migrateArgs(oldScope) {
      return [
        "migrate-scope",
        "--offline",
        "--legacy-repository",
        `github.com/${oldScope.repository}`,
      ]
    }
    ok(repo, migrateArgs(ordered[0]))
    const beforeTarget = await snapshot(scope)
    const beforeOld = await snapshot(ordered[1])
    const attempted = cli(repo, migrateArgs(ordered[1]), { failLookup: true })
    if (attempted.status !== 0) {
      assert.deepEqual(await snapshot(scope), beforeTarget)
      assert.deepEqual(await snapshot(ordered[1]), beforeOld)
    }
    assert.equal(attempted.status, 0, attempted.stderr)
    const merged = await snapshot(scope)
    const kinds = {
      grants: "grant",
      withdrawals: "withdrawal",
      episodes: "episode",
      events: "event",
      collections: "collection",
      exports: "export",
      audit: "audit",
    }
    for (let index = 0; index < scopes.length; index++) {
      const migration = await migrateRepositoryScope({
        provider,
        oldScope: scopes[index],
        newScope: scope,
      })
      for (const stream of Object.keys(STREAMS)) {
        for (const record of originals[index].records[stream]) {
          const updated = merged.records[stream].find((item) => item.id === record.id)
          assert.ok(updated, `${stream} ${record.id} was lost`)
          assert.ok(
            migration.digestMappings.some(
              (entry) =>
                entry.kind === kinds[stream] &&
                entry.id === record.id &&
                entry.field === "digest" &&
                entry.oldDigest === record.digest &&
                entry.newDigest === updated.digest,
            ),
            `${stream} ${record.id} has no digest mapping`,
          )
        }
      }
      for (const version of originals[index].memories) {
        const updated = merged.memories.find(
          (item) => item.id === version.id && item.version === version.version,
        )
        assert.ok(updated)
        assert.deepEqual(updated.state, version.state)
        assert.deepEqual(updated.content, version.content)
        if (version.accepted) {
          assert.deepEqual(updated.accepted.by, version.accepted.by)
          assert.equal(updated.accepted.at, version.accepted.at)
          assert.ok(
            migration.digestMappings.some(
              (entry) =>
                entry.kind === "memory-review" &&
                entry.id === version.id &&
                entry.oldDigest === version.accepted.reviewedDigest &&
                entry.newDigest === updated.accepted.reviewedDigest,
            ),
          )
        }
        assert.ok(
          migration.digestMappings.some(
            (entry) =>
              entry.kind === "memory" &&
              entry.field === "digest" &&
              entry.oldDigest === version.digest &&
              entry.newDigest === updated.digest,
          ),
        )
      }
    }
    assert.equal(
      merged.records.events.find((event) => event.id === second101.id).payload,
      undefined,
    )
    for (const name of [file, `${file}-wal`])
      if (existsSync(name)) assert.equal(readFileSync(name).includes(marker), false)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
    for (const [fileName, grant] of [
      ["first-overlap.json", grants[0]],
      ["second-overlap.json", grants[1]],
      ["deleted-overlap.json", grants[1]],
    ])
      ok(repo, ["import", "hub-comments", fileName, "--grant", grant.id], { failLookup: true })
    ok(repo, migrateArgs(ordered[1]), { failLookup: true })
    const replayed = await snapshot(scope)
    for (const stream of Object.keys(STREAMS).filter((name) => name !== "audit"))
      assert.deepEqual(replayed.records[stream], merged.records[stream])
    assert.deepEqual(replayed.memories, merged.memories)
    for (const name of [file, `${file}-wal`])
      if (existsSync(name)) assert.equal(readFileSync(name).includes(marker), false)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)

    for (const eventId of [first103.id, second101.id]) {
      const selected = await store.queryObservations(human(scope), {
        purpose: "instruction",
        eventIds: [eventId],
      })
      assert.equal(
        selected.events.some((event) => event.id === eventId),
        false,
      )
    }
    assert.deepEqual((await store.recall(agent(scope))).memories, [])
    const result = await store.consolidate(agent(scope), {
      consolidator: createRecurrenceConsolidator(),
      window,
      dryRun: true,
    })
    assert.ok(result.proposals.length > 0)
    for (const proposal of result.proposals) {
      const threads = proposal.evidence.map(
        ({ source }) =>
          `${source.hubOrigin}:${source.repositoryId}:${source.prototypeId}:${source.threadId}`,
      )
      assert.equal(proposal.support.distinctEpisodes, new Set(threads).size)
      assert.ok(proposal.evidence.every(({ eventIds }) => !eventIds.includes(first103.id)))
      assert.ok(proposal.evidence.every(({ eventIds }) => !eventIds.includes(second101.id)))
    }

    const currentLog = weekOneLog({
      repository: firstScope.repository,
      snapshotId: "11111111-2222-4333-8444-aaaaaaaaaaaa",
      capturedAt: "2026-10-11T18:00:00.000000Z",
    })
    for (const call of currentLog.calls)
      for (const thread of call.result.threads ?? []) {
        if (thread.id === 101) {
          thread.body = "The later edit keeps labels outside their fields."
          thread.editedAt = "2026-10-10T09:00:00.000000Z"
          thread.updatedAt = thread.editedAt
        }
        if (thread.id === 103) {
          thread.body = null
          thread.deletedAt = "2026-10-07T09:00:00.000000Z"
          thread.updatedAt = thread.deletedAt
        }
      }
    writeFileSync(path.join(repo, "current-overlap.json"), JSON.stringify(currentLog))
    ok(repo, ["import", "hub-comments", "current-overlap.json", "--grant", grants[0].id], {
      failLookup: true,
    })
    now = Date.parse("2026-10-12T12:00:00Z")
    const afterImport = await provider.readRecords("events", { scope })
    assert.equal(afterImport.find((event) => event.id === second101.id).payload, undefined)
    const edited = afterImport.find(
      (event) =>
        event.type === "human_comment" &&
        event.payload?.body === "The later edit keeps labels outside their fields.",
    )
    assert.ok(edited)
    const selected = await store.queryObservations(human(scope), {
      purpose: "instruction",
      eventIds: [first103.id, second101.id, edited.id],
    })
    assert.ok(selected.events.some((event) => event.id === edited.id))
    assert.ok(!selected.events.some((event) => [first103.id, second101.id].includes(event.id)))
    const label = weekOneLabels().labels.find((item) => item.target.commentId === 101)
    await store.annotate(agent(scope), [{ ...label, target: { eventId: edited.id } }])
    const updated = await store.consolidate(agent(scope), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: window.from, to: "2026-10-11T18:00:00.000000Z" },
      dryRun: true,
    })
    assert.ok(updated.proposals.length > 0)
    for (const proposal of updated.proposals) {
      const threads = proposal.evidence.map(
        ({ source }) =>
          `${source.hubOrigin}:${source.repositoryId}:${source.prototypeId}:${source.threadId}`,
      )
      assert.equal(proposal.support.distinctEpisodes, new Set(threads).size)
    }
    for (const name of [file, `${file}-wal`])
      if (existsSync(name)) assert.equal(readFileSync(name).includes(marker), false)
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
}

it("keeps both scopes intact when two confirmed names reuse a snapshot ID", async () => {
  const repo = checkout("multiple-name-collision")
  installLegacyStore(repo, "legacy-scope.sqlite")
  const directory = path.join(repo, ".replica", "learning")
  const secondScope = { host: "github.com", repository: "acme/previous-name" }
  const human = { scope: secondScope, principal: { kind: "human", id: "github:ana-designer" } }
  const provider = createSqliteMemoryProvider({ directory })
  const store = await createLearningStore({ provider })
  const input = {
    purposes: ["review"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  }
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
    const grant = await store.addGrant(human, input)
    const log = weekOneLog({ repository: secondScope.repository })
    for (const call of log.calls) call.result.target.repositoryId = 84
    await store.importHubReviewComments(human, log, { grantIds: [grant.id] })
    ok(repo, [
      "migrate-scope",
      "--offline",
      "--legacy-repository",
      "github.com/acme/checkout-prototypes",
    ])
    const beforeTarget = await snapshot(scope)
    const beforeOld = await snapshot(secondScope)
    const failed = cli(
      repo,
      ["migrate-scope", "--offline", "--legacy-repository", "github.com/acme/previous-name"],
      { failLookup: true },
    )
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /snapshot|conflict|colli/i)
    assert.deepEqual(await snapshot(scope), beforeTarget)
    assert.deepEqual(await snapshot(secondScope), beforeOld)
    await store.addGrant(human, {
      ...input,
      basis: "The old scope remains writable after failure.",
    })
    assert.equal(ok(repo, ["verify"], { failLookup: true }).ok, true)
  } finally {
    await store.close()
  }
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
