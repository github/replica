import { describe, expect, it } from "vitest"

import { emptyLearnings } from "@application/hub/routes/fixtures/empty-learnings"

import { learningsLibrary } from "."

const pathname = "/repositories/2001/learnings"
const digest = `sha256:${"a".repeat(64)}`

describe("learningsLibrary()", () => {
  it("opens on active learnings once nothing waits for a decision", () => {
    const state = emptyLearnings()
    state.learnings = [
      {
        id: "mem_active",
        title: null,
        content: "Use one primary button per form.\nLabel it with the action.",
        digest,
        acceptedBy: "mona",
        acceptedAt: "2026-10-06T15:00:00Z",
        edited: false,
        lastDecision: "accepted" as const,
        status: "recalled",
        shared: false,
      },
    ]

    const result = learningsLibrary(state, { pathname, search: "" }, null)

    expect(result.status).toBe("active")
    expect(result.learnings).toEqual([
      expect.objectContaining({
        title: "Use one primary button per form.",
        detailPath: `${pathname}?status=active&learning=mem_active`,
      }),
    ])
  })

  it("searches titles and guidance and keeps the page within range", () => {
    const state = emptyLearnings()
    state.learnings = Array.from({ length: 30 }, (_, index) => ({
      id: `mem_${index}`,
      title: index === 29 ? "Keep labels visible" : `Learning ${index}`,
      content: index === 28 ? "Labels stay above fields." : "Use one primary button.",
      digest,
      acceptedBy: "mona",
      acceptedAt: "2026-10-06T15:00:00Z",
      edited: false,
      lastDecision: "accepted" as const,
      status: "recalled" as const,
      shared: false,
    }))

    const firstPage = learningsLibrary(state, { pathname, search: "?status=active" }, null)
    const pastTheEnd = learningsLibrary(state, { pathname, search: "?status=active&page=9" }, null)
    const searched = learningsLibrary(state, { pathname, search: "?status=active&q=LABEL" }, null)

    expect(firstPage.learnings).toHaveLength(25)
    expect(firstPage.pageCount).toBe(2)
    expect(pastTheEnd.page).toBe(2)
    expect(pastTheEnd.learnings).toHaveLength(5)
    expect(pastTheEnd.returnPath).toBe(`${pathname}?status=active&page=2`)
    expect(searched.learnings.map((learning) => learning.id)).toEqual(["mem_28", "mem_29"])
    expect(searched.statusPaths.rejected).toBe(`${pathname}?status=rejected&q=LABEL`)
  })

  it("shows why a learning was retired, its history, and how to accept it again", () => {
    const state = emptyLearnings()
    state.rejected = [
      {
        id: "mem_retired",
        title: "Open links in a new tab",
        content: "Open every link in a new tab.",
        digest,
        state: "retired",
        decidedBy: "hubot",
        decidedAt: "2026-10-08T11:00:00Z",
        reason: "It breaks the back button.",
        shared: false,
      },
    ]

    const result = learningsLibrary(
      state,
      { pathname, search: "?status=rejected&learning=mem_retired" },
      {
        decisions: [
          {
            version: 1,
            state: "proposed",
            change: "proposed",
            by: "agent:replica-learning",
            at: "2026-10-07T04:07:00Z",
            reason: null,
          },
          {
            version: 2,
            state: "retired",
            change: "retired",
            by: "hubot",
            at: "2026-10-08T11:00:00Z",
            reason: "It breaks the back button.",
          },
        ],
        evidence: [],
        otherEvidenceCount: 2,
        contradictions: [],
        otherContradictionsCount: 0,
        outcomes: [],
      },
    )

    expect(result.selected).toMatchObject({
      facts: ["Retired by @hubot on October 8, 2026"],
      reason: { heading: "Why it was retired", text: "It breaks the back button." },
      otherEvidence: "2 more comments that Hub cannot show here",
      history: [
        { label: "Suggested", by: null },
        { label: "Retired", by: "hubot" },
      ],
      decision: {
        path: `${pathname}/mem_retired/decision`,
        digest,
        title: "Open links in a new tab",
      },
    })
  })

  it("offers sharing only for learnings this repository's agents get", () => {
    const state = emptyLearnings()
    state.permissions.share = true
    state.learnings = [
      {
        id: "mem_expired",
        title: "Use the old header",
        content: "Use the old header.",
        digest,
        acceptedBy: "mona",
        acceptedAt: "2026-10-06T15:00:00Z",
        edited: false,
        lastDecision: "accepted" as const,
        status: "not-recalled",
        shared: false,
      },
    ]

    const result = learningsLibrary(
      state,
      { pathname, search: "?status=active&learning=mem_expired" },
      null,
    )

    expect(result.selected?.share).toBeNull()
  })

  it("lets an administrator stop sharing a retired learning", () => {
    const state = emptyLearnings()
    state.permissions.share = true
    state.rejected = [
      {
        id: "mem_retired",
        title: "Open links in a new tab",
        content: "Open every link in a new tab.",
        digest,
        state: "retired",
        decidedBy: "hubot",
        decidedAt: "2026-10-08T11:00:00Z",
        reason: "It breaks the back button.",
        shared: true,
      },
    ]

    const result = learningsLibrary(
      state,
      { pathname, search: "?status=rejected&learning=mem_retired" },
      null,
    )

    expect(result.selected).toMatchObject({
      facts: [
        "Retired by @hubot on October 8, 2026",
        "Still shared across Hub once accepted again",
      ],
      share: { path: `${pathname}/mem_retired/share`, shared: true },
    })
  })

  it("credits the latest edit and shows comments that disagreed", () => {
    const state = emptyLearnings()
    state.learnings = [
      {
        id: "mem_active",
        title: "Keep labels visible",
        content: "Show a label above every field.",
        digest,
        acceptedBy: "hubot",
        acceptedAt: "2026-10-09T15:00:00Z",
        edited: true,
        lastDecision: "edited",
        status: "recalled",
        shared: false,
      },
    ]

    const result = learningsLibrary(
      state,
      { pathname, search: "?status=active&learning=mem_active" },
      {
        decisions: [],
        evidence: [],
        otherEvidenceCount: 0,
        contradictions: [
          {
            eventId: "evt_against",
            commentId: 9,
            body: "Placeholders are fine on search fields.",
            authorLogin: "mona",
            authorAvatarUrl: null,
            prototypeId: "13",
            prototypeName: "Search",
            createdAt: "2026-10-05T10:00:00Z",
          },
        ],
        otherContradictionsCount: 1,
        outcomes: [],
      },
    )

    expect(result.selected?.facts[0]).toBe("Edited by @hubot on October 9, 2026")
    expect(result.selected?.contradictions.map((item) => item.eventId)).toEqual(["evt_against"])
    expect(result.selected?.otherContradictions).toBe(
      "1 more opposing comment that Hub cannot show here",
    )
  })

  it("reads each score as a result, newest first", () => {
    const state = emptyLearnings()
    state.learnings = [
      {
        id: "mem_active",
        title: "Keep labels visible",
        content: "Show a label above every field.",
        digest,
        acceptedBy: "hubot",
        acceptedAt: "2026-10-09T15:00:00Z",
        edited: false,
        lastDecision: "accepted",
        status: "recalled",
        shared: false,
      },
    ]
    const score = {
      source: "automated" as const,
      reasoning: "The form kept its labels.",
      issue: null,
      build: { prototypeId: "17", prototypeName: "Checkout", number: 3 },
    }

    const result = learningsLibrary(
      state,
      { pathname, search: "?status=active&learning=mem_active" },
      {
        decisions: [],
        evidence: [],
        otherEvidenceCount: 0,
        contradictions: [],
        otherContradictionsCount: 0,
        outcomes: [
          {
            ...score,
            id: "score_not_followed",
            efficiency: 4,
            followed: "not_followed",
            scoredAt: "2026-10-10T00:00:00Z",
          },
          {
            ...score,
            id: "score_concern",
            efficiency: 2,
            followed: "followed",
            issue: "The rule did not say where the label goes.",
            scoredAt: "2026-10-11T00:00:00Z",
          },
          {
            ...score,
            id: "score_supports",
            source: "reviewer_confirmed",
            efficiency: 3,
            followed: "followed",
            scoredAt: "2026-10-12T00:00:00Z",
            after: { sha256: "b".repeat(64), route: "/checkout" },
          },
        ],
      },
    )

    expect(result.selected?.outcomes?.map((outcome) => [outcome.result, outcome.summary])).toEqual([
      ["supports", "The form kept its labels."],
      ["concern", "The rule did not say where the label goes."],
      ["inconclusive", "The form kept its labels."],
    ])
    expect(result.selected?.outcomes?.[0]).toMatchObject({
      reviewerConfirmed: true,
      buildPath: "/repositories/2001/prototypes/17?build=3",
      beforeScreenshotUrl: null,
      afterScreenshotUrl: `/api/repositories/2001/learnings/screenshots/${"b".repeat(64)}`,
    })
  })
})
