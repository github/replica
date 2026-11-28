import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createNoopConsolidator } from "../src/consolidators/noop.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"

const WINDOW = { from: "2026-10-01T00:00:00.000000Z", to: "2026-10-08T00:00:00.000000Z" }
const scope = { repository: "acme/checkout-prototypes" }

/** A small view: one episode per comment, labeled by one agent unless told otherwise. */
function view(comments, { memories = [], extra = [] } = {}) {
  const episodes = []
  const events = []
  comments.forEach((comment, index) => {
    const episodeId = comment.episodeId ?? `ep_episode${String(index).padStart(4, "0")}`
    if (!episodes.some((episode) => episode.id === episodeId))
      episodes.push({
        id: episodeId,
        scope,
        source: {
          kind: "hub_review_comments",
          hubOrigin: "https://replica.example.com",
          prototypeId: comment.prototype,
          buildNumber: comment.build ?? 1,
          threadId: index + 1,
        },
      })
    const eventId = `ev_comment${String(index).padStart(4, "0")}`
    events.push({
      id: eventId,
      episodeId,
      scope,
      type: "human_comment",
      at: comment.at ?? "2026-10-02T10:00:00.000000Z",
      actor: { kind: "human", id: `github:${comment.by}` },
      payload: { commentId: index + 1, body: comment.body ?? "text" },
    })
    for (const label of comment.labels ?? [{}])
      events.push({
        id: `ev_label${String(index).padStart(4, "0")}${label.by ?? "agent"}`,
        episodeId,
        scope,
        type: "annotation",
        at: "2026-10-08T00:00:00.000000Z",
        actor: { kind: "agent", id: label.by ?? "agent:copilot" },
        payload: {
          target: { eventId },
          theme: {
            key: label.theme ?? comment.theme ?? "visible-form-labels",
            statement: label.statement ?? "Keep labels visible.",
          },
          signal: label.signal ?? "accessibility",
          observation: label.observation ?? "observed",
          stance: label.stance ?? "supports",
          ...(label.trace ? { trace: label.trace } : {}),
        },
      })
  })
  return {
    purpose: "instruction",
    window: WINDOW,
    scope,
    episodes,
    events: [...events, ...extra],
    memories,
  }
}

function run(options, input) {
  return createRecurrenceConsolidator(options).consolidate(
    { window: WINDOW, scope, purpose: "instruction" },
    input,
  )
}

describe("recurrence consolidator", () => {
  it("does not use an older label after an independently imported edit", async () => {
    const input = view([
      { by: "ana-designer", prototype: 1, at: "2026-10-02T10:00:00.000000Z" },
      { by: "ana-designer", prototype: 1, at: "2026-10-03T10:00:00.000000Z", labels: [] },
    ])
    for (const episode of input.episodes) {
      episode.source.repositoryId = 42
      episode.source.threadId = 101
    }
    const comments = input.events.filter((event) => event.type === "human_comment")
    comments[1].payload.commentId = comments[0].payload.commentId
    const first = {
      ...input,
      episodes: [input.episodes[0]],
      events: input.events.filter((event) => event.episodeId === input.episodes[0].id),
    }
    const thresholds = { minEpisodes: 1, minPrototypes: 1, minReviewers: 1 }
    assert.equal((await run(thresholds, first)).proposals.length, 1)
    assert.deepEqual((await run(thresholds, input)).proposals, [])
  })

  it("proposes a theme with distinct support and counts a repeat reviewer once", async () => {
    const result = await run(
      {},
      view([
        { by: "ana-designer", prototype: 1 },
        { by: "ana-designer", prototype: 1, build: 2 },
        { by: "ben-manager", prototype: 2 },
      ]),
    )
    assert.equal(result.proposals.length, 1)
    const [proposal] = result.proposals
    assert.deepEqual(proposal.support, {
      distinctEpisodes: 3,
      distinctPrototypes: 2,
      distinctReviewers: 2,
      distinctBuilds: 3,
    })
    assert.equal(proposal.lifecycle.action, "new")
    assert.equal(proposal.title, "Visible form labels")
    assert.equal(proposal.evidence.length, 3)
    assert.match(proposal.rationale.recurrence, /3 threads on 2 prototypes by 2 reviewers/)
  })

  it("proposes a theme one reviewer raised twice on one prototype by default", async () => {
    const result = await run(
      {},
      view([
        { by: "ana-designer", prototype: 1 },
        { by: "ana-designer", prototype: 1 },
      ]),
    )

    assert.equal(result.proposals.length, 1)
    assert.deepEqual(result.proposals[0].support, {
      distinctEpisodes: 2,
      distinctPrototypes: 1,
      distinctReviewers: 1,
      distinctBuilds: 1,
    })
  })

  it("holds back a theme below any threshold and says which", async () => {
    const result = await run(
      { minReviewers: 2 },
      view([
        { by: "ana-designer", prototype: 1 },
        { by: "ana-designer", prototype: 2 },
      ]),
    )
    assert.deepEqual(result.proposals, [])
    assert.equal(result.diagnostics[0].code, "below_threshold")
    assert.match(result.diagnostics[0].message, /2 reviewers \(has 1\)/)
    const relaxed = await run(
      { minReviewers: 1 },
      view([
        { by: "ana-designer", prototype: 1 },
        { by: "ana-designer", prototype: 2 },
      ]),
    )
    assert.equal(relaxed.proposals.length, 1)
  })

  it("does not propose a contested theme", async () => {
    const result = await run(
      {},
      view([
        { by: "ana-designer", prototype: 1 },
        { by: "ben-manager", prototype: 2 },
        { by: "cy-engineer", prototype: 1, labels: [{ stance: "contradicts" }] },
        { by: "dee-researcher", prototype: 3, labels: [{ stance: "contradicts" }] },
      ]),
    )
    assert.deepEqual(result.proposals, [])
    assert.equal(result.diagnostics[0].code, "contested")
  })

  it("keeps a minority disagreement as contradicting evidence", async () => {
    const result = await run(
      {},
      view([
        { by: "ana-designer", prototype: 1 },
        { by: "ben-manager", prototype: 2 },
        { by: "eli-finance", prototype: 3 },
        { by: "cy-engineer", prototype: 1, labels: [{ stance: "contradicts" }] },
      ]),
    )
    assert.equal(result.proposals.length, 1)
    assert.equal(result.proposals[0].contradictions.length, 1)
    assert.match(result.proposals[0].rationale.contradictions, /1 reviewer/)
  })

  it("counts questions, praise, and performance by default", async () => {
    const questions = await run(
      {},
      view([
        { by: "ana-designer", prototype: 1, labels: [{ observation: "question" }] },
        { by: "ben-manager", prototype: 2, labels: [{ observation: "praise" }] },
      ]),
    )
    assert.equal(questions.proposals.length, 1)
    const performance = await run(
      {},
      view([
        { by: "ana-designer", prototype: 1, labels: [{ signal: "performance" }] },
        { by: "ben-manager", prototype: 2, labels: [{ signal: "performance" }] },
      ]),
    )
    assert.equal(performance.proposals.length, 1)
  })

  it("leaves out observation kinds and signals a team turns off", async () => {
    const questions = await run(
      { observations: ["observed", "preference"] },
      view([
        { by: "ana-designer", prototype: 1, labels: [{ observation: "question" }] },
        { by: "ben-manager", prototype: 2, labels: [{ observation: "praise" }] },
      ]),
    )
    assert.equal(questions.diagnostics[0].code, "not_observed")
    const performance = await run(
      { signals: ["usability"] },
      view([
        { by: "ana-designer", prototype: 1, labels: [{ signal: "performance" }] },
        { by: "ben-manager", prototype: 2, labels: [{ signal: "performance" }] },
      ]),
    )
    assert.equal(performance.diagnostics[0].code, "signal_not_enabled")
  })

  it("skips accepted themes and returns rejected ones only with more support", async () => {
    const comments = [
      { by: "ana-designer", prototype: 1 },
      { by: "ben-manager", prototype: 2 },
    ]
    const accepted = await run(
      {},
      view(comments, {
        memories: [
          { id: "mem_old", themeKey: "visible-form-labels", state: "accepted", effective: true },
        ],
      }),
    )
    assert.equal(accepted.diagnostics[0].code, "already_accepted")
    const rejected = {
      id: "mem_old",
      themeKey: "visible-form-labels",
      state: "rejected",
      support: { distinctEpisodes: 2 },
    }
    assert.equal(
      (await run({}, view(comments, { memories: [rejected] }))).diagnostics[0].code,
      "previously_rejected",
    )
    const more = await run(
      {},
      view([...comments, { by: "cy-engineer", prototype: 3 }], { memories: [rejected] }),
    )
    assert.equal(more.proposals.length, 1)
  })

  it("offers to replace an accepted learning that no longer applies", async () => {
    const comments = [
      { by: "ana-designer", prototype: 1 },
      { by: "ben-manager", prototype: 2 },
    ]
    const stale = {
      id: "mem_stale",
      themeKey: "visible-form-labels",
      state: "accepted",
      effective: false,
      needsRebuild: true,
    }
    const result = await run({}, view(comments, { memories: [stale] }))
    assert.equal(result.proposals.length, 1)
    assert.deepEqual(result.proposals[0].lifecycle, { action: "supersede", targets: ["mem_stale"] })
    assert.equal(
      result.diagnostics.find((item) => item.code === "replaces_stale").themeKey,
      "visible-form-labels",
    )
  })

  it("ignores labels on edited comments and comments outside the window", async () => {
    const input = view([
      { by: "ana-designer", prototype: 1 },
      { by: "ben-manager", prototype: 2 },
      { by: "cy-engineer", prototype: 3, at: "2026-09-01T00:00:00.000000Z" },
    ])
    input.events.push({
      id: "ev_edit",
      episodeId: input.episodes[0].id,
      scope,
      type: "human_comment",
      at: "2026-10-03T00:00:00.000000Z",
      actor: { kind: "human", id: "github:ana-designer" },
      supersedes: "ev_comment0000",
      payload: { commentId: 1, body: "edited" },
    })
    const result = await run({}, input)
    assert.equal(
      result.diagnostics.find((item) => item.code === "target_edited").code,
      "target_edited",
    )
    assert.equal(
      result.diagnostics.find((item) => item.code === "below_threshold").support.distinctEpisodes,
      1,
    )
  })

  it("uses each labeler's latest label for a comment", async () => {
    const input = view([
      { by: "ana-designer", prototype: 1 },
      { by: "ben-manager", prototype: 2 },
    ])
    input.events.push({
      ...input.events.find((event) => event.type === "annotation"),
      id: "ev_relabel",
      payload: { ...input.events[1].payload, theme: { key: "other-theme", statement: "Other." } },
    })
    const result = await run({ minReviewers: 1, minPrototypes: 1, minEpisodes: 1 }, input)
    assert.deepEqual(result.proposals.map((proposal) => proposal.themeKey).sort(), [
      "other-theme",
      "visible-form-labels",
    ])
    assert.equal(
      result.proposals.find((proposal) => proposal.themeKey === "visible-form-labels").support
        .distinctEpisodes,
      1,
    )
  })

  it("gives the same proposals for the same evidence in any order", async () => {
    const input = view([
      {
        by: "ana-designer",
        prototype: 1,
        labels: [{ statement: "Keep labels visible.", trace: { kind: "skill", ref: "b" } }],
      },
      {
        by: "ben-manager",
        prototype: 2,
        labels: [{ statement: "Labels stay visible.", trace: { kind: "skill", ref: "a" } }],
      },
      { by: "cy-engineer", prototype: 3, labels: [{ statement: "Keep labels visible." }] },
    ])
    const first = await run({}, input)
    const reversed = await run(
      {},
      { ...input, events: [...input.events].reverse(), episodes: [...input.episodes].reverse() },
    )
    assert.deepEqual(reversed, first)
    assert.equal(first.proposals[0].content, "Keep labels visible.")
    assert.deepEqual(
      first.proposals[0].appliesTo.map((item) => item.ref),
      ["a", "b"],
    )
    assert.equal(
      first.diagnostics.find((item) => item.code === "alternative_wording").themeKey,
      "visible-form-labels",
    )
  })

  it("refuses invalid settings", () => {
    assert.throws(() => createRecurrenceConsolidator({ minReviewers: 0 }), /positive whole number/)
    assert.throws(
      () => createRecurrenceConsolidator({ signals: ["mood"] }),
      /signals must come from/,
    )
    assert.throws(
      () => createRecurrenceConsolidator({ observations: [] }),
      /observations must come from/,
    )
  })

  it("the no-op consolidator proposes nothing", async () => {
    const result = await createNoopConsolidator().consolidate(
      { window: WINDOW, scope, purpose: "instruction" },
      view([]),
    )
    assert.deepEqual(result.proposals, [])
    assert.equal(result.diagnostics[0].code, "disabled")
  })
})
