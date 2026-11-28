// A third memory provider, written only from the v1 contract with no imports from
// @github/replica-learning. It keeps every stream in one JSON file and serializes writes
// within one process, which is enough for tests and for showing how an adapter plugs in.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const STREAMS = {
  episodes: "startedAt",
  events: "at",
  grants: "grantedAt",
  withdrawals: "withdrawnAt",
  collections: "capturedAt",
  audit: "at",
  exports: "createdAt",
  guidance: "requestedAt",
  deliveries: "deliveredAt",
  usageReports: "reportedAt",
  usedLearnings: "reportedAt",
  screenshots: "capturedAt",
  scores: "scoredAt",
  updateProposals: "proposedAt",
  updateDecisions: "decidedAt",
}

const queues = new Map()

function fail(code, message) {
  return Object.assign(new Error(message), { code })
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    )
  return value
}

function sameScope(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

export function createMemoryProvider({ dataDirectory, file = "json-file-store.json" } = {}) {
  const target = path.resolve(dataDirectory, file)
  function exclusive(work) {
    const next = (queues.get(target) ?? Promise.resolve()).then(work, work)
    const settled = next.catch(() => {})
    queues.set(target, settled)
    void settled.then(() => {
      if (queues.get(target) === settled) queues.delete(target)
    })
    return next
  }

  async function load() {
    try {
      return JSON.parse(await readFile(target, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return { streams: {}, memories: [] }
      throw error
    }
  }

  async function save(state) {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await rename(temporary, target)
  }

  function matches(stream, record, query) {
    if (!query?.scope) throw fail("invalid_input", "A query needs a scope.")
    if (!sameScope(record.scope, query.scope)) return false
    if (query.ids && !query.ids.includes(record.id)) return false
    if (query.operations && !query.operations.includes(record.operation)) return false
    if (
      query.episodeIds &&
      !query.episodeIds.includes(stream === "episodes" ? record.id : record.episodeId)
    )
      return false
    const time = stream === "memories" ? record.updatedAt : record[STREAMS[stream]]
    return (!query.since || time >= query.since) && (!query.until || time < query.until)
  }

  function checkStream(stream) {
    if (!Object.hasOwn(STREAMS, stream)) throw fail("invalid_input", `Unknown stream ${stream}.`)
  }

  // Adds the new records to a loaded state. Nothing reaches the file until save, so a
  // conflict found later in the same write leaves the file as it was.
  function add(state, stream, records) {
    const stored = state.streams[stream] ?? []
    const digests = new Map(stored.map((record) => [record.id, record.digest]))
    const fresh = []
    let existing = 0
    for (const record of records) {
      const digest = digests.get(record.id)
      if (digest === undefined) {
        digests.set(record.id, record.digest)
        fresh.push(record)
      } else if (digest === record.digest) existing++
      else throw fail("conflict", `${stream} already holds ${record.id} with other content.`)
    }
    state.streams[stream] = [...stored, ...fresh]
    return { appended: fresh.length, existing }
  }

  // Adds a batch, and its audit entries, to the stored state and saves it once.
  async function write(batch, audit) {
    if (!batch || typeof batch !== "object" || Array.isArray(batch))
      throw fail("invalid_input", "A batch maps stream names to records.")
    const state = await load()
    const counts = {}
    let changed = false
    for (const [stream, records] of Object.entries(batch)) {
      checkStream(stream)
      counts[stream] = add(state, stream, records)
      changed ||= counts[stream].appended > 0
    }
    const receipts = add(state, "audit", audit)
    if (Object.hasOwn(counts, "audit")) {
      counts.audit.appended += receipts.appended
      counts.audit.existing += receipts.existing
    }
    changed = receipts.appended > 0 || changed
    if (changed) await save(state)
    return counts
  }

  return {
    manifest() {
      return {
        schemaVersion: "replica.provider/v1",
        id: "json-file",
        name: "Single JSON file test provider",
        version: "1.0.0",
        contract: { name: "replica.memory-provider", versions: [1] },
        capabilities: [
          "observation.append",
          "observation.query",
          "memory.store",
          "memory.query",
          "memory.lifecycle",
          "grant.store",
          "audit.store",
        ],
        storage: { kind: "local", location: target },
        externalCalls: [],
      }
    },

    async health() {
      return { ok: true, detail: target }
    },

    appendRecords(stream, records, { audit = [] } = {}) {
      return exclusive(async () => {
        checkStream(stream)
        return (await write({ [stream]: records }, audit))[stream]
      })
    },

    appendBatch(batch, { audit = [] } = {}) {
      return exclusive(() => write(batch, audit))
    },

    async readRecords(stream, query) {
      checkStream(stream)
      if (!query?.scope) throw fail("invalid_input", "A query needs a scope.")
      const state = await load()
      return (state.streams[stream] ?? []).filter((record) => matches(stream, record, query))
    },

    appendMemoryVersion(record, { expectedPreviousDigest = null, audit = [] } = {}) {
      return exclusive(async () => {
        const state = await load()
        const latest = state.memories.filter((version) => version.id === record.id).at(-1) ?? null
        if (
          (latest?.digest ?? null) !== expectedPreviousDigest ||
          record.version !== (latest?.version ?? 0) + 1
        )
          throw fail("conflict", `Memory ${record.id} changed since it was read.`)
        state.memories.push(record)
        add(state, "audit", audit)
        await save(state)
      })
    },

    async readMemoryVersions(query) {
      if (!query?.scope) throw fail("invalid_input", "A query needs a scope.")
      const state = await load()
      return state.memories.filter((record) => matches("memories", record, query))
    },
  }
}
