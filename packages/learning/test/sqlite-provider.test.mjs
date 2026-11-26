import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
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
import { DatabaseSync, StatementSync } from "node:sqlite"
import { after, describe, it } from "node:test"
import { agent, designer, weekOneLabels, weekOneLog, weekTwoLog } from "../conformance/index.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { STREAMS } from "../src/provider-contract.mjs"
import { createSqliteMemoryProvider } from "../src/providers/sqlite.mjs"
import { SCHEMA_VERSIONS, sealEvent, sealRecord } from "../src/records.mjs"
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

  it("uses bounded, indexed reads for a decision and its selected evidence", async () => {
    const created = provider()
    const selected = {
      id: "ev_indexeddecision1",
      scope,
      episodeId: "ep_indexeddecision1",
      digest: "sha256:selected",
    }
    const unrelated = Array.from({ length: 3000 }, (_, index) => ({
      id: `ev_otherdecision${index}`,
      scope,
      episodeId: `ep_otherdecision${index}`,
      digest: `sha256:${index}`,
    }))
    await created.appendRecords("events", [selected, ...unrelated])
    const source = {
      kind: "hub_review_comments",
      hubOrigin: "https://replica.example.com",
      repositoryId: 42,
      prototypeId: 7,
      threadId: 1,
    }
    const episode = { id: selected.episodeId, scope, source, digest: "sha256:episode" }
    const related = { ...episode, id: "ep_relateddecision1", digest: "sha256:related" }
    await created.appendRecords("episodes", [
      episode,
      related,
      ...unrelated.map((event, index) => ({
        id: event.episodeId,
        scope,
        source: { ...source, threadId: index + 10 },
        digest: event.digest,
      })),
    ])
    const database = new DatabaseSync(created.manifest().storage.location)
    database.exec("analyze")
    const prepare = DatabaseSync.prototype.prepare
    const all = StatementSync.prototype.all
    const get = StatementSync.prototype.get
    const prepared = new WeakMap()
    const queries = []
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = prepare.call(this, sql)
      prepared.set(statement, sql)
      return statement
    }
    StatementSync.prototype.all = function (...values) {
      const rows = all.apply(this, values)
      const sql = prepared.get(this)
      if (sql && /^\s*select\b/i.test(sql)) queries.push({ sql, values, count: rows.length })
      return rows
    }
    StatementSync.prototype.get = function (...values) {
      const row = get.apply(this, values)
      const sql = prepared.get(this)
      if (sql && /^\s*select\b/i.test(sql)) queries.push({ sql, values, count: row ? 1 : 0 })
      return row
    }
    let fenceReads
    let idReads
    let episodeReads
    let threadReads
    try {
      await created.decisionFence(scope)
      fenceReads = queries.splice(0)
      assert.deepEqual(await created.readRecords("events", { scope, ids: [selected.id] }), [
        selected,
      ])
      idReads = queries.splice(0)
      assert.deepEqual(
        await created.readRecords("events", { scope, episodeIds: [selected.episodeId] }),
        [selected],
      )
      episodeReads = queries.splice(0)
      assert.deepEqual(
        new Set(await created.readRelatedEpisodeIds(scope, [episode.id])),
        new Set([episode.id, related.id]),
      )
      threadReads = queries.splice(0)
    } catch (error) {
      database.close()
      throw error
    } finally {
      DatabaseSync.prototype.prepare = prepare
      StatementSync.prototype.all = all
      StatementSync.prototype.get = get
    }
    try {
      assert.ok(fenceReads.length > 0)
      assert.ok(
        fenceReads
          .filter(({ sql }) => /\bfrom\s+(records|memory_versions)\b/i.test(sql))
          .every(({ count }) => count <= 10),
        "A decision fence read unrelated evidence.",
      )
      for (const [reads, key] of [
        [idReads, /\bid=\?/],
        [episodeReads, /\bepisode_id=\?/],
      ]) {
        const query = reads.find(({ sql }) => /\bfrom\s+records\b/i.test(sql))
        assert.ok(query)
        const plan = database.prepare(`explain query plan ${query.sql}`).all(...query.values)
        assert.ok(
          plan.some(
            ({ detail }) =>
              /SEARCH records USING (?:COVERING )?INDEX/.test(detail) && key.test(detail),
          ),
          JSON.stringify(plan),
        )
      }
      const threadQuery = threadReads.find(({ sql }) => /\bjoin\s+records\b/i.test(sql))
      assert.ok(threadQuery)
      const threadPlan = database
        .prepare(`explain query plan ${threadQuery.sql}`)
        .all(...threadQuery.values)
      assert.ok(
        threadPlan.some(
          ({ detail }) =>
            /SEARCH related USING (?:COVERING )?INDEX/.test(detail) &&
            (detail.match(/<expr>=\?/g)?.length ?? 0) >= 4,
        ),
        JSON.stringify(threadPlan),
      )
    } finally {
      database.close()
    }
  })

  it("refuses an edit when a stored withdrawal's grant ID is damaged", async () => {
    const created = provider()
    const store = await createLearningStore({
      provider: created,
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const consent = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [consent.id] })
    await store.annotate(agent(), weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent(), {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    const proposal = proposals[0]
    const accepted = await store.acceptMemory(designer(), proposal.id, {
      expectedDigest: proposal.reviewDigest,
    })
    const { withdrawal } = await store.withdrawGrant(designer(), consent.id, {
      purposes: ["instruction"],
    })
    const input = {
      expectedDigest: accepted.digest,
      title: "Keep labels visible",
      reason: "Clarify the guidance.",
    }
    await assert.rejects(store.editMemory(designer(), proposal.id, input), {
      code: "purpose_not_granted",
    })
    const versions = await created.readMemoryVersions({ scope, ids: [proposal.id] })
    const audits = await created.readRecords("audit", { scope, operations: ["memory.edit"] })
    const database = new DatabaseSync(created.manifest().storage.location)
    try {
      database
        .prepare("update records set body = ? where stream = 'withdrawals' and id = ?")
        .run(JSON.stringify({ ...withdrawal, grantId: "grant_other" }), withdrawal.id)
    } finally {
      database.close()
    }
    const outcome = await store.editMemory(designer(), proposal.id, input).then(
      (record) => ({ accepted: record.accepted.decision, version: record.version }),
      (error) => ({ error: error.code }),
    )
    assert.deepEqual(outcome, { error: "storage_corrupt" })
    assert.deepEqual(await created.readMemoryVersions({ scope, ids: [proposal.id] }), versions)
    assert.deepEqual(
      await created.readRecords("audit", { scope, operations: ["memory.edit"] }),
      audits,
    )

    await created.close()
    const legacy = new DatabaseSync(created.manifest().storage.location)
    try {
      legacy.exec(`
        delete from decision_withdrawal_targets;
        delete from decision_index_state where name = 'withdrawal-targets';
      `)
    } finally {
      legacy.close()
    }
    const reopened = provider({ directory: path.dirname(created.manifest().storage.location) })
    const reopenedStore = await createLearningStore({
      provider: reopened,
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    await assert.rejects(reopenedStore.editMemory(designer(), proposal.id, input), {
      code: "storage_corrupt",
    })
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

  for (const change of ["withdrawal", "redaction", "memory"]) {
    it(`refuses a stale decision after an older SQLite writer changes ${change}`, async () => {
      const directory = path.join(work, `legacy-${++count}`)
      const file = path.join(directory, "learning.sqlite")
      mkdirSync(directory, { mode: 0o700 })
      copyFileSync(new URL("./fixtures/legacy-scope.sqlite", import.meta.url), file)
      chmodSync(file, 0o600)
      const legacy = new DatabaseSync(file)
      try {
        const insertRecord = legacy.prepare(`
          insert into records (stream, id, scope_key, occurred_at, episode_id, digest, body)
          values (?, ?, ?, ?, ?, ?, ?) on conflict (stream, id) do nothing
        `)
        const updateEvent = legacy.prepare(
          "update records set body = ? where stream = 'events' and id = ?",
        )
        const insertMemory = legacy.prepare(`
          insert into memory_versions (id, version, scope_key, updated_at, digest, body)
          values (?, ?, ?, ?, ?, ?)
        `)
        const event = sealEvent({
          id: "ev_olderwriter1",
          scope,
          episodeId: "ep_olderwriter1",
          type: "annotation",
          at: "2026-10-01T00:00:00.000000Z",
          payload: { text: "Evidence later removed." },
        })
        if (change === "redaction")
          insertRecord.run(
            "events",
            event.id,
            JSON.stringify(scope),
            event.at,
            event.episodeId,
            event.digest,
            JSON.stringify(event),
          )

        const reader = provider({ directory })
        const fence = await reader.decisionFence(scope)
        legacy.exec("begin immediate")
        if (change === "withdrawal") {
          const withdrawal = sealRecord({
            id: "withdraw_olderwriter1",
            scope,
            withdrawnAt: "2026-10-02T00:00:00.000000Z",
          })
          insertRecord.run(
            "withdrawals",
            withdrawal.id,
            JSON.stringify(scope),
            withdrawal.withdrawnAt,
            null,
            withdrawal.digest,
            JSON.stringify(withdrawal),
          )
        } else if (change === "redaction") {
          const { payload, ...removed } = event
          assert.ok(payload)
          updateEvent.run(
            JSON.stringify({
              ...removed,
              redaction: {
                at: "2026-10-02T00:00:00.000000Z",
                by: designer().principal,
                reason: "The author asked.",
              },
            }),
            event.id,
          )
        } else {
          const version = {
            id: "mem_olderwriter1",
            version: 1,
            scope,
            digest: "sha256:older",
            supersedes: ["mem_fenceddecision1"],
          }
          insertMemory.run(
            version.id,
            version.version,
            JSON.stringify(scope),
            null,
            version.digest,
            JSON.stringify(version),
          )
        }
        legacy.exec("commit")

        assert.notEqual(await reader.decisionFence(scope), fence)
        if (change === "memory")
          assert.deepEqual(
            new Set(await reader.readDecisionMemoryIds(scope, ["mem_fenceddecision1"])),
            new Set(["mem_fenceddecision1", "mem_olderwriter1"]),
          )
        const decision = {
          id: "mem_fenceddecision1",
          version: 1,
          scope,
          digest: "sha256:decision",
        }
        const audit = { id: "audit_fenceddecision1", scope, digest: "sha256:audit" }
        await assert.rejects(
          reader.appendMemoryVersion(decision, {
            expectedPreviousDigest: null,
            expectedDecisionFence: fence,
            audit: [audit],
          }),
          { code: "conflict" },
        )
        assert.deepEqual(await reader.readMemoryVersions({ scope, ids: [decision.id] }), [])
        assert.deepEqual(await reader.readRecords("audit", { scope }), [])
      } finally {
        legacy.close()
      }
    })
  }

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
