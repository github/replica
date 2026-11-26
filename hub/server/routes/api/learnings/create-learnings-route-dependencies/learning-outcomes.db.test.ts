import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { getLearningHistory } from "../../../../domains/learning/get-learning-history"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../integrations/bullmq/create-job-queue", () => ({
  createJobQueue: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock("../../../../domains/learning/get-learning-history", () => ({
  getLearningHistory: vi.fn(),
}))

describe("learning outcomes", () => {
  it("links each score to a Build people can open and hides scores without one", async () => {
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 17n, nameWithOwner: "octo/source" },
    })
    const checkout = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "checkout",
        name: "Checkout",
        registeredAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const signup = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "signup",
        name: "Signup",
        registeredAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const main = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "main",
        name: "Main",
        registeredAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const shared = "a".repeat(40)
    // Checkout's Build is the newest despite its lower number, judged by workflow time.
    for (const [prototype, number, times] of [
      [
        checkout,
        3,
        {
          createdAt: new Date("2026-12-01T00:00:00Z"),
          workflowCreatedAt: new Date("2026-12-01T02:00:00Z"),
        },
      ],
      [signup, 7, { createdAt: new Date("2026-12-01T01:00:00Z") }],
      [main, 9, { createdAt: new Date("2026-12-01T03:00:00Z") }],
    ] as const) {
      await prisma.build.create({
        data: {
          ...times,
          prototypeId: prototype.id,
          number,
          state: "successful",
          commitSha: shared,
          startedAt: new Date("2026-12-01T00:00:00Z"),
          finishedAt: new Date("2026-12-01T00:01:00Z"),
        },
      })
    }
    const score = {
      efficiency: 3,
      followed: "followed" as const,
      reasoning: "The form kept its labels.",
      issue: null,
      scoredAt: "2026-12-02T00:00:00.000Z",
    }
    vi.mocked(getLearningHistory).mockResolvedValue({
      decisions: [],
      evidence: [],
      otherEvidenceCount: 0,
      contradictions: [],
      otherContradictionsCount: 0,
      outcomes: [
        { ...score, id: "score_checkout", commitSha: shared, prototypeId: checkout.id },
        { ...score, id: "score_signup", commitSha: shared, prototypeId: signup.id },
        { ...score, id: "score_any_prototype", commitSha: shared, prototypeId: null },
        { ...score, id: "score_unbuilt", commitSha: "b".repeat(40), prototypeId: null },
      ],
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )

    const history = await learnings.getHistory({ repositoryId: repository.id, learningId: "mem_1" })

    expect(history.outcomes.map((outcome) => [outcome.id, outcome.build])).toEqual([
      ["score_checkout", { prototypeId: checkout.id, prototypeName: "Checkout", number: 3 }],
      ["score_signup", { prototypeId: signup.id, prototypeName: "Signup", number: 7 }],
      ["score_any_prototype", { prototypeId: checkout.id, prototypeName: "Checkout", number: 3 }],
    ])
  })

  it("hides the scorer's words when a screenshot it saw is no longer shown", async () => {
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 18n, nameWithOwner: "octo/consent" },
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "checkout",
        name: "Checkout",
        registeredAt: new Date("2026-11-01T00:00:00Z"),
      },
    })
    const commitSha = "c".repeat(40)
    await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        commitSha,
        startedAt: new Date("2026-12-01T00:00:00Z"),
        finishedAt: new Date("2026-12-01T00:01:00Z"),
      },
    })
    vi.mocked(getLearningHistory).mockResolvedValue({
      decisions: [],
      evidence: [],
      otherEvidenceCount: 0,
      contradictions: [],
      otherContradictionsCount: 0,
      outcomes: [
        {
          id: "score_with_screenshot",
          commitSha,
          prototypeId: prototype.id,
          efficiency: 2,
          followed: "followed",
          reasoning: "The screenshot shows the card number.",
          issue: "The card number is visible.",
          scoredAt: "2026-12-02T00:00:00.000Z",
          after: { sha256: "d".repeat(64), route: "/checkout", consentGrantId: "grant_old" },
        },
      ],
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )

    const history = await learnings.getHistory({ repositoryId: repository.id, learningId: "mem_1" })

    expect(history.outcomes).toEqual([
      expect.objectContaining({ id: "score_with_screenshot", reasoning: "", issue: null }),
    ])
    expect(history.outcomes[0]).not.toHaveProperty("after")
  })
})
