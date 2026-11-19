import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { getDecisionModelOverview } from "."

const digest = `sha256:${"a".repeat(64)}`

async function createEvaluation(
  repositoryName: string,
  input: { generation: bigint; createdAt: Date; runtimeCandidateId: string },
) {
  const repository = await prisma.repository.create({
    data: { nameWithOwner: `team/${repositoryName}`, defaultBranch: "main" },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      branchName: "prototype",
      name: "Prototype",
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 1,
      state: "successful",
      startedAt: new Date("2026-11-02T00:00:00.000Z"),
      finishedAt: new Date("2026-11-02T00:01:00.000Z"),
    },
  })
  const trainingJob = await prisma.decisionTrainingJob.create({
    data: {
      repositoryId: repository.id,
      idempotencyKey: `training-${input.runtimeCandidateId}`,
      configurationGeneration: 1,
      state: "SUCCEEDED",
      backend: "fixture",
      maxUpdates: 8,
      maxSeconds: 300,
      budgetCredits: "10",
      consentGrantId: "grant-1",
      exportDigest: digest,
      repeatableReviewSnapshotDigest: digest,
      questionDigest: digest,
      buildSetDigest: digest,
      tasksetDigest: digest,
    },
  })
  const candidate = await prisma.decisionCandidate.create({
    data: {
      repositoryId: repository.id,
      trainingJobId: trainingJob.id,
      runtimeCandidateId: input.runtimeCandidateId,
      tasksetDigest: digest,
      manifestDigest: digest,
      evaluationDigest: digest,
      productionEligible: true,
    },
  })
  const evaluation = await prisma.decisionBuildEvaluation.create({
    data: {
      repositoryId: repository.id,
      buildId: build.id,
      candidateId: candidate.id,
      runtimeEvaluationId: `evaluation-${input.runtimeCandidateId}`,
      promotionGeneration: input.generation,
      questionDigest: digest,
      screenshotSetDigest: digest,
      responseDigest: digest,
      summary: {
        findings: [
          {
            learningId: "mem_111111111111111111111111",
            views: [
              {
                route: "/",
                viewport: { width: 1440, height: 900 },
                theme: "light",
              },
            ],
            followsProbability: 0.8,
            breaksProbability: 0.2,
            explanation:
              "Across the submitted captured views, the promoted decision model found the Build at least as likely to follow the learning as break it.",
          },
        ],
      },
      createdAt: input.createdAt,
    },
  })
  return { repository, build, candidate, evaluation }
}

describe("getDecisionModelOverview()", () => {
  it("returns recent completed Build evaluations with candidate and generation only for the repository", async () => {
    const selected = await createEvaluation("selected-evaluations", {
      generation: 7n,
      createdAt: new Date("2026-11-18T12:00:00.000Z"),
      runtimeCandidateId: "runtime-candidate-selected",
    })
    const other = await createEvaluation("other-evaluations", {
      generation: 99n,
      createdAt: new Date("2026-11-18T13:00:00.000Z"),
      runtimeCandidateId: "runtime-candidate-other",
    })

    const overview = await getDecisionModelOverview(prisma, selected.repository.id)

    expect(overview).toMatchObject({
      evaluations: [
        {
          id: selected.evaluation.id,
          buildId: selected.build.id,
          candidateId: selected.candidate.id,
          promotionGeneration: 7n,
          createdAt: new Date("2026-11-18T12:00:00.000Z"),
          candidate: {
            id: selected.candidate.id,
            runtimeCandidateId: "runtime-candidate-selected",
          },
          summary: selected.evaluation.summary,
        },
      ],
    })
    expect(overview.evaluations.some((evaluation) => evaluation.id === other.evaluation.id)).toBe(
      false,
    )
    expect(
      overview.evaluations.some(
        (evaluation) => evaluation.candidate.runtimeCandidateId === "runtime-candidate-other",
      ),
    ).toBe(false)
  })
})
