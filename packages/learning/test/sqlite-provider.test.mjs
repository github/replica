import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { after, describe, it } from "node:test"
import { agent, designer, weekOneLog, weekTwoLog } from "../conformance/index.mjs"
import { STREAMS } from "../src/provider-contract.mjs"
import { createSqliteMemoryProvider } from "../src/providers/sqlite.mjs"
import { SCHEMA_VERSIONS, sealRecord } from "../src/records.mjs"
import { createLearningStore } from "../src/store.mjs"

const work = mkdtempSync(path.join(tmpdir(), "replica-learning-sqlite-"))
const opened = []
let count = 0
function provider(options = {}) {
  const created = createSqliteMemoryProvider({
    directory: path.join(work, `store-${++count}`),
    ...options,
  })
  opened.push(created)
  return created
}
after(async () => {
  for (const created of opened) await created.close()
  rmSync(work, { recursive: true, force: true })
})
const scope = { repository: "acme/checkout-prototypes" }
const posix = process.platform !== "win32"

function grant(id) {
  return sealRecord({
    schemaVersion: SCHEMA_VERSIONS.consentGrant,
    id,
    scope,
    purposes: ["review"],
    sources: ["hub_review_comments"],
    grantedBy: { kind: "human", id: "github:ana-designer" },
    grantedAt: "2026-10-01T00:00:00.000000Z",
    basis: "SQLite provider test.",
  })
}

describe("SQLite provider", () => {
  it("creates nothing until the first write", async () => {
    const created = provider()
    const file = created.manifest().storage.location
    assert.deepEqual(await created.readRecords("grants", { scope }), [])
    assert.deepEqual(await created.readMemoryVersions({ scope }), [])
    assert.match((await created.health()).detail, /Not created yet/)
    assert.equal(existsSync(file), false)
    await created.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    assert.equal(existsSync(file), true)
    assert.match((await created.health()).detail, /^SQLite \d/)
  })

  it("keeps the database private to its owner", { skip: !posix }, async () => {
    const created = provider()
    await created.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    const file = created.manifest().storage.location
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700)

    const shared = path.join(work, "shared")
    mkdirSync(shared, { mode: 0o755 })
    chmodSync(shared, 0o755)
    const exposed = createSqliteMemoryProvider({ directory: shared })
    opened.push(exposed)
    await assert.rejects(exposed.appendRecords("grants", [grant("grant_aaaaaaaa1")]), {
      code: "storage_corrupt",
    })

    const health = await exposed.health()
    assert.equal(health.ok, false)
    assert.match(health.detail, /readable by other users/)
    assert.equal(existsSync(exposed.manifest().storage.location), false)
    assert.throws(() => provider({ file: "../escape.sqlite" }), { code: "invalid_input" })
  })

  it(
    "refuses a database file, or a file beside it, that links elsewhere",
    { skip: !posix },
    async () => {
      const outside = path.join(work, "outside.sqlite")
      writeFileSync(outside, "", { mode: 0o600 })
      for (const [name, link, message] of [
        ["learning.sqlite", symlinkSync, /is a symbolic link/],
        ["learning.sqlite-wal", symlinkSync, /is a symbolic link/],
        ["learning.sqlite-shm", symlinkSync, /is a symbolic link/],
        ["learning.sqlite", linkSync, /has a second name/],
      ]) {
        const directory = path.join(work, `store-${++count}`)
        mkdirSync(directory, { mode: 0o700 })
        link(outside, path.join(directory, name))
        const linked = provider({ directory })
        await assert.rejects(linked.appendRecords("grants", [grant("grant_aaaaaaaa1")]), {
          code: "storage_corrupt",
          message,
        })
        await assert.rejects(linked.readRecords("grants", { scope }), { code: "storage_corrupt" })
        assert.equal((await linked.health()).ok, false)
      }
      assert.equal(statSync(outside).size, 0)
    },
  )

  it("indexes audit operations when opening an existing store", async () => {
    const created = provider()
    const record = grant("grant_aaaaaaaa1")
    await created.appendRecords("grants", [record])
    const file = created.manifest().storage.location
    await created.close()
    const legacy = new DatabaseSync(file)
    legacy.exec("drop index if exists records_by_operation")
    legacy.close()

    const reopened = provider({ directory: path.dirname(file) })
    assert.deepEqual(await reopened.readRecords("grants", { scope }), [record])
    const database = new DatabaseSync(file)
    try {
      const plan = database
        .prepare(
          `
        explain query plan select body from records
        where stream = ? and scope_key = ?
          and json_extract(body, '$.operation') = ?
        order by seq
      `,
        )
        .all("audit", JSON.stringify(scope), "evidence.redact")
      assert.ok(plan.some(({ detail }) => /records_by_operation .*<expr>=\?/.test(detail)))
    } finally {
      database.close()
    }
  })

  it("keeps every record when two connections write the same file at once", async () => {
    const directory = path.join(work, `store-${++count}`)
    const writers = [
      createSqliteMemoryProvider({ directory }),
      createSqliteMemoryProvider({ directory }),
    ]
    opened.push(...writers)
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writers[index % 2].appendRecords("grants", [
          grant(`grant_concurrent${String(index).padStart(2, "0")}`),
        ]),
      ),
    )
    const records = await writers[1].readRecords("grants", { scope })
    assert.equal(records.length, 20)
    assert.equal(new Set(records.map((record) => record.id)).size, 20)
  })

  it("refuses an older prepared import after a newer snapshot commits", async () => {
    const directory = path.join(work, `store-${++count}`)
    const olderProvider = provider({ directory })
    const newerProvider = provider({ directory })
    const ready = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const olderStore = await createLearningStore({
      provider: {
        ...olderProvider,
        async appendBatch(batch, options) {
          if (batch.collections?.length) {
            ready.resolve()
            await resume.promise
          }
          return olderProvider.appendBatch(batch, options)
        },
      },
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const newerStore = await createLearningStore({
      provider: newerProvider,
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await olderStore.addGrant(designer(), {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    let pending
    try {
      const olderLog = weekOneLog()
      const newerLog = weekTwoLog()
      assert.notEqual(olderLog.calls[0].result.snapshotId, newerLog.calls[0].result.snapshotId)
      assert.ok(olderLog.calls[0].result.capturedAt < newerLog.calls[0].result.capturedAt)
      pending = olderStore.importHubReviewComments(agent(), olderLog, { grantIds: [grant.id] })
      await Promise.race([
        ready.promise,
        pending.then(
          () => {
            throw new Error("The older import finished before its write.")
          },
          (error) => {
            throw error
          },
        ),
      ])
      const newer = await newerStore.importHubReviewComments(agent(), newerLog, {
        grantIds: [grant.id],
      })
      const before = Object.fromEntries(
        await Promise.all(
          Object.keys(STREAMS).map(async (stream) => [
            stream,
            await newerProvider.readRecords(stream, { scope }),
          ]),
        ),
      )
      assert.deepEqual(before.collections, [newer.collection])
      assert.ok(before.events.length > 0)
      resume.resolve()
      await assert.rejects(pending, { code: "conflict" })
      for (const stream of Object.keys(STREAMS))
        assert.deepEqual(await newerProvider.readRecords(stream, { scope }), before[stream])
    } finally {
      resume.resolve()
      if (pending) await pending.catch(() => {})
    }
  })

  it("waits for another process that holds the database instead of failing to open it", async () => {
    const directory = path.join(work, `store-${++count}`)
    const first = createSqliteMemoryProvider({ directory })
    await first.appendRecords("grants", [grant("grant_heldelsewhere01")])
    await first.close()
    const holder = spawn(process.execPath, [
      "-e",
      `const { DatabaseSync } = require("node:sqlite")
      const db = new DatabaseSync(${JSON.stringify(path.join(directory, "learning.sqlite"))})
      db.exec("pragma locking_mode = exclusive; begin exclusive")
      db.exec("insert into records (stream, id, scope_key, digest, body) values ('held', 'held', 'held', 'held', '{}')")
      process.stdout.write("locked\\n")
      const end = Date.now() + 500
      while (Date.now() < end) {}
      db.exec("rollback")
      db.close()`,
    ])
    const exited = new Promise((resolve) => holder.on("exit", resolve))
    await new Promise((resolve, reject) => {
      holder.stdout.on("data", (chunk) => String(chunk).includes("locked") && resolve())
      holder.on("exit", (code) => reject(new Error(`The lock holder exited with ${code}.`)))
    })

    const second = provider({ directory })
    assert.equal((await second.readRecords("grants", { scope })).length, 1)
    assert.equal(await exited, 0)
  })

  it("lets only one of two connections append the next version of a learning", async () => {
    const directory = path.join(work, `store-${++count}`)
    const [first, second] = [
      createSqliteMemoryProvider({ directory }),
      createSqliteMemoryProvider({ directory }),
    ]
    opened.push(first, second)
    function version(digest) {
      return { id: "mem_aaaaaaaaaaaaaaaa", version: 1, scope, digest }
    }
    await first.appendMemoryVersion(version("sha256:first"), { expectedPreviousDigest: null })
    await assert.rejects(
      second.appendMemoryVersion(version("sha256:second"), { expectedPreviousDigest: null }),
      { code: "conflict" },
    )
    assert.deepEqual(
      (await second.readMemoryVersions({ scope })).map((record) => record.digest),
      ["sha256:first"],
    )
  })

  it("leaves no trace of a redacted comment's text in the database files", async () => {
    const created = provider()
    const store = await createLearningStore({
      provider: created,
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const added = await store.addGrant(designer(), {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to learn from review comments.",
    })
    // A long comment spills into overflow pages, which only secure_delete clears.
    const short =
      "The field labels sit inside the inputs as placeholders, so they vanish as soon as I type."
    const markers = ["marker-middle-4b7e", "marker-tail-5f2c"]
    const body = `${short} ${"Each field needs a label. ".repeat(160)}${markers[0]} ${"More detail. ".repeat(160)}${markers[1]}`
    const log = JSON.parse(JSON.stringify(weekOneLog()).replace(short, body))
    await store.importHubReviewComments(agent(), log, { grantIds: [added.id] })
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const comment = events.find(
      (event) => event.payload.body === `${body} Put each label above its field.`,
    )
    const file = created.manifest().storage.location
    function onDisk() {
      return [file, `${file}-wal`].some((name) => {
        if (!existsSync(name)) return false
        const bytes = readFileSync(name)
        return markers.some((marker) => bytes.includes(marker))
      })
    }
    assert.ok(onDisk())
    await store.redactComment(designer(), comment.id, { reason: "The author asked." })
    assert.equal(onDisk(), false)
  })
})
