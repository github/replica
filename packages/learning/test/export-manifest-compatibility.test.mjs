import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { weekOneLog } from "../conformance/fixtures.mjs"
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
