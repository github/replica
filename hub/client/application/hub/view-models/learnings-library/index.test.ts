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
        status: "recalled",
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
      status: "recalled" as const,
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
})
