import { describe, expect, it } from "vitest"

import { learningDecisionInputSchema, learningsResponseSchema } from "."

const digest = `sha256:${"a".repeat(64)}`

const evidence = {
  eventId: "evt_1",
  commentId: 17,
  body: "The email field needs a visible label.",
  authorLogin: "mona",
  authorAvatarUrl: null,
  prototypeId: "17",
  prototypeName: "Checkout",
  createdAt: "2026-11-09T20:00:00.000Z",
}

describe("Learnings contracts", () => {
  it("accepts the complete repository-administrator review and run history response", () => {
    const response = {
      accessDenied: false as const,
      repository: {
        id: "2001",
        nameWithOwner: "github/prototype",
        defaultBranch: "main",
      },
      canAdministerHub: false,
      permissions: { decide: true, requestRun: true },
      copilot: { state: "connected" as const, connectedBy: "hub-admin" },
      usageCredits: "0.0735",
      runAvailable: true,
      loadError: null,
      identityReviewCount: 1,
      suggestions: [
        {
          id: "mem_suggestion",
          content: "Show a visible label above every form field.",
          reviewDigest: digest,
          support: { reviewers: 2, prototypes: 2 },
          replaces: [
            { id: "mem_old", content: "Use a label when a field is unclear." },
            { id: "mem_withheld", content: null },
          ],
          evidence: [evidence],
          otherEvidenceCount: 1,
          contradictions: [{ ...evidence, eventId: "evt_2", body: null }],
          otherContradictionsCount: 2,
        },
      ],
      learnings: [
        {
          id: "mem_accepted",
          content: "Use one primary button per form.",
          acceptedBy: "octocat",
          acceptedAt: "2026-11-08T20:00:00.000Z",
          edited: true,
          status: "recalled" as const,
        },
        {
          id: "mem_damaged",
          content: null,
          acceptedBy: null,
          acceptedAt: null,
          edited: false,
          status: "damaged" as const,
        },
      ],
      recall: {
        text: "Approved team learnings\n1. Use one primary button per form.",
        count: 1,
      },
      runs: [
        {
          id: 8,
          startedAt: "2026-11-10T12:00:00.000Z",
          startedBy: { type: "user" as const, login: "octocat" },
          state: "succeeded" as const,
          result: {
            type: "succeeded" as const,
            commentsConsidered: 400,
            commentsLabeled: 120,
            commentsRemaining: 35,
            suggestions: 2,
            suggestionsRemaining: 1,
          },
          usage: { credits: "0.0735", requests: 2 },
        },
        {
          id: 7,
          startedAt: "2026-11-09T12:00:00.000Z",
          startedBy: { type: "daily" as const },
          state: "failed" as const,
          result: { type: "failed" as const, summary: "Copilot did not return a result." },
          usage: null,
        },
      ],
    }

    expect(learningsResponseSchema.parse(response)).toEqual(response)
  })

  it("keeps denied responses free of suggestion, evidence, and permission data", () => {
    const repository = {
      id: "2001",
      nameWithOwner: "github/prototype",
      defaultBranch: "main",
    }
    expect(
      learningsResponseSchema.parse({
        accessDenied: true,
        repository,
        canAdministerHub: false,
      }),
    ).toEqual({
      accessDenied: true,
      repository,
      canAdministerHub: false,
    })
    expect(
      learningsResponseSchema.safeParse({
        accessDenied: true,
        repository,
        canAdministerHub: false,
        permissions: { decide: false, requestRun: false },
        suggestions: [{ evidence: [evidence] }],
      }).success,
    ).toBe(false)
  })

  it.each([
    ["accept", { decision: "accept", digest }],
    ["edited acceptance", { decision: "accept", digest, content: "Label every field." }],
    ["reject", { decision: "reject", digest, reason: "The design system already covers this." }],
    ["retire", { decision: "retire", reason: "This guidance no longer applies." }],
  ])("accepts the exact %s decision input", (_label, input) => {
    expect(learningDecisionInputSchema.parse(input)).toEqual(input)
  })

  it.each([
    ["accept without the reviewed digest", { decision: "accept" }],
    ["reject without the reviewed digest", { decision: "reject", reason: "Already covered." }],
    ["reject without a reason", { decision: "reject", digest }],
    ["retire with a digest", { decision: "retire", digest, reason: "No longer applies." }],
    ["a malformed digest", { decision: "accept", digest: "sha256:not-a-digest" }],
  ])("rejects %s", (_label, input) => {
    expect(learningDecisionInputSchema.safeParse(input).success).toBe(false)
  })

  it.each([".", ".."])("rejects the dot-segment learning identifier %s", (id) => {
    const response = {
      ...learningsResponseSchema.parse({
        accessDenied: true,
        repository: {
          id: "2001",
          nameWithOwner: "github/prototype",
          defaultBranch: "main",
        },
        canAdministerHub: false,
      }),
      accessDenied: false as const,
      permissions: { decide: true, requestRun: true },
      copilot: { state: "not-connected" as const },
      usageCredits: "0",
      runAvailable: false,
      loadError: null,
      identityReviewCount: 0,
      suggestions: [
        {
          id,
          content: "Use visible labels.",
          reviewDigest: digest,
          support: null,
          replaces: [],
          evidence: [],
          otherEvidenceCount: 0,
          contradictions: [],
          otherContradictionsCount: 0,
        },
      ],
      learnings: [],
      recall: { text: "", count: 0 },
      runs: [],
    }

    expect(learningsResponseSchema.safeParse(response).success).toBe(false)
  })
})
