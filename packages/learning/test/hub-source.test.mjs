import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { REPOSITORY, collectionLog, weekOneLog } from "../conformance/fixtures.mjs"
import { hubThreadEvents, readHubReviewCollection } from "../src/sources/hub-review-comments.mjs"

const expected = { repository: REPOSITORY }
function read(log) {
  return readHubReviewCollection(log, expected)
}

describe("Hub review collections", () => {
  it("keeps Enterprise Managed User logins on roots, replies, and resolution actors", () => {
    const log = weekOneLog()
    const root = log.calls[1].result.threads[0]
    root.author.login = "designer_enterprise"
    root.replies[0].author.login = "reviewer_enterprise"
    root.resolvedAt = "2026-10-04T12:00:00.000000Z"
    root.resolvedBy = { login: "resolver_enterprise" }
    const collection = read(log)
    const thread = collection.threads.find((item) => item.root.id === root.id)
    assert.equal(thread.root.authorLogin, "designer_enterprise")
    assert.equal(thread.replies[0].authorLogin, "reviewer_enterprise")
    assert.equal(thread.root.resolvedByLogin, "resolver_enterprise")
    const events = hubThreadEvents({
      meta: collection.meta,
      thread,
      scope: expected,
      episodeId: "ep_emureviewers1",
      existing: [],
    })
    assert.deepEqual(
      events.map((event) => event.actor.id),
      ["github:designer_enterprise", "github:reviewer_enterprise", "github:resolver_enterprise"],
    )
  })

  it("reads a complete log and joins reply pages", () => {
    const result = read(weekOneLog())
    assert.equal(result.complete, true)
    assert.deepEqual(result.problems, [])
    assert.deepEqual(result.counts, { threads: 9, messages: 12 })
    assert.equal(result.meta.repository, REPOSITORY)
    assert.deepEqual(result.filters, { resolution: "all", read: "all", from: null, to: null })
    const thread = result.threads.find((item) => item.root.id === 109)
    assert.deepEqual(
      thread.replies.map((item) => item.id),
      [110, 111],
    )
  })

  it("keeps the Build the reviewer saw, normalizes times, and drops personal display data", () => {
    const thread = read(weekOneLog()).threads.find((item) => item.root.id === 104)
    assert.equal(thread.root.buildNumber, 5)
    assert.equal(thread.root.createdAt, "2026-10-02T14:00:00.000000Z")
    const [event] = hubThreadEvents({
      meta: read(weekOneLog()).meta,
      thread,
      scope: expected,
      episodeId: "ep_aaaaaaaaaaaaaaaa",
      existing: [],
    })
    const text = JSON.stringify(event)
    assert.doesNotMatch(text, /avatars\.example\.com/, "avatar URLs never reach a stored event")
    assert.ok(!text.includes("unread"))
    assert.ok(!text.includes("selector"), "only Hub's compact target fields are kept")
    assert.deepEqual(event.payload.context, {
      kind: "element",
      route: { pathname: "/checkout", search: "", hash: "" },
      accessibleName: "Email",
      tagName: "input",
      selectedText: "",
    })
  })

  it("marks a log without its last page incomplete", () => {
    const log = weekOneLog()
    log.calls.splice(2, 1)
    assert.match(read(log).problems.join(" "), /more results remain/)
  })

  it("refuses pages whose pagination flags are missing or contradictory", () => {
    const missing = weekOneLog()
    const thread = missing.calls[2].result.threads.find((item) => item.id === 109)
    delete thread.repliesHasMore
    delete thread.repliesNextCursor
    assert.throws(() => read(missing), /needs replies, repliesHasMore, and threadComplete/)
    const contradictory = weekOneLog()
    contradictory.calls[1].result.nextCursor = null
    assert.throws(() => read(contradictory), /nextCursor that contradicts hasMore/)
    const complete = weekOneLog()
    const partial = complete.calls[2].result.threads.find((item) => item.id === 109)
    partial.threadComplete = true
    assert.throws(() => read(complete), /says it is complete and has more replies/)
  })

  it("marks reply pages that skip or repeat messages incomplete", () => {
    const skipped = weekOneLog()
    const continuation = skipped.calls.at(-1)
    continuation.input.cursor = continuation.input.cursor.replace(/:1$/, ":2")
    skipped.calls[2].result.threads.find((item) => item.id === 109).repliesNextCursor =
      continuation.input.cursor
    const result = read(skipped)
    assert.equal(result.complete, false)
    assert.match(result.problems.join(" "), /reply cursor that does not follow|skip or repeat/)
  })

  it("marks a list page whose next cursor skips threads incomplete", () => {
    const log = weekOneLog()
    const cursor = log.calls[1].result.nextCursor.replace(/:5$/, ":6")
    log.calls[1].result.nextCursor = cursor
    log.calls[2].input.cursor = cursor
    const result = read(log)
    assert.equal(result.complete, false)
    assert.match(result.problems.join(" "), /does not follow its threads|starts after 6 threads/)
  })

  it("marks a broken cursor chain incomplete", () => {
    const log = weekOneLog()
    log.calls[2].input.cursor = "3f2c8a10-5b7e-4c1d-9a2f-6e8b7c9d0a11:list:7"
    assert.match(read(log).problems.join(" "), /does not continue from the previous page/)
  })

  it("marks missing reply pages incomplete", () => {
    const log = weekOneLog()
    log.calls = log.calls.filter((call) => call.action !== "get_repository_comment_thread")
    const result = read(log)
    assert.equal(result.complete, false)
    assert.match(result.problems.join(" "), /Replies for thread 109 stop/)
  })

  it("marks filters that change between pages incomplete", () => {
    const log = weekOneLog()
    log.calls[2].input.resolution = "unresolved"
    assert.match(read(log).problems.join(" "), /different filters/)
  })

  it("marks a log that starts mid-scan incomplete", () => {
    const log = weekOneLog()
    log.calls.shift()
    assert.match(read(log).problems.join(" "), /earlier pages are missing/)
  })

  it("records the filters the scan used", () => {
    const log = collectionLog({
      snapshotId: "11111111-2222-4333-8444-555555555555",
      capturedAt: "2026-10-05T18:00:00.000000Z",
      threads: [],
      filters: { from: "2026-09-29T00:00:00Z", to: "2026-10-05T00:00:00+00:00" },
    })
    assert.deepEqual(read(log).filters, {
      resolution: "all",
      read: "all",
      from: "2026-09-29T00:00:00.000000Z",
      to: "2026-10-05T00:00:00.000000Z",
    })
  })

  it("refuses results from another snapshot, repository, scope, or source", () => {
    const mixed = weekOneLog()
    mixed.calls[2].result.snapshotId = "00000000-0000-4000-8000-000000000000"
    assert.throws(() => read(mixed), { code: "invalid_input" })
    assert.throws(() => readHubReviewCollection(weekOneLog(), { repository: "acme/other" }), {
      code: "scope_violation",
    })
    const prototypeScoped = weekOneLog()
    for (const call of prototypeScoped.calls) {
      call.result.target = { ...call.result.target, scope: undefined, prototypeId: 11 }
    }
    assert.throws(
      () => read(prototypeScoped),
      /Prototype-scoped list_comments logs are not supported/,
    )
    const foreign = weekOneLog()
    foreign.calls[0].result.contentTrust = { source: "web", untrusted: true, treatAs: "data" }
    assert.throws(() => read(foreign), /not a Hub review comment result/)
    assert.throws(() => read({ kind: "other", calls: [] }), { code: "invalid_input" })
  })

  it("adds an edit, a deletion, and a resolution as new events without touching old ones", () => {
    const first = read(weekOneLog())
    const thread = first.threads.find((item) => item.root.id === 101)
    const episodeId = "ep_aaaaaaaaaaaaaaaa"
    const original = hubThreadEvents({
      meta: first.meta,
      thread,
      scope: expected,
      episodeId,
      existing: [],
    })
    assert.deepEqual(
      original.map((event) => event.type),
      ["human_comment", "human_comment"],
    )
    assert.equal(original[1].parentEventId, original[0].id)

    const edited = structuredClone(thread)
    edited.root.body = "Labels vanish while typing. Put each label above its field."
    edited.root.editedAt = "2026-10-06T10:00:00.000000Z"
    edited.replies[0] = {
      ...edited.replies[0],
      body: null,
      deletedAt: "2026-10-07T09:00:00.000000Z",
    }
    edited.root.resolvedAt = "2026-10-07T12:00:00.000000Z"
    edited.root.resolvedByLogin = "ana-designer"
    const later = hubThreadEvents({
      meta: first.meta,
      thread: edited,
      scope: expected,
      episodeId,
      existing: original,
    })
    assert.deepEqual(
      later.map((event) => event.type),
      ["human_comment", "retraction", "status_change"],
    )
    assert.equal(later[0].supersedes, original[0].id)
    assert.equal(later[1].payload.target.eventId, original[1].id)
    assert.equal(later[2].payload.status, "resolved")
    assert.deepEqual(
      hubThreadEvents({
        meta: first.meta,
        thread: edited,
        scope: expected,
        episodeId,
        existing: [...original, ...later],
      }),
      [],
    )
  })

  it("records a thread that someone reopened and resolved again between imports", () => {
    const first = read(weekOneLog())
    const scope = { ...expected, host: "github.com" }
    const episodeId = "ep_bbbbbbbbbbbbbbbb"
    const resolved = structuredClone(first.threads.find((item) => item.root.id === 103))
    function resolvedBy(at, login, githubId) {
      const thread = structuredClone(resolved)
      Object.assign(thread.root, {
        resolvedAt: at,
        resolvedByLogin: login,
        resolvedByGithubId: githubId,
      })
      return thread
    }
    function events(thread, existing) {
      return hubThreadEvents({ meta: first.meta, thread, scope, episodeId, existing })
    }
    const original = events(resolvedBy("2026-10-07T12:00:00.000000Z", "ben-manager"), [])

    // Another reviewer resolved it again, later or at the very same time.
    for (const at of ["2026-10-09T08:00:00.000000Z", "2026-10-07T12:00:00.000000Z"]) {
      const again = resolvedBy(at, "cy-engineer")
      const later = events(again, original)
      assert.deepEqual(
        later.map((event) => [event.type, event.payload.status, event.at, event.payload.by.id]),
        [["status_change", "resolved", at, "github:cy-engineer"]],
      )
      assert.notEqual(later[0].id, original.at(-1).id)
      assert.deepEqual(events(again, [...original, ...later]), [])
    }
    // The same reviewer, now named by a stable ID, did not resolve it again.
    const resolvedAt = "2026-10-07T12:00:00.000000Z"
    const adopted = events(resolvedBy(resolvedAt, "ben-manager", 43), [])
    assert.deepEqual(events(resolvedBy(resolvedAt, "ben-manager", 43), original), [])
    // A login given without the stable ID it had may now belong to someone else.
    assert.deepEqual(
      events(resolvedBy(resolvedAt, "ben-manager"), adopted).map((event) => event.payload.by.id),
      ["github:ben-manager"],
    )
  })
})
