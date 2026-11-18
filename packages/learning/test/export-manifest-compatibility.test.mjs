import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { weekOneLog, weekTwoLog } from "../conformance/fixtures.mjs"
import { canonicalJson } from "../src/canonical-json.mjs"
import { derivedId } from "../src/ids.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { sealRecord } from "../src/records.mjs"
import { createLearningStore } from "../src/store.mjs"

const NOW = Date.parse("2026-10-09T12:00:00Z")
const SCOPE = { host: "github.com", repository: "acme/checkout-prototypes" }
const PERSON = { scope: SCOPE, principal: { kind: "human", id: "github:administrator" } }
const AGENT = { scope: SCOPE, principal: { kind: "agent", id: "agent:collector" } }

function providerThatStoresHistoricalExports() {
  const provider = createInMemoryProvider()
  return {
    ...provider,
    async appendRecords(stream, records, options = {}) {
      if (stream !== "exports") return provider.appendRecords(stream, records, options)
      const historical = records.map((record) => {
        const counts = { ...record.counts }
        delete counts.collections
        const copy = { ...record, counts }
        delete copy.completeEpisodeIds
        delete copy.completeViews
        delete copy.completePrototypes
        return sealRecord(copy)
      })
      const digests = new Map(historical.map((record) => [record.id, record.digest]))
      const audit = (options.audit ?? []).map((entry) =>
        sealRecord({
          ...entry,
          subjects: entry.subjects.map((subject) =>
            subject.kind === "export" && digests.has(subject.id)
              ? { ...subject, digest: digests.get(subject.id) }
              : subject,
          ),
        }),
      )
      return provider.appendRecords(stream, historical, { ...options, audit })
    },
  }
}

describe("historical export manifests", () => {
  it("remain valid during verification, withdrawal, and redaction", async () => {
    const provider = providerThatStoresHistoricalExports()
    const store = await createLearningStore({ provider, clock: () => NOW })
    const grant = await store.addGrant(PERSON, {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to review its Hub comments.",
    })
    await store.importHubReviewComments(AGENT, weekOneLog(), { grantIds: [grant.id] })
    const exported = await store.exportRecords(PERSON, {
      purpose: "review",
      destination: "historical-review.json",
    })
    const [stored] = await provider.readRecords("exports", { scope: SCOPE })
    assert.equal(stored.counts.collections, undefined)
    assert.equal(stored.completeEpisodeIds, undefined)
    assert.equal(stored.completeViews, undefined)
    assert.equal(stored.completePrototypes, undefined)
    assert.equal((await store.verify(PERSON)).ok, true)

    const observations = await store.queryObservations(PERSON, { purpose: "review" })
    const comment = observations.events.find((event) => event.type === "human_comment")
    const redaction = await store.redactComment(PERSON, comment.id, {
      reason: "The author asked to remove it.",
    })
    assert.deepEqual(
      redaction.exportsToFollowUp.map((item) => item.id),
      [exported.manifest.id],
    )
    assert.equal((await store.verify(PERSON)).ok, true)

    const withdrawal = await store.withdrawGrant(PERSON, grant.id, { purposes: ["review"] })
    assert.deepEqual(
      withdrawal.exportsToFollowUp.map((item) => item.id),
      [exported.manifest.id],
    )
    assert.equal((await store.verify(PERSON)).ok, true)
  })
})

describe("export completeness certificates", () => {
  async function importedStore(logs) {
    const provider = createInMemoryProvider()
    const store = await createLearningStore({ provider, clock: () => NOW })
    const grant = await store.addGrant(PERSON, {
      purposes: ["review"],
      sources: ["hub_review_comments"],
      basis: "The team agreed to review its Hub comments.",
    })
    for (const log of logs)
      await store.importHubReviewComments(AGENT, log, { grantIds: [grant.id] })
    return { provider, store }
  }

  async function redactStoredEvent(provider, event) {
    const copy = {
      ...event,
      redaction: {
        at: "2026-10-09T12:00:00.000000Z",
        by: PERSON.principal,
        reason: "The source payload is unavailable.",
        ...(event.type === "human_comment" ? { commentId: event.payload.commentId } : {}),
      },
    }
    delete copy.payload
    await provider.redactRecord("events", copy)
  }

  it("supports complete view keys with maximum-length route components", async () => {
    const log = weekOneLog()
    const route = {
      pathname: `/${"p".repeat(2047)}`,
      search: `?${"q".repeat(2047)}`,
      hash: `#${"h".repeat(1023)}`,
    }
    for (const call of log.calls)
      for (const thread of call.result?.threads ?? [])
        if (thread.id === 101) thread.anchor.route = route
    const { store } = await importedStore([log])
    try {
      const exported = await store.exportRecords(PERSON, {
        purpose: "review",
        destination: "maximum-route.json",
      })

      const expected = derivedId("view", {
        hubOrigin: "https://replica.example.com",
        repositoryId: 42,
        prototypeId: 11,
        buildNumber: 3,
        route: `${route.pathname}${route.search}${route.hash}`,
      })
      assert.ok(exported.manifest.completeViews.includes(expected))
    } finally {
      await store.close()
    }
  })

  it("leaves completeness certificates empty for learnings-only exports", async () => {
    const stored = createInMemoryProvider()
    let rejectCertificateScans = false
    let eventFilterCalls = 0
    let certificateScans = 0
    function watched(records) {
      return new Proxy(records, {
        get(target, property, receiver) {
          if (property !== "filter") return Reflect.get(target, property, receiver)
          return (predicate, ...rest) => {
            eventFilterCalls += 1
            const source = String(predicate)
            if (source.includes("payload") && source.includes("role") && source.includes("root")) {
              certificateScans += 1
              throw new Error("completeness certificate scan reached")
            }
            return watched(target.filter(predicate, ...rest))
          }
        },
      })
    }
    const provider = {
      ...stored,
      async readRecords(stream, query) {
        const records = await stored.readRecords(stream, query)
        if (stream !== "events" || !rejectCertificateScans) return records
        return watched(records)
      },
    }
    const store = await createLearningStore({ provider, clock: () => NOW })
    try {
      const grant = await store.addGrant(PERSON, {
        purposes: ["review"],
        sources: ["hub_review_comments"],
        basis: "The team agreed to review its Hub comments.",
      })
      await store.importHubReviewComments(AGENT, weekOneLog(), { grantIds: [grant.id] })
      rejectCertificateScans = true
      const exported = await store.exportRecords(PERSON, {
        purpose: "review",
        destination: "learnings-only.json",
        contents: "learnings",
      })

      assert.deepEqual(exported.manifest.completeEpisodeIds, [])
      assert.deepEqual(exported.manifest.completeViews, [])
      assert.deepEqual(exported.manifest.completePrototypes, [])
      assert.ok(eventFilterCalls > 0)
      assert.equal(certificateScans, 0)
    } finally {
      await store.close()
    }
  })

  it("withholds certificates for unavailable current events but permits safe omissions", async () => {
    const cases = [
      {
        name: "current",
        logs: [weekOneLog()],
        commentId: 101,
        select: (events) =>
          events.find(
            (event) => event.type === "human_comment" && event.payload?.commentId === 101,
          ),
        complete: false,
      },
      {
        name: "retracted",
        logs: [weekOneLog(), weekTwoLog()],
        commentId: 107,
        select: (events) =>
          events.find(
            (event) => event.type === "human_comment" && event.payload?.commentId === 107,
          ),
        complete: true,
      },
      {
        name: "replaced",
        logs: [weekOneLog(), weekTwoLog()],
        commentId: 112,
        select: (events) => {
          const versions = events.filter(
            (event) => event.type === "human_comment" && event.payload?.commentId === 112,
          )
          const replaced = new Set(versions.map((event) => event.supersedes).filter(Boolean))
          return versions.find((event) => replaced.has(event.id))
        },
        complete: true,
      },
    ]

    for (const scenario of cases) {
      const { provider, store } = await importedStore(scenario.logs)
      try {
        const events = await provider.readRecords("events", { scope: SCOPE })
        const event = scenario.select(events)
        assert.ok(event, `${scenario.name}: missing fixture event ${scenario.commentId}`)
        await redactStoredEvent(provider, event)

        const exported = await store.exportRecords(PERSON, {
          purpose: "review",
          destination: `${scenario.name}.json`,
        })
        const complete = exported.manifest.completeEpisodeIds.includes(event.episodeId)

        assert.equal(complete, scenario.complete, scenario.name)
        if (!scenario.complete) {
          const prototypeKey = canonicalJson({
            hubOrigin: "https://replica.example.com",
            repositoryId: 42,
            prototypeId: 11,
          })
          const viewKey = derivedId("view", {
            hubOrigin: "https://replica.example.com",
            repositoryId: 42,
            prototypeId: 11,
            buildNumber: 3,
            route: "/checkout",
          })
          assert.equal(exported.manifest.completePrototypes.includes(prototypeKey), false)
          assert.equal(exported.manifest.completeViews.includes(viewKey), false)
        }
      } finally {
        await store.close()
      }
    }
  })

  it("keeps an unrelated view complete when an event with a known view is unavailable", async () => {
    const log = weekOneLog()
    for (const call of log.calls)
      for (const thread of call.result?.threads ?? [])
        if (thread.id === 105) {
          thread.resolvedAt = "2026-10-04T10:00:00.000000Z"
          thread.resolvedBy = thread.author
        }
    const { provider, store } = await importedStore([log])
    try {
      const events = await provider.readRecords("events", { scope: SCOPE })
      const status = events.find(
        (event) => event.type === "status_change" && event.payload?.subject.id === 105,
      )
      assert.ok(status)
      await redactStoredEvent(provider, status)

      const exported = await store.exportRecords(PERSON, {
        purpose: "review",
        destination: "known-view.json",
      })
      const checkout = derivedId("view", {
        hubOrigin: "https://replica.example.com",
        repositoryId: 42,
        prototypeId: 11,
        buildNumber: 3,
        route: "/checkout",
      })
      const summary = derivedId("view", {
        hubOrigin: "https://replica.example.com",
        repositoryId: 42,
        prototypeId: 11,
        buildNumber: 4,
        route: "/checkout/summary",
      })

      assert.equal(exported.manifest.completeViews.includes(checkout), true)
      assert.equal(exported.manifest.completeViews.includes(summary), false)
    } finally {
      await store.close()
    }
  })
})
