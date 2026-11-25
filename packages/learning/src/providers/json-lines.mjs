import { constants } from "node:fs"
import { randomBytes } from "node:crypto"
import { access, lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { decodeUtf8, parseJson } from "../canonical-json.mjs"
import { LearningError, ProviderConflictError } from "../errors.mjs"
import {
  PROVIDER_CONTRACT,
  DECISION_FENCE_STREAMS,
  REDACT_CAPABILITY,
  REQUIRED_CAPABILITIES,
  STREAMS,
  assertQuery,
  assertDecisionFence,
  assertStorable,
  assertStream,
  batchWrites,
  decisionFenceDigest,
  matchesQuery,
  newRecords,
  redactionProblem,
} from "../provider-contract.mjs"
import { PRODUCER, SCHEMA_VERSIONS } from "../records.mjs"
import { NO_FOLLOW, assertOwnPath, openError } from "./files.mjs"
import { createFileLock } from "./lock.mjs"

/**
 * Stores learning records as append-only JSON Lines files in one private directory. It
 * needs no service and no dependency, and a person can read its files, so it is the
 * reference provider. SQLite is the default.
 *
 * Each stream is <directory>/v1/<stream>.jsonl, created owner-only (0700 directories, 0600
 * files). Reads and writes take an exclusive lock file that only its holder removes; see
 * lock.mjs. A store whose directory does not exist yet reads as empty, and reading it creates
 * nothing. A line without its newline is never read as a record.
 *
 * After any crash or error, the store holds each write whole or not at all. A call that fails
 * has stored nothing, except when the disk reports an error while the write commits: then it
 * fails with storage_outcome_unknown, and the write may or may not be stored. Where Node.js can
 * sync directories, on Linux and macOS, the same holds after a power failure.
 *
 * Every write goes through a journal, <directory>/v1/.pending, whether it adds one record or an
 * import's episodes, events, collection, and audit entries:
 *
 * 1. Record the length of each file the write will change in .pending, and sync it and v1.
 * 2. Append to each file and sync it. Before this provider's first commit, sync every directory
 *    from v1 up to the top of its file system, because another process may have created part of
 *    the path and not synced it yet. After that, sync v1 if the write created a stream file.
 * 3. Add the commit line to .pending and sync it. That sync is the commit point: after it, the
 *    write succeeds, whatever happens while closing or deleting .pending.
 * 4. Delete .pending and sync v1.
 *
 * A write that fails before the commit point is undone before the error is reported: cut each
 * file back and sync it, and delete .pending. Once the commit line may be on the disk, the
 * files are cut back only after dropping that line and syncing .pending both succeed. Otherwise
 * every file stays whole with .pending, and the call fails with storage_outcome_unknown, because
 * recovery keeps the whole write or none of it, depending on whether the line survived.
 *
 * Before each read and write, the lock holder finishes a write that stopped: it keeps a
 * committed one and cuts back any other, so no read sees part of a write. The parent of each
 * directory the provider creates is also synced when it creates it.
 *
 * Compared with SQLite, reads and writes take turns, a redaction leaves the old events file's
 * bytes in free disk space where SQLite overwrites removed text, writes sync more often, and on
 * Windows a power failure can lose a newly created file's directory entry.
 *
 * The provider opens its files without following links, and refuses v1 or a file in it that
 * is a link, has a second name, or resolves outside the directory.
 *
 * @param {{ directory: string, lockTimeoutMs?: number, staleLockMs?: number }} options
 */
export function createJsonLinesMemoryProvider({
  directory,
  lockTimeoutMs = 10_000,
  staleLockMs = 600_000,
} = {}) {
  if (typeof directory !== "string" || !directory)
    throw new LearningError("invalid_input", "The JSON Lines provider needs a directory.")
  const root = path.resolve(directory)
  const storeDirectory = path.join(root, "v1")
  const lock = createFileLock({
    path: path.join(storeDirectory, ".lock"),
    timeoutMs: lockTimeoutMs,
    staleMs: staleLockMs,
  })
  const pendingFile = path.join(storeDirectory, ".pending")
  // Whether this provider has synced every directory on the store's path since it last created
  // one. Another process may create part of the path and not have synced it yet.
  let pathSynced = false
  function fileFor(stream) {
    return path.join(storeDirectory, `${stream}.jsonl`)
  }

  /** Refuse v1 unless it is this provider's own directory. False when it does not exist yet. */
  async function storeDirectoryExists() {
    const info = await entryAt(storeDirectory)
    if (info) assertOwnPath(root, storeDirectory, info, { directory: true })
    return info !== null
  }

  /**
   * Open a file in v1 without following a link, or return null when it does not exist. Refuses
   * a file that is not this provider's own, or that other users can read.
   */
  async function openOwn(file, flags, mode) {
    let handle
    try {
      handle = await open(file, flags | NO_FOLLOW, mode)
    } catch (error) {
      if (error.code === "ENOENT") return null
      throw openError(root, file, error)
    }
    try {
      const info = await handle.stat()
      assertOwnPath(root, file, info)
      await assertPrivate(file, info)
      return handle
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  /**
   * The write that .pending records, or null when there is none. Its first line holds each
   * file's length before the write began, and the COMMITTED line follows once every file is
   * written and synced. A first line its writer never finished means no write, because the
   * writer changes no stream file until that line is synced.
   *
   * @returns {Promise<{ lengths: Record<string, number>, committed: boolean } | null>}
   */
  async function readJournal() {
    const handle = await openOwn(pendingFile, constants.O_RDONLY)
    if (!handle) return null
    let text
    try {
      text = await handle.readFile("utf8")
    } finally {
      await handle.close()
    }
    const [begun] = text.split("\n")
    try {
      const { lengths } = JSON.parse(begun)
      if (
        Object.entries(lengths).every(
          ([stream, length]) =>
            FILES.includes(stream) && Number.isSafeInteger(length) && length >= 0,
        )
      )
        return { lengths, committed: text === `${begun}\n${COMMITTED}\n` }
    } catch {
      // The writer stopped while recording the lengths.
    }
    return null
  }

  /**
   * Cut the files back to the lengths an unfinished write recorded, then forget the write. Each
   * file is synced first, including one an earlier attempt already cut, because a power failure
   * after .pending is gone must not bring back lines that nothing marks as unfinished.
   */
  async function undo(lengths) {
    for (const [stream, length] of Object.entries(lengths)) {
      const file = fileFor(stream)
      const info = await entryAt(file)
      if (!info) continue
      const cut = info.size > length
      const handle = await openOwn(file, constants.O_WRONLY)
      if (!handle) continue
      try {
        if (cut) await handle.truncate(length)
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    await removePending()
  }

  /**
   * Delete .pending once its write is committed or cut back. The directory is synced after,
   * because an uncommitted .pending that a power failure brought back would make the next
   * writer cut back writes made since.
   */
  async function removePending() {
    await rm(pendingFile, { force: true })
    await syncStoreDirectory()
  }

  /** Sync v1 itself, so the files it gained or lost stay that way after a power failure. */
  async function syncStoreDirectory() {
    await syncDirectory(storeDirectory)
  }

  /**
   * Sync a directory, so the entries it gained or lost stay that way after a power failure.
   * Node.js cannot sync a directory on Windows, so there a power failure can lose a newly created
   * file's directory entry.
   */
  async function syncDirectory(directory) {
    if (process.platform === "win32") return
    const folder = await open(directory, "r")
    try {
      await folder.sync()
    } finally {
      await folder.close()
    }
  }

  /**
   * Sync every directory that holds the store, from v1 up to the top of its file system, whoever
   * created each one.
   */
  async function syncPath() {
    const { dev } = await stat(storeDirectory)
    for (let directory = storeDirectory; ; directory = path.dirname(directory)) {
      if ((await stat(directory)).dev !== dev) return
      await syncDirectory(directory)
      if (path.dirname(directory) === directory) return
    }
  }

  /** Sync the directory that holds each directory from top down to bottom, all just created. */
  async function syncParents(top, bottom) {
    for (let directory = bottom; ; directory = path.dirname(directory)) {
      await syncDirectory(path.dirname(directory))
      if (directory === top || path.dirname(directory) === directory) return
    }
  }

  /**
   * Copies of the events file that a redaction wrote but never renamed into place. Only the
   * lock holder writes one, so any found while holding the lock was abandoned. Each may still
   * hold text that was later removed.
   */
  async function abandonedRewrites() {
    let names
    try {
      names = await readdir(storeDirectory)
    } catch (error) {
      if (error.code === "ENOENT") return []
      throw error
    }
    return names.filter((name) => REWRITE.test(name)).map((name) => path.join(storeDirectory, name))
  }

  /**
   * Create the store's directories, owner-only, and sync the parent of each one it creates.
   * Another process can find them before that sync, so every provider also syncs the whole path
   * before its first commit; see appendAll.
   */
  async function prepare() {
    await storeDirectoryExists()
    const created = await mkdir(root, { recursive: true, mode: 0o700 })
    if (created) await syncParents(created, root)
    const createdStore = await mkdir(storeDirectory, { recursive: true, mode: 0o700 })
    await assertPrivate(root)
    await assertPrivate(storeDirectory)
    if (createdStore) await syncDirectory(root)
    if (created || createdStore) pathSynced = false
  }

  /**
   * Finish a write that stopped: keep it if it was committed, and otherwise cut it back. Then
   * delete any copies a redaction left. Runs under the lock, before every read and write.
   */
  async function recover() {
    const journal = await readJournal()
    if (journal?.committed) await removePending()
    else if (journal) await undo(journal.lengths)
    else await rm(pendingFile, { force: true })
    for (const file of await abandonedRewrites()) await rm(file, { force: true })
  }

  async function withLock(work) {
    await prepare()
    return lock.run(async () => {
      await recover()
      return work()
    })
  }

  /**
   * Run a public read under the lock, after recovering, so a read never sees a write that has
   * not been committed. A store whose directory does not exist yet reads as empty, and reading
   * it creates nothing and takes no lock.
   */
  async function readLocked(read, empty = []) {
    if (!(await storeDirectoryExists())) return empty
    return lock.run(async () => {
      await recover()
      return read()
    })
  }

  /**
   * One stream's records. Every caller but health() holds the lock after recovering, so the
   * file holds only committed writes; health() only asks whether a last line is unfinished.
   * Read one line at a time and keep only matches, so a filtered audit read does not retain
   * every earlier recall. Writers still count every complete byte for journal recovery.
   */
  async function readStream(stream, matches = () => true) {
    const file = fileFor(stream)
    const handle = (await storeDirectoryExists()) ? await openOwn(file, constants.O_RDONLY) : null
    if (!handle) return { records: [], partialTail: false, completeBytes: 0, exists: false }
    const records = []
    let tail = Buffer.alloc(0)
    let completeBytes = 0
    let line = 0
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        const bytes = Buffer.concat([tail, chunk])
        let start = 0
        let end
        while ((end = bytes.indexOf(10, start)) !== -1) {
          line++
          const source = decodeUtf8(bytes.subarray(start, end), file)
          completeBytes += end - start + 1
          start = end + 1
          if (/^[ \t\r]*$/.test(source)) continue
          let record
          try {
            record = parseJson(source, `${path.basename(file)} line ${line}`)
          } catch (error) {
            throw new LearningError("storage_corrupt", error.message, { file, line })
          }
          if (matches(record)) records.push(record)
        }
        tail = bytes.subarray(start)
      }
      decodeUtf8(tail, file)
    } finally {
      await handle.close()
    }
    return {
      records,
      partialTail: tail.length !== 0,
      completeBytes,
      exists: true,
    }
  }

  /**
   * Append lines to one or more stream files as one write, through .pending. If a file cannot be
   * written, or the write cannot be committed, every file is cut back before the error is
   * thrown, and once the write is committed, it succeeds.
   *
   * @param {Array<{ stream: string, records: object[], current: object }>} writes each with what
   *   readStream returned for its stream
   */
  async function appendAll(writes) {
    const changed = writes.filter(({ records }) => records.length)
    if (!changed.length) return
    const lengths = Object.fromEntries(
      changed.map(({ stream, current }) => [stream, current.completeBytes]),
    )
    const begun = `${JSON.stringify({ lengths })}\n`
    const handle = await open(pendingFile, "wx", 0o600)
    try {
      try {
        await handle.writeFile(begun)
        await handle.sync()
      } finally {
        await handle.close()
      }
      // Sync the directory too, so a power failure cannot lose .pending but keep the lines.
      await syncStoreDirectory()
      for (const { stream, records, current } of changed)
        await appendLines(stream, records, current)
      // Every name the write relies on must be durable before the commit point: the whole path of
      // the store before this provider's first commit, and a new stream file's name after it.
      if (!pathSynced) {
        await syncPath()
        pathSynced = true
      } else if (changed.some(({ current }) => !current.exists)) await syncStoreDirectory()
      await commit()
    } catch (error) {
      // Writing the commit line may have put it on the disk. Cut the files back only once it is
      // durably gone. Otherwise they all stay whole, with .pending, so recovery keeps the whole
      // write if the line survives and cuts all of it back if not.
      if (!(await uncommit(Buffer.byteLength(begun)).catch(() => false)))
        throw new LearningError(
          "storage_outcome_unknown",
          `The disk reported an error while committing a write to ${Object.keys(lengths).join(", ")}, so it may or may not be stored. The store holds it whole or not at all; read it back to see which.`,
          { cause: error.message },
        )
      // If cutting back fails too, .pending stays without a commit line, so no read sees the
      // write, and the next read or write cuts it back.
      await undo(lengths).catch(() => {})
      throw error
    }
    // The write is committed. If deleting .pending fails, the next read or write deletes it.
    await removePending().catch(() => {})
  }

  /**
   * Add the line that commits the write .pending records, and sync it. That sync is the commit
   * point: once it succeeds the write stands, so an error from closing the file is ignored.
   */
  async function commit() {
    const handle = await openOwn(pendingFile, constants.O_WRONLY | constants.O_APPEND)
    if (!handle)
      throw new LearningError("storage_corrupt", `${pendingFile} was removed during a write.`)
    try {
      await handle.writeFile(`${COMMITTED}\n`)
      await handle.sync()
    } catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
    await handle.close().catch(() => {})
  }

  /**
   * Drop any commit line from .pending and sync it. True once no commit line can be on the disk,
   * which is also so when none was written.
   */
  async function uncommit(begunBytes) {
    const handle = await openOwn(pendingFile, constants.O_WRONLY)
    if (!handle) return true
    try {
      if ((await handle.stat()).size <= begunBytes) return true
      await handle.truncate(begunBytes)
      await handle.sync()
      return true
    } finally {
      await handle.close().catch(() => {})
    }
  }

  /** Append to several streams in one write under the lock. Every record is checked first. */
  async function write(batch, { audit = [] } = {}) {
    const writes = batchWrites(batch, audit)
    return withLock(async () => {
      const planned = []
      for (const [stream, records] of writes) {
        const ids = new Set(records.map((record) => record.id))
        const current = await readStream(stream, (record) => ids.has(record.id))
        planned.push({ stream, current, ...newRecords(stream, current.records, records) })
      }
      await appendAll(
        planned.map(({ stream, current, fresh }) => ({ stream, current, records: fresh })),
      )
      return Object.fromEntries(
        planned
          .filter(({ stream }) => Object.hasOwn(batch, stream))
          .map(({ stream, fresh, existing }) => [stream, { appended: fresh.length, existing }]),
      )
    })
  }

  /** The audit entries a write adds, as a write for appendAll, or none when it has none. */
  async function receipts(audit) {
    if (!audit.length) return []
    const ids = new Set(audit.map((record) => record.id))
    const current = await readStream("audit", (record) => ids.has(record.id))
    return [
      { stream: "audit", records: newRecords("audit", current.records, audit).fresh, current },
    ]
  }

  /** The caller holds the file lock while reading the complete eligibility state. */
  async function fence(scope) {
    const query = { scope }
    assertQuery(query)
    const records = {}
    for (const stream of DECISION_FENCE_STREAMS)
      records[stream] = (
        await readStream(stream, (record) => matchesQuery(stream, record, query))
      ).records
    const memories = (
      await readStream("memories", (record) => matchesQuery("memories", record, query))
    ).records
    return decisionFenceDigest(scope, { records, memories })
  }

  async function appendLines(stream, records, current) {
    if (current.partialTail) {
      const handle = await openOwn(fileFor(stream), constants.O_WRONLY)
      try {
        await handle.truncate(current.completeBytes)
      } finally {
        await handle.close()
      }
    }
    const handle = await openOwn(
      fileFor(stream),
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
      0o600,
    )
    try {
      await handle.writeFile(records.map((record) => `${JSON.stringify(record)}\n`).join(""))
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  return {
    atomicDecisionFence: true,

    async decisionFence(scope) {
      assertQuery({ scope })
      return readLocked(() => fence(scope), decisionFenceDigest(scope))
    },

    manifest() {
      return {
        schemaVersion: SCHEMA_VERSIONS.providerManifest,
        id: "jsonl",
        name: "JSON Lines files",
        version: PRODUCER.version,
        contract: { name: PROVIDER_CONTRACT.name, versions: [PROVIDER_CONTRACT.version] },
        capabilities: [...REQUIRED_CAPABILITIES, REDACT_CAPABILITY],
        storage: { kind: "local", location: root },
        externalCalls: [],
        dataRetention:
          "Records stay in the directory until someone deletes it. Nothing leaves the machine.",
      }
    },

    async health() {
      try {
        if (!(await exists(root)))
          return { ok: true, detail: `Not created yet; the first write creates ${root}.` }
        await assertPrivate(root)
        const created = await storeDirectoryExists()
        if (created) await assertPrivate(storeDirectory)
        await access(created ? storeDirectory : root, constants.W_OK)
        if ((await abandonedRewrites()).length)
          return {
            ok: false,
            detail: `A redaction stopped before it finished and left a copy of the events file in ${storeDirectory}. It may hold removed text. The next write deletes it.`,
          }
        const journal = await readJournal()
        if (journal)
          return {
            ok: true,
            detail: journal.committed
              ? `A write to ${Object.keys(journal.lengths).join(", ")} is committed, and the next read or write deletes its .pending file.`
              : `A write to ${Object.keys(journal.lengths).join(", ")} has not finished. No read sees it, and the next read or write removes it if it stopped.`,
          }
        const partial = []
        for (const stream of FILES) if ((await readStream(stream)).partialTail) partial.push(stream)
        return partial.length
          ? {
              ok: true,
              detail: `An unfinished write was found in ${partial.join(", ")}; the next write removes it.`,
            }
          : { ok: true, detail: `Writable at ${root}` }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    async appendRecords(stream, records, options) {
      assertStream(stream)
      return (await write({ [stream]: records }, options))[stream]
    },

    async appendBatch(batch, options) {
      return write(batch, options)
    },

    async readRecords(stream, query) {
      assertStream(stream)
      assertQuery(query)
      return readLocked(
        async () =>
          (await readStream(stream, (record) => matchesQuery(stream, record, query))).records,
      )
    },

    async appendMemoryVersion(
      record,
      { expectedPreviousDigest = null, expectedDecisionFence, audit = [] } = {},
    ) {
      assertStorable([record])
      assertStorable(audit)
      return withLock(async () => {
        if (expectedDecisionFence !== undefined)
          assertDecisionFence(expectedDecisionFence, await fence(record.scope))
        const current = await readStream("memories")
        const latest = current.records.filter((version) => version.id === record.id).at(-1) ?? null
        if ((latest?.digest ?? null) !== expectedPreviousDigest)
          throw new ProviderConflictError(`Memory ${record.id} changed since it was read.`, {
            id: record.id,
          })
        if (record.version !== (latest?.version ?? 0) + 1)
          throw new ProviderConflictError(
            `Memory ${record.id} version must follow ${latest?.version ?? 0}.`,
            {
              id: record.id,
            },
          )
        await appendAll([
          { stream: "memories", records: [record], current },
          ...(await receipts(audit)),
        ])
      })
    },

    async readMemoryVersions(query) {
      assertQuery(query)
      return readLocked(
        async () =>
          (await readStream("memories", (record) => matchesQuery("memories", record, query)))
            .records,
      )
    },

    async legacyScopes() {
      return readLocked(async () => {
        const scopes = new Map()
        for (const stream of FILES) {
          for (const record of (await readStream(stream)).records) {
            const scope = record.scope
            if (
              scope?.host === "github.com" &&
              typeof scope.repository === "string" &&
              !/^repositories\/[1-9][0-9]*$/.test(scope.repository)
            )
              scopes.set(JSON.stringify(scope), scope)
          }
        }
        return [...scopes.values()]
      })
    },

    /**
     * Rewrite the events file with one event redacted, atomically and under the write lock. A
     * failed rewrite deletes its copy, and the next write deletes one a crash left behind. The
     * directory is synced once the copy is renamed into place; if that sync fails, the call fails
     * with storage_outcome_unknown, because the redaction shows but may not survive a power
     * failure.
     */
    async redactRecord(stream, record) {
      if (stream !== "events")
        throw new LearningError("invalid_input", "Only events can be redacted.")
      return withLock(async () => {
        const current = await readStream("events")
        const index = current.records.findIndex((item) => item.id === record?.id)
        const problem = redactionProblem(current.records[index], record)
        if (problem) throw problem
        if (current.records[index].payload === undefined) return { redacted: false }
        const file = fileFor("events")
        const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`
        let handle
        try {
          handle = await open(temporary, "wx", 0o600)
          await handle.writeFile(
            current.records
              .with(index, record)
              .map((item) => `${JSON.stringify(item)}\n`)
              .join(""),
          )
          await handle.sync()
          await handle.close()
          handle = undefined
          await rename(temporary, file)
        } catch (error) {
          await handle?.close().catch(() => {})
          await rm(temporary, { force: true })
          throw error
        }
        // The rename shows at once, but until it is synced, a power failure could bring back the
        // file with the text.
        try {
          await syncStoreDirectory()
        } catch (error) {
          throw new LearningError(
            "storage_outcome_unknown",
            `The disk reported an error while committing the redaction of ${record.id}, so it may or may not be stored. Read the event back to see which.`,
            { cause: error.message },
          )
        }
        return { redacted: true }
      })
    },
  }
}

const REWRITE = /^events\.jsonl\.[0-9a-f]{16}\.tmp$/
/** The line in .pending that marks its write committed: every file it names is synced. */
const COMMITTED = '{"committed":true}'
const FILES = [...Object.keys(STREAMS), "memories"]

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

/** What lstat finds at a path, or null when nothing is there. */
async function entryAt(target) {
  try {
    return await lstat(target)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

async function assertPrivate(target, info) {
  if (process.platform === "win32") return
  const found = info ?? (await stat(target))
  if ((found.mode & 0o077) !== 0)
    throw new LearningError(
      "storage_corrupt",
      `${target} is readable by other users. Run chmod ${found.isDirectory() ? 700 : 600} on it.`,
    )
}
