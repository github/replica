import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { REPOSITORY, weekOneLabels, weekOneLog } from "../conformance/fixtures.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { createScreenshotStore } from "../src/screenshots.mjs"
import { createLearningStore } from "../src/store.mjs"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const SCOPE = { repository: "github.com/repositories/123456" }

describe("screenshot store", () => {
  it("refuses damaged bytes on read and replaces them when the image is stored again", async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "replica-shots-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const store = createScreenshotStore(directory)

    const digest = await store.put(PNG, SCOPE)
    assert.deepEqual(await store.read(digest), PNG)
    const file = (await readdir(directory)).find((name) => name.endsWith(".png"))
    await writeFile(path.join(directory, file), Buffer.concat([PNG, Buffer.from([4])]))

    await assert.rejects(store.read(digest), { code: "storage_corrupt" })
    assert.equal(await store.put(PNG, SCOPE), digest)
    assert.deepEqual(await store.read(digest), PNG)
    await store.remove(digest, [SCOPE])
    assert.equal(await store.read(digest), null)
  })

  it("keeps an image another repository in the same directory still uses", async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "replica-shots-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const store = createScreenshotStore(directory)
    const other = { repository: "github.com/repositories/654321" }
    const digest = await store.put(PNG, SCOPE)
    await store.put(PNG, other)

    await store.remove(digest, [SCOPE])
    assert.deepEqual(await store.read(digest), PNG)
    await store.remove(digest, [other])
    assert.equal(await store.read(digest), null)
    assert.deepEqual(await readdir(directory), [])
  })

  it("removes an image a renamed repository saved under its old name when it is deleted", async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "replica-shots-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const shots = createScreenshotStore(directory)
    const oldName = { repository: "acme/old-checkout-prototypes" }
    const digest = await shots.put(PNG, oldName)
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      legacyScopes: [oldName],
      screenshots: shots,
    })
    const scope = { repository: REPOSITORY }
    const designer = { scope, principal: { kind: "human", id: "github:ana-designer" } }
    const agent = { scope, principal: { kind: "agent", id: "agent:copilot" } }
    const grant = await store.addGrant(designer, {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "Test agreement.",
    })
    await store.importHubReviewComments(agent, weekOneLog(), { grantIds: [grant.id] })
    await store.annotate(agent, weekOneLabels().labels)
    const { proposals } = await store.consolidate(agent, {
      consolidator: createRecurrenceConsolidator(),
      window: { from: "2026-09-29T00:00:00.000000Z", to: "2026-10-05T18:00:00.000000Z" },
    })
    await store.acceptMemory(designer, proposals[0].id, {
      expectedDigest: proposals[0].reviewDigest,
    })
    const recalled = await store.recall(agent)
    await store.reportUsage(agent, {
      reportId: "change-1",
      guidanceIds: [recalled.guidanceId],
      commitSha: "a".repeat(40),
      used: [
        {
          deliveryId: recalled.memories[0].deliveryId,
          after: {
            route: "/checkout",
            viewport: { width: 1280, height: 800 },
            theme: "light",
            capturedAt: "2026-10-09T12:00:00.000000Z",
            bytes: PNG,
          },
        },
      ],
    })

    await store.deleteRepository(designer)

    assert.equal(await shots.read(digest), null)
    assert.deepEqual(await readdir(directory), [])
  })
})
