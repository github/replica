import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { getDecisionModelOverview } from "."

const digest = `sha256:${"a".repeat(64)}`
const screenshotPaths = [
  "screenshots/desktop.png",
  "screenshots/desktop-dark.png",
  "screenshots/narrow.png",
  "screenshots/narrow-dark.png",
] as const

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
      trainingExportId: "export-1",
      evidenceDigest: digest,
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
            learning: { id: "mem_111111111111111111111111" },
            route: "/",
            views: [{ viewport: "desktop", theme: "light" }],
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

async function createEvaluationBuildFixture(
  repositoryId: string,
  input: {
    branchDeletedAt?: Date
    finishedAt: Date | null
    name: string
    number: number
    screenshotPaths?: readonly string[]
    state?: "failed" | "running" | "successful"
  },
) {
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId,
      branchName: `prototype/${input.name}`,
      branchDeletedAt: input.branchDeletedAt,
      name: input.name,
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: input.number,
      state: input.state ?? "successful",
      startedAt: new Date("2026-11-02T00:00:00.000Z"),
      finishedAt: input.finishedAt,
      ...(input.state === "failed" ? { failureSummary: "Build failed." } : {}),
    },
  })
  await prisma.buildArtifact.createMany({
    data: (input.screenshotPaths ?? screenshotPaths).map((path, index) => ({
      buildId: build.id,
      kind: "screenshot",
      path,
      storageKey: `${build.id}-${index}`,
      byteLength: 1,
    })),
  })
  return build
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

  it("returns at most the 50 newest complete four-view Builds and excludes ineligible Builds", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/evaluation-builds", defaultBranch: "main" },
    })
    const eligible = []
    for (let index = 0; index < 52; index += 1) {
      eligible.push(
        await createEvaluationBuildFixture(repository.id, {
          finishedAt: new Date(Date.UTC(2026, 10, 10, 0, index)),
          name: `eligible-${index + 1}`,
          number: index + 1,
        }),
      )
    }
    const failed = await createEvaluationBuildFixture(repository.id, {
      finishedAt: new Date("2026-11-20T05:00:00.000Z"),
      name: "failed",
      number: 100,
      state: "failed",
    })
    const unfinished = await createEvaluationBuildFixture(repository.id, {
      finishedAt: null,
      name: "unfinished",
      number: 101,
      state: "running",
    })
    const noScreenshot = await createEvaluationBuildFixture(repository.id, {
      finishedAt: new Date("2026-11-20T06:00:00.000Z"),
      name: "no-screenshot",
      number: 102,
      screenshotPaths: [],
    })
    const incompleteCoverage = await createEvaluationBuildFixture(repository.id, {
      finishedAt: new Date("2026-11-20T07:00:00.000Z"),
      name: "incomplete-coverage",
      number: 103,
      screenshotPaths: screenshotPaths.slice(0, 3),
    })
    const deletedBranch = await createEvaluationBuildFixture(repository.id, {
      branchDeletedAt: new Date("2026-11-19T00:00:00.000Z"),
      finishedAt: new Date("2026-11-20T08:00:00.000Z"),
      name: "deleted-branch",
      number: 104,
    })
    const otherRepository = await prisma.repository.create({
      data: { nameWithOwner: "team/other-evaluation-builds", defaultBranch: "main" },
    })
    const other = await createEvaluationBuildFixture(otherRepository.id, {
      finishedAt: new Date("2026-11-20T09:00:00.000Z"),
      name: "other-repository",
      number: 1,
    })

    const overview = await getDecisionModelOverview(prisma, repository.id)

    expect(overview.evaluationBuilds.map(({ id }) => id)).toEqual(
      eligible
        .slice(2)
        .reverse()
        .map(({ id }) => id),
    )
    expect(overview.evaluationBuilds).toHaveLength(50)
    expect(overview.evaluationBuilds.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([
        failed.id,
        unfinished.id,
        noScreenshot.id,
        incompleteCoverage.id,
        deletedBranch.id,
        other.id,
      ]),
    )
  })

  it("does not offer Builds from a removed repository for evaluation", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/removed-evaluation-builds", defaultBranch: "main" },
    })
    await createEvaluationBuildFixture(repository.id, {
      finishedAt: new Date("2026-11-20T10:00:00.000Z"),
      name: "removed-repository",
      number: 1,
    })
    await prisma.repository.update({
      where: { id: repository.id },
      data: { removedAt: new Date("2026-11-20T11:00:00.000Z") },
    })

    const overview = await getDecisionModelOverview(prisma, repository.id)

    expect(overview.evaluationBuilds).toEqual([])
  })
})
