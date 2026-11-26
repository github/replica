import assert from "node:assert/strict"
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { open } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { agent, designer, weekOneLabels, weekOneLog } from "../conformance/index.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { createJsonLinesMemoryProvider } from "../src/providers/json-lines.mjs"
import { SCHEMA_VERSIONS, sealRecord } from "../src/records.mjs"
import { createLearningStore } from "../src/store.mjs"

const work = mkdtempSync(path.join(tmpdir(), "replica-learning-local-"))
after(() => rmSync(work, { recursive: true, force: true }))
let count = 0
function fresh() {
  return path.join(work, `store-${++count}`)
}
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
    basis: "Local provider test.",
  })
}

function receipt(id) {
  return sealRecord({
    schemaVersion: SCHEMA_VERSIONS.auditEntry,
    id,
    at: "2026-10-09T12:00:00.000000Z",
    actor: { kind: "human", id: "github:ana-designer" },
    operation: "grant.add",
    scope,
    subjects: [],
    outcome: "ok",
    provider: { id: "jsonl", version: "0.0.0" },
  })
}

function withdrawal(id) {
  return sealRecord({
    schemaVersion: SCHEMA_VERSIONS.grantWithdrawal,
    id,
    grantId: "grant_aaaaaaaa1",
    scope,
    purposes: ["review"],
    withdrawnBy: { kind: "human", id: "github:ana-designer" },
    withdrawnAt: "2026-10-09T12:00:00.000000Z",
  })
}

/**
 * Mocks a FileHandle method for the rest of the test. Before each call, observe(name, handle)
 * runs with the name of the file in the v1 directory files, or with "v1/", "root/", or
 * "parent/" for the directories that hold the store. A throw from observe fails that call.
 */
async function onFileHandle(t, files, method, observe) {
  const FileHandle = await fileHandlePrototype()
  const original = FileHandle[method]
  t.mock.method(FileHandle, method, async function (...args) {
    await observe(await nameOf(this, files), this)
    return original.apply(this, args)
  })
}

async function fileHandlePrototype() {
  const probe = await open(import.meta.filename)
  await probe.close()
  return Object.getPrototypeOf(probe)
}

/** Calls observe(name, handle) before every FileHandle sync; see onFileHandle. */
async function onSync(t, files, observe) {
  await onFileHandle(t, files, "sync", observe)
}

async function nameOf(handle, files) {
  const info = await handle.stat()
  if (info.isDirectory()) {
    const root = path.dirname(files)
    const directories = { "v1/": files, "root/": root, "parent/": path.dirname(root) }
    return Object.keys(directories).find(
      (label) => statSync(directories[label], { throwIfNoEntry: false })?.ino === info.ino,
    )
  }
  if (!existsSync(files)) return undefined
  return readdirSync(files).find(
    (name) => statSync(path.join(files, name), { throwIfNoEntry: false })?.ino === info.ino,
  )
}

/**
 * Tracks what a power failure would leave in the v1 directory files: each file as of its last
 * sync, and only the names v1 held at its last sync. What is there now counts as synced. Before
 * each sync, observe(name, handle) may return "lost" to fail the sync before it reaches the
 * disk, or "saved" to fail it after. The returned powerFailure() puts the files back.
 */
async function durable(t, files, observe = () => {}) {
  function names() {
    return new Set(readdirSync(files).filter((name) => name !== ".lock"))
  }
  let synced = names()
  const contents = new Map([...synced].map((name) => [name, readFileSync(path.join(files, name))]))
  await onSync(t, files, async (name, handle) => {
    const outcome = await observe(name, handle)
    if (outcome === "lost") throw injected()
    if (name === "v1/") synced = names()
    else if (name) contents.set(name, readFileSync(path.join(files, name)))
    if (outcome === "saved") throw injected()
  })
  return function powerFailure() {
    for (const name of readdirSync(files))
      if (!synced.has(name)) rmSync(path.join(files, name), { force: true })
    for (const name of synced)
      writeFileSync(path.join(files, name), contents.get(name) ?? "", { mode: 0o600 })
  }
}

function injected(what = "sync") {
  return Object.assign(new Error(`Injected ${what} failure.`), { code: "EIO" })
}

async function ids(provider, stream) {
  return (await provider.readRecords(stream, { scope })).map((record) => record.id)
}

async function acceptedStore(directory) {
  const store = await createLearningStore({
    provider: createJsonLinesMemoryProvider({ directory }),
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grantId = (
    await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test.",
    })
  ).id
  await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
  await store.annotate(agent(), weekOneLabels().labels)
  const run = await store.consolidate(agent(), {
    consolidator: createRecurrenceConsolidator(),
    window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
  })
  const [proposal] = run.proposals
  await store.acceptMemory(designer(), proposal.id, { expectedDigest: proposal.reviewDigest })
  return { store, proposal }
}

describe("JSON Lines provider", () => {
  it("deletes its copy of the events file when a redaction fails part way", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    const store = await createLearningStore({ provider })
    const grantId = (
      await store.addGrant(designer(), {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "Test.",
      })
    ).id
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
    const file = path.join(directory, "v1", "events.jsonl")
    const before = readFileSync(file)
    const event = (await provider.readRecords("events", { scope })).find(
      (item) => item.type === "human_comment",
    )
    const copy = {
      ...event,
      redaction: {
        at: "2026-10-09T12:00:00.000000Z",
        by: designer().principal,
        reason: "x",
        commentId: event.payload.commentId,
      },
      unwritable: 1n,
    }
    delete copy.payload
    // The copy passes the provider's checks, then cannot be written, after the rewrite began.
    await assert.rejects(provider.redactRecord("events", copy), TypeError)
    assert.deepEqual(
      readdirSync(path.join(directory, "v1")).filter((name) => name.endsWith(".tmp")),
      [],
    )
    assert.deepEqual(readFileSync(file), before)
  })

  it("makes a redaction durable once its copy is in place", { skip: !posix }, async (t) => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    const store = await createLearningStore({ provider })
    const grantId = (
      await store.addGrant(designer(), {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "Test.",
      })
    ).id
    await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
    const files = path.join(directory, "v1")
    const events = path.join(files, "events.jsonl")
    const event = (await provider.readRecords("events", { scope })).find(
      (item) => item.type === "human_comment",
    )
    const copy = {
      ...event,
      redaction: {
        at: "2026-10-09T12:00:00.000000Z",
        by: designer().principal,
        reason: "x",
        commentId: event.payload.commentId,
      },
    }
    delete copy.payload
    // The events file each directory sync covered.
    const syncs = []
    await onSync(t, files, (name) => {
      if (name === "v1/") syncs.push(statSync(events).ino)
    })
    assert.deepEqual(await provider.redactRecord("events", copy), { redacted: true })
    assert.ok(syncs.includes(statSync(events).ino))
  })

  it(
    "reports an unknown outcome when a redaction's rename cannot be synced",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      const store = await createLearningStore({ provider })
      const grantId = (
        await store.addGrant(designer(), {
          purposes: ["review"],
          sources: ["hub_review_comments"],
          basis: "Test.",
        })
      ).id
      await store.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grantId] })
      const event = (await provider.readRecords("events", { scope })).find(
        (item) => item.type === "human_comment",
      )
      const copy = {
        ...event,
        redaction: {
          at: "2026-10-09T12:00:00.000000Z",
          by: designer().principal,
          reason: "x",
          commentId: event.payload.commentId,
        },
      }
      delete copy.payload
      await onSync(t, path.join(directory, "v1"), (name) => {
        if (name === "v1/") throw injected()
      })
      await assert.rejects(provider.redactRecord("events", copy), {
        code: "storage_outcome_unknown",
        message: /may or may not be stored/,
      })
      t.mock.restoreAll()
      const [stored] = await provider.readRecords("events", { scope, ids: [event.id] })
      assert.equal(stored.payload, undefined)
    },
  )

  it("reports a copy that a crashed redaction left, and deletes it on the next write", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    const leftover = path.join(directory, "v1", "events.jsonl.0123456789abcdef.tmp")
    writeFileSync(leftover, '{"text":"words someone asked to remove"}\n', { mode: 0o600 })
    const health = await provider.health()
    assert.equal(health.ok, false)
    assert.match(health.detail, /left a copy of the events file/)
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa2")])
    assert.equal(existsSync(leftover), false)
    assert.equal((await provider.health()).ok, true)
  })

  it("creates owner-only directories and files", { skip: !posix }, async () => {
    const directory = fresh()
    await createJsonLinesMemoryProvider({ directory }).appendRecords("grants", [
      grant("grant_aaaaaaaa1"),
    ])
    assert.equal(statSync(directory).mode & 0o777, 0o700)
    assert.equal(statSync(path.join(directory, "v1")).mode & 0o777, 0o700)
    assert.equal(statSync(path.join(directory, "v1", "grants.jsonl")).mode & 0o777, 0o600)
  })

  it("refuses a directory other users can read", { skip: !posix }, async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    chmodSync(directory, 0o755)
    await assert.rejects(
      provider.appendRecords("grants", [grant("grant_aaaaaaaa2")]),
      /readable by other users/,
    )
    assert.equal((await provider.health()).ok, false)
    chmodSync(directory, 0o700)
  })

  it("refuses a store file or directory that links elsewhere", { skip: !posix }, async () => {
    const outside = path.join(work, "outside.jsonl")
    writeFileSync(outside, "", { mode: 0o600 })
    function linked(name, link = symlinkSync) {
      const directory = fresh()
      mkdirSync(path.join(directory, "v1"), { recursive: true, mode: 0o700 })
      link(outside, path.join(directory, "v1", name))
      return createJsonLinesMemoryProvider({ directory })
    }
    for (const [stream, link, message] of [
      ["grants", symlinkSync, /is a symbolic link/],
      ["grants", linkSync, /has a second name/],
      ["audit", symlinkSync, /is a symbolic link/],
    ]) {
      const provider = linked(`${stream}.jsonl`, link)
      await assert.rejects(
        provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
          audit: [receipt("audit_aaaaaaaa1")],
        }),
        { code: "storage_corrupt", message },
      )
      await assert.rejects(provider.readRecords(stream, { scope }), { code: "storage_corrupt" })
      assert.equal((await provider.health()).ok, false)
    }
    const pending = linked(".pending")
    await assert.rejects(pending.appendRecords("grants", [grant("grant_aaaaaaaa1")]), {
      code: "storage_corrupt",
      message: /is a symbolic link/,
    })
    assert.equal((await pending.health()).ok, false)

    const elsewhere = path.join(work, "elsewhere")
    mkdirSync(elsewhere, { mode: 0o700 })
    const directory = fresh()
    mkdirSync(directory, { mode: 0o700 })
    symlinkSync(elsewhere, path.join(directory, "v1"))
    const moved = createJsonLinesMemoryProvider({ directory })
    await assert.rejects(moved.appendRecords("grants", [grant("grant_aaaaaaaa1")]), {
      code: "storage_corrupt",
      message: /is a symbolic link/,
    })
    await assert.rejects(moved.readRecords("grants", { scope }), { code: "storage_corrupt" })
    assert.equal((await moved.health()).ok, false)
    assert.equal(statSync(outside).size, 0)
    assert.deepEqual(readdirSync(elsewhere), [])
  })

  it(
    "never returns records from a write that fails while it reads",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
      const files = path.join(directory, "v1")
      const read = Promise.withResolvers()
      const failed = Promise.withResolvers()
      let reading
      // Once the write has added its line, a read starts. When it has read the grants file, it
      // waits there until the write has failed.
      const FileHandle = await fileHandlePrototype()
      const readFile = FileHandle.readFile
      t.mock.method(FileHandle, "readFile", async function (...args) {
        const bytes = await readFile.apply(this, args)
        if (reading && (await nameOf(this, files)) === "grants.jsonl") {
          read.resolve()
          await failed.promise
        }
        return bytes
      })
      await onSync(t, files, async (name) => {
        if (name !== "grants.jsonl" || reading) return
        reading = provider.readRecords("grants", { scope })
        await Promise.race([read.promise, sleep(300)])
        throw injected()
      })
      await assert.rejects(provider.appendRecords("grants", [grant("grant_aaaaaaaa2")]), {
        code: "EIO",
      })
      failed.resolve()
      assert.deepEqual(
        (await reading).map((record) => record.id),
        ["grant_aaaaaaaa1"],
      )
    },
  )

  it("reads a store that does not exist yet as empty, and creates nothing", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    assert.deepEqual(await provider.readRecords("grants", { scope }), [])
    assert.deepEqual(await provider.readMemoryVersions({ scope }), [])
    assert.equal(existsSync(directory), false)
    mkdirSync(directory, { mode: 0o700 })
    assert.deepEqual(await provider.readRecords("grants", { scope }), [])
    assert.deepEqual(readdirSync(directory), [])
  })

  it("keeps records across provider instances", async () => {
    const directory = fresh()
    await createJsonLinesMemoryProvider({ directory }).appendRecords("grants", [
      grant("grant_aaaaaaaa1"),
    ])
    const again = createJsonLinesMemoryProvider({ directory })
    assert.deepEqual(await again.readRecords("grants", { scope }), [grant("grant_aaaaaaaa1")])
  })

  it("ignores an unfinished last line and removes it on the next write", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    const file = path.join(directory, "v1", "grants.jsonl")
    appendFileSync(file, '{"schemaVersion":"replica.consent-grant/v1","id":"grant_')
    assert.equal((await provider.readRecords("grants", { scope })).length, 1)
    assert.match((await provider.health()).detail, /unfinished write/)
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa2")])
    const lines = readFileSync(file, "utf8").trimEnd().split("\n")
    assert.equal(lines.length, 2)
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).id),
      ["grant_aaaaaaaa1", "grant_aaaaaaaa2"],
    )
  })

  it("filters and appends audit entries without reading the whole file into memory", async (t) => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    const recalls = Array.from({ length: 250 }, (_, index) =>
      sealRecord({
        ...receipt(`audit_recallhistory${String(index).padStart(8, "0")}`),
        operation: "memory.recall",
      }),
    )
    const redaction = sealRecord({
      ...receipt("audit_redaction01"),
      operation: "evidence.redact",
    })
    await provider.appendRecords("audit", [...recalls, redaction])
    const files = path.join(directory, "v1")
    await onFileHandle(t, files, "readFile", (name) => {
      assert.notEqual(name, "audit.jsonl", "audit files must be streamed, not buffered in full")
    })

    assert.deepEqual(
      await provider.readRecords("audit", {
        scope,
        operations: ["evidence.redact"],
      }),
      [redaction],
    )
    const next = receipt("audit_nextentry01")
    assert.deepEqual(await provider.appendRecords("audit", [next, redaction]), {
      appended: 1,
      existing: 1,
    })
    assert.deepEqual(await provider.readRecords("audit", { scope }), [...recalls, redaction, next])
  })

  it("reports a damaged complete line instead of skipping it", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    appendFileSync(path.join(directory, "v1", "grants.jsonl"), "{not json}\n")
    await assert.rejects(provider.readRecords("grants", { scope }), { code: "storage_corrupt" })
  })

  it("removes a change whose audit entry a crash left unwritten before the next read", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
      audit: [receipt("audit_aaaaaaaa1")],
    })
    const files = path.join(directory, "v1")
    const lengths = {
      grants: statSync(path.join(files, "grants.jsonl")).size,
      audit: statSync(path.join(files, "audit.jsonl")).size,
    }
    // A writer recorded where both files ended, appended a grant, and stopped before its audit entry.
    writeFileSync(path.join(files, ".pending"), JSON.stringify({ lengths }), { mode: 0o600 })
    appendFileSync(
      path.join(files, "grants.jsonl"),
      `${JSON.stringify(grant("grant_aaaaaaaa2"))}\n`,
    )
    assert.match((await provider.health()).detail, /grants, audit has not finished/)
    assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1"])
    assert.equal(existsSync(path.join(files, ".pending")), false)
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa3")], {
      audit: [receipt("audit_aaaaaaaa3")],
    })
    assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1", "grant_aaaaaaaa3"])
    assert.deepEqual(await ids(provider, "audit"), ["audit_aaaaaaaa1", "audit_aaaaaaaa3"])
    assert.equal(existsSync(path.join(files, ".pending")), false)
  })

  it(
    "syncs its directory after deleting .pending, so a power failure cannot bring it back",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const files = path.join(directory, "v1")
      const pending = path.join(files, ".pending")
      // Whether .pending existed each time the provider synced its directory.
      const syncs = []
      await onSync(t, files, (name) => {
        if (name === "v1/") syncs.push(existsSync(pending))
      })

      await provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], {
        audit: [receipt("audit_aaaaaaaa2")],
      })
      assert.deepEqual(syncs.splice(0), [true, false])

      // A writer recorded where both files ended, appended a grant, and stopped.
      const lengths = {
        grants: statSync(path.join(files, "grants.jsonl")).size,
        audit: statSync(path.join(files, "audit.jsonl")).size,
      }
      writeFileSync(pending, JSON.stringify({ lengths }), { mode: 0o600 })
      appendFileSync(
        path.join(files, "grants.jsonl"),
        `${JSON.stringify(grant("grant_aaaaaaaa3"))}\n`,
      )
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa4")])
      // The cut-back write is forgotten, then the new write's .pending comes and goes.
      assert.deepEqual(syncs, [false, true, false])
      assert.deepEqual(await ids(provider, "grants"), [
        "grant_aaaaaaaa1",
        "grant_aaaaaaaa2",
        "grant_aaaaaaaa4",
      ])
    },
  )

  it(
    "makes a new stream file's name durable before committing the write that creates it",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
      const files = path.join(directory, "v1")
      const audit = path.join(files, "audit.jsonl")
      // What each sync covered, noting whether the directory sync came after audit.jsonl existed.
      const syncs = []
      await onSync(t, files, (name) =>
        syncs.push(name === "v1/" && existsSync(audit) ? "v1/ with audit.jsonl" : name),
      )
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], {
        audit: [receipt("audit_aaaaaaaa2")],
      })
      const committed = syncs.lastIndexOf(".pending")
      assert.ok(syncs.slice(0, committed).includes("v1/ with audit.jsonl"), syncs.join(", "))
    },
  )

  it(
    "makes the directories it creates durable before the first write commits",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      const files = path.join(directory, "v1")
      const syncs = []
      await onSync(t, files, (name) => syncs.push(name))
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const committed = syncs.lastIndexOf(".pending")
      for (const holder of ["parent/", "root/"])
        assert.ok(syncs.slice(0, committed).includes(holder), `${holder} in ${syncs.join(", ")}`)
    },
  )

  for (const levels of [1, 2])
    it(
      `keeps a write that commits while another provider is creating the store, ${levels} level(s) deep`,
      { skip: !posix },
      async (t) => {
        const top = fresh()
        const directory = levels === 1 ? top : path.join(top, "learning")
        const files = path.join(directory, "v1")
        // Each directory on the store's path, and whether its name is durable in its parent.
        const entries = levels === 1 ? [directory, files] : [top, directory, files]
        const durable = new Set()
        const pausing = Promise.withResolvers()
        const committed = Promise.withResolvers()
        let paused = false
        const FileHandle = await fileHandlePrototype()
        const sync = FileHandle.sync
        t.mock.method(FileHandle, "sync", async function () {
          const info = await this.stat()
          if (info.isDirectory()) {
            // The first directory sync is A's, right after it created the store's directories.
            if (!paused) {
              paused = true
              pausing.resolve()
              await committed.promise
              throw injected()
            }
            for (const entry of entries)
              if (
                existsSync(entry) &&
                statSync(path.dirname(entry), { throwIfNoEntry: false })?.ino === info.ino
              )
                durable.add(entry)
          }
          return sync.call(this)
        })
        const a = createJsonLinesMemoryProvider({ directory })
        const b = createJsonLinesMemoryProvider({ directory })
        const first = a.appendRecords("grants", [grant("grant_aaaaaaaa1")])
        await pausing.promise
        assert.deepEqual(await b.appendRecords("grants", [grant("grant_bbbbbbbb1")]), {
          appended: 1,
          existing: 0,
        })
        // A power failure now drops the first directory whose name is not durable in its parent.
        const lost = entries.find((entry) => !durable.has(entry))
        if (lost) rmSync(lost, { recursive: true, force: true })
        const reopened = createJsonLinesMemoryProvider({ directory })
        assert.deepEqual(await ids(reopened, "grants"), ["grant_bbbbbbbb1"], `lost ${lost}`)
        committed.resolve()
        await assert.rejects(first, { code: "EIO" })
      },
    )

  it(
    "syncs each file it cuts back before deleting .pending, when the next write goes elsewhere",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const files = path.join(directory, "v1")
      const pending = path.join(files, ".pending")
      const lengths = {
        grants: statSync(path.join(files, "grants.jsonl")).size,
        audit: statSync(path.join(files, "audit.jsonl")).size,
      }
      // A writer recorded where both files ended, appended to both, and stopped.
      writeFileSync(pending, JSON.stringify({ lengths }), { mode: 0o600 })
      appendFileSync(
        path.join(files, "grants.jsonl"),
        `${JSON.stringify(grant("grant_aaaaaaaa2"))}\n`,
      )
      appendFileSync(
        path.join(files, "audit.jsonl"),
        `${JSON.stringify(receipt("audit_aaaaaaaa2"))}\n`,
      )
      // Each file the provider synced, in order, and whether .pending existed then.
      const syncs = []
      await onSync(t, files, (name) => syncs.push(existsSync(pending) ? `${name} .pending` : name))

      await provider.appendRecords("withdrawals", [withdrawal("withdrawal_aaaaaaaa1")])
      assert.deepEqual(syncs.slice(0, 3), ["grants.jsonl .pending", "audit.jsonl .pending", "v1/"])
      assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1"])
      assert.deepEqual(await ids(provider, "audit"), ["audit_aaaaaaaa1"])
      assert.deepEqual(await ids(provider, "withdrawals"), ["withdrawal_aaaaaaaa1"])
    },
  )

  it(
    "keeps a committed write when deleting its .pending fails, and neither loses nor repeats it",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const files = path.join(directory, "v1")
      const pending = path.join(files, ".pending")
      // Keep .pending as it was last synced, and fail the directory sync after its deletion.
      let journal
      await onSync(t, files, (name) => {
        if (name === ".pending") journal = readFileSync(pending)
        if (name === "v1/" && !existsSync(pending))
          throw Object.assign(new Error("Injected sync failure."), { code: "EIO" })
      })
      const batch = { grants: [grant("grant_aaaaaaaa2")] }
      const options = { audit: [receipt("audit_aaaaaaaa2")] }
      assert.deepEqual(await provider.appendBatch(batch, options), {
        grants: { appended: 1, existing: 0 },
      })
      t.mock.restoreAll()

      // A power failure can bring .pending back as it was last synced.
      writeFileSync(pending, journal, { mode: 0o600 })
      assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1", "grant_aaaaaaaa2"])
      await provider.appendRecords("withdrawals", [withdrawal("withdrawal_aaaaaaaa1")])
      assert.equal(existsSync(pending), false)
      assert.deepEqual(await provider.appendBatch(batch, options), {
        grants: { appended: 0, existing: 1 },
      })
      assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1", "grant_aaaaaaaa2"])
      assert.deepEqual(await ids(provider, "audit"), ["audit_aaaaaaaa1", "audit_aaaaaaaa2"])
    },
  )

  it(
    "keeps a write whose commit line is synced, even when closing .pending then fails",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const files = path.join(directory, "v1")
      // Closing .pending fails once its commit line is synced.
      let journalSyncs = 0
      const powerFailure = await durable(t, files, (name, handle) => {
        if (name !== ".pending" || ++journalSyncs !== 2) return
        const close = handle.close
        handle.close = async () => {
          await close()
          throw injected("close")
        }
      })
      assert.deepEqual(
        await provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], {
          audit: [receipt("audit_aaaaaaaa2")],
        }),
        { appended: 1, existing: 0 },
      )
      t.mock.restoreAll()
      powerFailure()
      const reopened = createJsonLinesMemoryProvider({ directory })
      assert.deepEqual(await ids(reopened, "grants"), ["grant_aaaaaaaa1", "grant_aaaaaaaa2"])
      assert.deepEqual(await ids(reopened, "audit"), ["audit_aaaaaaaa1", "audit_aaaaaaaa2"])
    },
  )

  it(
    "leaves a consistent store when undoing a failed write stops part way and runs again",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const files = path.join(directory, "v1")
      // The commit line reaches the disk, but its sync reports an error. Undoing the write then
      // stops at the audit file, as if the process died there.
      let journalSyncs = 0
      const powerFailure = await durable(t, files, (name) => {
        if (name === ".pending" && ++journalSyncs === 2) return "saved"
        if (name === "audit.jsonl" && journalSyncs >= 2) return "lost"
      })
      await assert.rejects(
        provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], {
          audit: [receipt("audit_aaaaaaaa2")],
        }),
        { code: "EIO" },
      )
      t.mock.restoreAll()
      powerFailure()
      const reopened = createJsonLinesMemoryProvider({ directory })
      assert.deepEqual(await ids(reopened, "grants"), ["grant_aaaaaaaa1"])
      assert.deepEqual(await ids(reopened, "audit"), ["audit_aaaaaaaa1"])
      assert.equal(existsSync(path.join(files, ".pending")), false)
    },
  )

  it(
    "keeps a write whole when the commit line may be on the disk and cannot be dropped",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const files = path.join(directory, "v1")
      // The data files are synced. The commit line reaches the disk, but its sync reports an
      // error. Syncing the journal after dropping the line fails, and so would cutting back the
      // audit file.
      let journalSyncs = 0
      const powerFailure = await durable(t, files, (name) => {
        if (name === ".pending" && ++journalSyncs === 2) return "saved"
        if (name === ".pending" && journalSyncs === 3) return "lost"
        if (name === "audit.jsonl" && journalSyncs >= 2) return "lost"
      })
      const failure = await provider
        .appendRecords("grants", [grant("grant_aaaaaaaa2")], {
          audit: [receipt("audit_aaaaaaaa2")],
        })
        .then(
          () => null,
          (error) => error,
        )
      t.mock.restoreAll()
      powerFailure()
      const reopened = createJsonLinesMemoryProvider({ directory })
      const grants = await ids(reopened, "grants")
      const audit = await ids(reopened, "audit")
      assert.equal(grants[0], "grant_aaaaaaaa1")
      assert.equal(audit[0], "audit_aaaaaaaa1")
      assert.equal(
        grants.includes("grant_aaaaaaaa2"),
        audit.includes("audit_aaaaaaaa2"),
        `the store holds the write whole or not at all: ${grants}; ${audit}`,
      )
      assert.equal(failure?.code, "storage_outcome_unknown")
      assert.match(failure.message, /may or may not be stored/)
    },
  )

  it("takes back a write whose commit cannot be synced", { skip: !posix }, async (t) => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
      audit: [receipt("audit_aaaaaaaa1")],
    })
    const files = path.join(directory, "v1")
    let journalSyncs = 0
    await onSync(t, files, (name) => {
      if (name === ".pending" && ++journalSyncs === 2)
        throw Object.assign(new Error("Injected sync failure."), { code: "EIO" })
    })
    await assert.rejects(
      provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], {
        audit: [receipt("audit_aaaaaaaa2")],
      }),
      { code: "EIO" },
    )
    t.mock.restoreAll()
    assert.equal(existsSync(path.join(files, ".pending")), false)
    assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1"])
    assert.deepEqual(await ids(provider, "audit"), ["audit_aaaaaaaa1"])
  })

  it(
    "leaves nothing from a one-record write whose sync and undo both fail",
    { skip: !posix },
    async (t) => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
      const files = path.join(directory, "v1")
      // Until the write has failed, the grants file can be neither synced nor cut back.
      let failing = true
      for (const method of ["sync", "truncate"])
        await onFileHandle(t, files, method, (name) => {
          if (failing && name === "grants.jsonl") throw injected(method)
        })
      await assert.rejects(provider.appendRecords("grants", [grant("grant_aaaaaaaa2")]), {
        code: "EIO",
      })
      failing = false
      assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1"])
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa3")])
      assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1", "grant_aaaaaaaa3"])
      assert.equal(existsSync(path.join(files, ".pending")), false)
    },
  )

  it("stores nothing from a failed write to one file", { skip: !posix }, async (t) => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    const files = path.join(directory, "v1")
    // Fail the first sync of the grants file in each write, after its lines are written.
    let failing
    await onSync(t, files, (name) => {
      if (name !== "grants.jsonl" || !failing) return
      failing = false
      throw Object.assign(new Error("Injected sync failure."), { code: "EIO" })
    })
    for (const records of [
      [grant("grant_aaaaaaaa2")],
      [grant("grant_aaaaaaaa3"), grant("grant_aaaaaaaa4")],
    ]) {
      failing = true
      await assert.rejects(provider.appendRecords("grants", records), { code: "EIO" })
    }
    t.mock.restoreAll()
    assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1"])
    assert.equal(existsSync(path.join(files, ".pending")), false)
  })

  it(
    "removes a change again when its audit entry cannot be written",
    { skip: !posix || process.getuid?.() === 0 },
    async () => {
      const directory = fresh()
      const provider = createJsonLinesMemoryProvider({ directory })
      await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")], {
        audit: [receipt("audit_aaaaaaaa1")],
      })
      const audit = path.join(directory, "v1", "audit.jsonl")
      chmodSync(audit, 0o400)
      await assert.rejects(
        provider.appendRecords("grants", [grant("grant_aaaaaaaa2")], {
          audit: [receipt("audit_aaaaaaaa2")],
        }),
        { code: "EACCES" },
      )
      chmodSync(audit, 0o600)
      assert.deepEqual(await ids(provider, "grants"), ["grant_aaaaaaaa1"])
      assert.equal(existsSync(path.join(directory, "v1", ".pending")), false)
    },
  )

  it("keeps history readable when editing or reinstating is unsupported", async () => {
    const directory = fresh()
    const { store, proposal } = await acceptedStore(directory)
    const provider = createJsonLinesMemoryProvider({ directory })
    async function snapshot() {
      return {
        memories: await provider.readMemoryVersions({ scope, ids: [proposal.id] }),
        audit: await provider.readRecords("audit", { scope }),
      }
    }
    try {
      const beforeEdit = await snapshot()
      await assert.rejects(
        store.editMemory(designer(), proposal.id, {
          expectedDigest: beforeEdit.memories.at(-1).digest,
          title: "Keep labels visible",
          reason: "Clarify the guidance.",
        }),
        { code: "unsupported" },
      )
      assert.deepEqual(await snapshot(), beforeEdit)
      const retired = await store.retireMemory(designer(), proposal.id, { reason: "Review later." })
      const beforeReinstate = await snapshot()
      await assert.rejects(
        store.reinstateMemory(designer(), proposal.id, {
          expectedDigest: retired.digest,
          reason: "The guidance applies again.",
        }),
        { code: "unsupported" },
      )
      assert.deepEqual(await snapshot(), beforeReinstate)
      const history = await store.getMemory(designer(), proposal.id, { history: true })
      assert.deepEqual(
        history.versions.map((version) => version.state),
        ["proposed", "accepted", "retired"],
      )
    } finally {
      await store.close()
    }
  })

  it("records each recall as a use for instruction, but not a preview for a person", async () => {
    const directory = fresh()
    const { store, proposal } = await acceptedStore(directory)
    const provider = createJsonLinesMemoryProvider({ directory })
    async function recalls() {
      const audit = await provider.readRecords("audit", { scope })
      return audit.filter((entry) => entry.operation === "memory.recall").length
    }

    await assert.rejects(store.recall(agent(), { preview: true }), { code: "human_required" })
    const preview = await store.recall(designer(), { preview: true })
    assert.deepEqual(
      preview.memories.map((memory) => memory.id),
      [proposal.id],
    )
    assert.equal(await recalls(), 0)

    const used = await store.recall(agent())
    assert.equal(used.text, preview.text)
    assert.equal(await recalls(), 1)
  })

  it("detects a learning edited on disk and stops recalling it", async () => {
    const directory = fresh()
    const { store, proposal } = await acceptedStore(directory)
    assert.equal((await store.recall(agent())).memories.length, 1)
    const file = path.join(directory, "v1", "memories.jsonl")
    writeFileSync(
      file,
      readFileSync(file, "utf8").replaceAll(
        "never use placeholder text",
        "always use placeholder text",
      ),
    )
    const verified = await store.verify(designer())
    assert.equal(verified.ok, false)
    assert.ok(verified.problems.some((problem) => problem.includes(proposal.id)))
    assert.equal((await store.recall(agent())).memories.length, 0)
    await assert.rejects(
      store.retireMemory(designer(), proposal.id, { reason: "Edited on disk." }),
      { code: "invalid_record" },
    )
  })

  it("serializes concurrent writers on the same directory", async () => {
    const directory = fresh()
    const writers = [
      createJsonLinesMemoryProvider({ directory }),
      createJsonLinesMemoryProvider({ directory }),
    ]
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writers[index % 2].appendRecords("grants", [
          grant(`grant_concurrent${String(index).padStart(2, "0")}`),
        ]),
      ),
    )
    const records = await writers[0].readRecords("grants", { scope })
    assert.equal(records.length, 20)
    assert.equal(new Set(records.map((record) => record.id)).size, 20)
  })

  it("recovers from a lock left by a crashed process", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory, staleLockMs: 1_000 })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    const lock = path.join(directory, "v1", ".lock")
    writeFileSync(lock, "99999\n")
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa2")])
    assert.equal((await provider.readRecords("grants", { scope })).length, 2)
  })

  it(
    "lets a new provider in this process remove a lock another one could not release",
    { skip: !posix || process.getuid?.() === 0 },
    async (t) => {
      const directory = fresh()
      const first = createJsonLinesMemoryProvider({ directory })
      await first.appendRecords("grants", [grant("grant_aaaaaaaa1")])
      const files = path.join(directory, "v1")
      // Once the write is committed, v1 stops accepting changes, so the lock file stays.
      let journalSyncs = 0
      await onSync(t, files, (name) => {
        if (name === ".pending" && ++journalSyncs === 2) chmodSync(files, 0o500)
      })
      await first.appendRecords("grants", [grant("grant_aaaaaaaa2")])
      t.mock.restoreAll()
      chmodSync(files, 0o700)
      assert.equal(existsSync(path.join(files, ".lock")), true)
      const second = createJsonLinesMemoryProvider({ directory, lockTimeoutMs: 200 })
      assert.deepEqual(await ids(second, "grants"), ["grant_aaaaaaaa1", "grant_aaaaaaaa2"])
    },
  )

  it("gives up on a live lock after its timeout", async () => {
    const directory = fresh()
    const provider = createJsonLinesMemoryProvider({ directory, lockTimeoutMs: 100 })
    await provider.appendRecords("grants", [grant("grant_aaaaaaaa1")])
    writeFileSync(path.join(directory, "v1", ".lock"), "1\n")
    await assert.rejects(provider.appendRecords("grants", [grant("grant_aaaaaaaa2")]), {
      code: "conflict",
    })
  })
})
