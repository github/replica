import { http, HttpResponse } from "msw"
import { z } from "zod"

import { decisionModelOverviewResponseSchema } from "@application/hub/decision-model-contracts"
import type {
  DecisionCandidateResponse,
  DecisionModelConfigurationResponse,
  DecisionModelOverviewResponse,
  DecisionPromotionResponse,
  DecisionTrainingJobResponse,
} from "@application/hub/decision-model-contracts/types"

import type { MockFlowContext } from "../flow-context/types"
import { parseMockRecordIdentifier as recordIdentifier } from "../parse-mock-record-identifier"
import { readMockJson } from "../read-mock-json"
import { respondMock } from "../respond-mock"
import { MockStoreError } from "../store-error"

interface DecisionModelMockState {
  configuration: DecisionModelConfigurationResponse | null
  jobs: DecisionTrainingJobResponse[]
  candidates: DecisionCandidateResponse[]
  promotion: DecisionPromotionResponse | null
  previousCandidateId: string | null
  overview: Pick<
    DecisionModelOverviewResponse,
    "preflight" | "evaluationBuilds" | "evaluations" | "deletions"
  >
}

const tasksetDigest = `sha256:${"b".repeat(64)}`

export function createDecisionModelHandlers(context: MockFlowContext) {
  const states = new Map<string, DecisionModelMockState>()

  function api(path: string) {
    return new URL(`/api${path}`, context.origin).href
  }

  function requireAdministrator() {
    if (!context.session.read().capabilities.administerHub) {
      throw new MockStoreError(403, "Repository administrator access is required.")
    }
  }

  function state(repositoryId: string) {
    context.repositoryRecord(repositoryId)
    let current = states.get(repositoryId)
    if (!current) {
      current = initialState(repositoryId === context.resources.repositories[0]?.id)
      states.set(repositoryId, current)
    }
    return current
  }

  function overview(repositoryId: string) {
    const current = state(repositoryId)
    return decisionModelOverviewResponseSchema.parse({
      ...current.overview,
      configuration: current.configuration,
      jobs: current.jobs,
      candidates: current.candidates,
      promotion: current.promotion,
      promotionHistory: current.promotion
        ? [
            {
              candidateId: current.promotion.candidateId,
              runtimeCandidateId: current.promotion.runtimeCandidateId,
              previousCandidateId: current.previousCandidateId,
              previousRuntimeCandidateId:
                current.candidates.find((entry) => entry.id === current.previousCandidateId)
                  ?.runtimeCandidateId ?? null,
              generation: current.promotion.generation,
              operation: current.promotion.operation,
              membershipId: null,
              createdAt: "2026-11-11T19:00:00Z",
            },
          ]
        : [],
    })
  }

  return [
    http.get(api("/repositories/:repositoryId/decision-model"), ({ request, params }) =>
      respondMock(
        request,
        () => {
          requireAdministrator()
          return HttpResponse.json(overview(recordIdentifier(params.repositoryId)))
        },
        context.session,
      ),
    ),
    http.patch(api("/repositories/:repositoryId/decision-model"), ({ request, params }) =>
      respondMock(
        request,
        async (_scenario, assertCurrentSession) => {
          requireAdministrator()
          const current = state(recordIdentifier(params.repositoryId))
          const input = (await request.json()) as Omit<
            DecisionModelConfigurationResponse,
            "generation"
          >
          assertCurrentSession()
          current.configuration = {
            ...input,
            generation: (current.configuration?.generation ?? 0) + 1,
          }
          return HttpResponse.json(current.configuration)
        },
        context.session,
      ),
    ),
    http.post(
      api("/repositories/:repositoryId/decision-model/training-jobs"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            requireAdministrator()
            const current = state(recordIdentifier(params.repositoryId))
            const input = await readMockJson(
              request,
              z
                .object({
                  idempotencyKey: z.string().min(1),
                  expectedConfigurationGeneration: z.number().int().positive(),
                })
                .strict(),
            )
            if (current.configuration?.generation !== input.expectedConfigurationGeneration) {
              throw new MockStoreError(409, "The repository decision-model settings changed.")
            }
            assertCurrentSession()
            const job: DecisionTrainingJobResponse = {
              id: crypto.randomUUID(),
              state: "queued",
              tasksetDigest,
              runtimeJobId: null,
              candidateRuntimeId: null,
              failureCode: null,
              createdAt: new Date().toISOString(),
              finishedAt: null,
            }
            current.jobs.unshift(job)
            return HttpResponse.json({
              created: true,
              job: {
                id: job.id,
                state: job.state,
                runtimeJobId: null,
                candidateRuntimeId: null,
                failureCode: null,
                createdAt: job.createdAt,
              },
            })
          },
          context.session,
        ),
    ),
    http.post(
      api("/repositories/:repositoryId/decision-model/training-jobs/:jobId/cancel"),
      ({ request, params }) =>
        respondMock(
          request,
          (_scenario, assertCurrentSession) => {
            requireAdministrator()
            const current = state(recordIdentifier(params.repositoryId))
            const job = current.jobs.find((entry) => entry.id === params.jobId)
            if (!job) throw new MockStoreError(404, "Training job not found.")
            assertCurrentSession()
            job.state = "cancelled"
            job.finishedAt = new Date().toISOString()
            return HttpResponse.json({ ...job, state: "CANCELLED" })
          },
          context.session,
        ),
    ),
    http.post(
      api("/repositories/:repositoryId/decision-model/candidates/:candidateId/promotion"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            requireAdministrator()
            const current = state(recordIdentifier(params.repositoryId))
            const input = await readMockJson(
              request,
              z.object({ expectedGeneration: z.number().int().nonnegative() }).strict(),
            )
            const selected = current.candidates.find((entry) => entry.id === params.candidateId)
            if (!selected) throw new MockStoreError(404, "Decision candidate not found.")
            if ((current.promotion?.generation ?? 0) !== input.expectedGeneration) {
              throw new MockStoreError(
                409,
                "The promoted decision model changed. Refresh and try again.",
              )
            }
            assertCurrentSession()
            current.previousCandidateId = current.promotion?.candidateId ?? null
            current.promotion = {
              candidateId: selected.id,
              runtimeCandidateId: selected.runtimeCandidateId,
              generation: input.expectedGeneration + 1,
              operation: "promote",
              rollbackAvailable: Boolean(
                current.previousCandidateId &&
                !current.candidates.find((entry) => entry.id === current.previousCandidateId)
                  ?.rejection,
              ),
            }
            return HttpResponse.json({
              candidateId: current.promotion.candidateId,
              runtimeCandidateId: current.promotion.runtimeCandidateId,
              previousCandidateId: current.previousCandidateId,
              previousRuntimeCandidateId:
                current.candidates.find((entry) => entry.id === current.previousCandidateId)
                  ?.runtimeCandidateId ?? null,
              generation: current.promotion.generation,
            })
          },
          context.session,
        ),
    ),
    http.post(
      api("/repositories/:repositoryId/decision-model/candidates/:candidateId/rejection"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            requireAdministrator()
            const current = state(recordIdentifier(params.repositoryId))
            const input = await readMockJson(
              request,
              z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
            )
            const selected = current.candidates.find((entry) => entry.id === params.candidateId)
            if (!selected) throw new MockStoreError(404, "Decision candidate not found.")
            if (current.promotion?.candidateId === selected.id) {
              throw new MockStoreError(409, "The promoted candidate cannot be rejected.")
            }
            assertCurrentSession()
            selected.rejection = {
              rejectedAt: new Date().toISOString(),
              reason: input.reason,
              membershipId: null,
            }
            if (current.previousCandidateId === selected.id && current.promotion) {
              current.promotion.rollbackAvailable = false
            }
            return HttpResponse.json({
              candidateId: selected.id,
              rejectedAt: selected.rejection.rejectedAt,
            })
          },
          context.session,
        ),
    ),
    http.post(api("/repositories/:repositoryId/decision-model/rollback"), ({ request, params }) =>
      respondMock(
        request,
        async (_scenario, assertCurrentSession) => {
          requireAdministrator()
          const current = state(recordIdentifier(params.repositoryId))
          const body = (await request.json()) as { expectedGeneration?: number }
          if (!current.promotion || current.promotion.generation !== body.expectedGeneration) {
            throw new MockStoreError(
              409,
              "The promoted decision model changed. Refresh and try again.",
            )
          }
          const previous = current.candidates.find(
            (entry) => entry.id === current.previousCandidateId,
          )
          if (!previous || previous.rejection) {
            throw new MockStoreError(
              409,
              "The current decision model has no eligible previous candidate to restore.",
            )
          }
          assertCurrentSession()
          const replaced = current.promotion.candidateId
          current.promotion = {
            candidateId: previous.id,
            runtimeCandidateId: previous.runtimeCandidateId,
            generation: current.promotion.generation + 1,
            operation: "rollback",
            rollbackAvailable: true,
          }
          current.previousCandidateId = replaced
          return HttpResponse.json({
            candidateId: current.promotion.candidateId,
            runtimeCandidateId: current.promotion.runtimeCandidateId,
            previousCandidateId: current.previousCandidateId,
            previousRuntimeCandidateId:
              current.candidates.find((entry) => entry.id === current.previousCandidateId)
                ?.runtimeCandidateId ?? null,
            generation: current.promotion.generation,
          })
        },
        context.session,
      ),
    ),
    http.post(
      api("/repositories/:repositoryId/decision-model/builds/:buildId/evaluation"),
      ({ request, params }) =>
        respondMock(
          request,
          (_scenario, assertCurrentSession) => {
            requireAdministrator()
            const current = state(recordIdentifier(params.repositoryId))
            const build = current.overview.evaluationBuilds.find(
              (entry) => entry.id === params.buildId,
            )
            if (!build) throw new MockStoreError(404, "Published Build not found.")
            if (!current.promotion) {
              throw new MockStoreError(
                409,
                "No decision candidate is promoted for this repository.",
              )
            }
            assertCurrentSession()
            const evaluation = {
              id: crypto.randomUUID(),
              build: {
                id: build.id,
                number: build.number,
                prototypeId: build.prototype.id,
              },
              model: {
                id: current.promotion.candidateId,
                runtimeCandidateId: current.promotion.runtimeCandidateId,
                generation: current.promotion.generation,
              },
              questionDigest: `sha256:${"4".repeat(64)}`,
              screenshotSetDigest: `sha256:${"5".repeat(64)}`,
              responseDigest: `sha256:${"6".repeat(64)}`,
              findingsAvailable: true,
              findings: [
                {
                  learning: {
                    id: "mem_1d9f0c2b7a4e5f6a8b9c0d1e",
                    text: "Use one primary button per form.",
                  },
                  route: "/settings/profile",
                  views: [
                    { viewport: "desktop", theme: "dark" },
                    { viewport: "narrow", theme: "light" },
                  ],
                  followsProbability: 0.82,
                  breaksProbability: 0.18,
                  explanation:
                    "The promoted model found the Build more likely to follow this learning.",
                },
              ],
              createdAt: new Date().toISOString(),
            }
            current.overview.evaluations.unshift(evaluation)
            return HttpResponse.json({ id: evaluation.id })
          },
          context.session,
        ),
    ),
  ]
}

function initialState(populated: boolean): DecisionModelMockState {
  const baseline: DecisionCandidateResponse = {
    id: "11111111-2222-4333-8444-555555555555",
    runtimeCandidateId: "fixture-candidate-1",
    backend: "fixture",
    tasksetDigest,
    productionEligible: true,
    baselineMeanReward: "0.5",
    candidateMeanReward: "0.62",
    meanRewardDelta: "0.12",
    baselineCalibrationError: "0.2",
    candidateCalibrationError: "0.18",
    calibrationErrorDelta: "-0.02",
    learningMetrics: [],
    durationSeconds: 240,
    usage: [],
    rejection: null,
    createdAt: "2026-11-10T18:04:30Z",
  }
  const candidate: DecisionCandidateResponse = {
    id: "22222222-3333-4444-8555-666666666666",
    runtimeCandidateId: "fixture-candidate-2",
    backend: "fixture",
    tasksetDigest,
    productionEligible: true,
    baselineMeanReward: "0.55",
    candidateMeanReward: "0.73",
    meanRewardDelta: "0.18",
    baselineCalibrationError: "0.2",
    candidateCalibrationError: "0.17",
    calibrationErrorDelta: "-0.03",
    learningMetrics: [
      {
        learningId: "mem_1d9f0c2b7a4e5f6a8b9c0d1e",
        baselineBalancedAccuracy: 0.5,
        candidateBalancedAccuracy: 0.75,
        delta: 0.25,
        direction: "gain",
      },
    ],
    durationSeconds: 270,
    usage: [
      {
        connector: "fixture-runtime",
        kind: "training_credits",
        quantity: 3.5,
        unit: "credits",
        cost: 1.25,
        currency: "USD",
        source: "fixture",
        metadata: {},
      },
    ],
    rejection: null,
    createdAt: "2026-11-11T18:04:30Z",
  }
  return {
    configuration: populated
      ? {
          enabled: true,
          generation: 1,
          backend: "fixture",
          maxUpdates: 8,
          maxSeconds: 300,
          monthlyBudgetCredits: "10",
        }
      : null,
    jobs: populated
      ? [
          {
            id: "33333333-4444-4555-8666-777777777777",
            state: "succeeded",
            tasksetDigest,
            runtimeJobId: "fixture-job-1",
            candidateRuntimeId: candidate.runtimeCandidateId,
            failureCode: null,
            createdAt: "2026-11-11T18:00:00Z",
            finishedAt: "2026-11-11T18:04:30Z",
          },
        ]
      : [],
    candidates: populated ? [candidate, baseline] : [],
    promotion: populated
      ? {
          candidateId: baseline.id,
          runtimeCandidateId: baseline.runtimeCandidateId,
          generation: 1,
          operation: "promote",
          rollbackAvailable: false,
        }
      : null,
    previousCandidateId: null,
    overview: {
      preflight: {
        state: populated ? "ready" : "blocked",
        counts: {
          prototypes: populated ? 3 : 0,
          builds: populated ? 8 : 0,
          pages: populated ? 12 : 0,
          screenshots: populated ? 48 : 0,
          questions: populated ? 6 : 0,
          samples: populated ? 96 : 0,
          tasks: populated ? 96 : 0,
          train: populated ? 64 : 0,
          dev: populated ? 16 : 0,
          test: populated ? 16 : 0,
          follows: populated ? 55 : 0,
          breaks: populated ? 41 : 0,
        },
        warnings: [],
        reasons: populated ? [] : [{ code: "no-eligible-prototypes", count: 1 }],
        digests: {
          export: populated ? `sha256:${"1".repeat(64)}` : null,
          reviewSnapshot: `sha256:${"2".repeat(64)}`,
          buildSet: `sha256:${"3".repeat(64)}`,
          questionSet: populated ? `sha256:${"4".repeat(64)}` : null,
          taskset: populated ? tasksetDigest : null,
        },
      },
      evaluationBuilds: populated
        ? [
            {
              id: "88888888-8888-4888-8888-888888888888",
              number: 3,
              prototype: {
                id: "1",
                name: "Settings",
                branchName: "settings",
              },
            },
          ]
        : [],
      evaluations: populated
        ? [
            {
              id: "77777777-7777-4777-8777-777777777777",
              build: {
                id: "88888888-8888-4888-8888-888888888888",
                number: 3,
                prototypeId: "1",
              },
              model: {
                id: baseline.id,
                runtimeCandidateId: baseline.runtimeCandidateId,
                generation: 1,
              },
              questionDigest: `sha256:${"4".repeat(64)}`,
              screenshotSetDigest: `sha256:${"5".repeat(64)}`,
              responseDigest: `sha256:${"6".repeat(64)}`,
              findingsAvailable: true,
              findings: [
                {
                  learning: {
                    id: "mem_1d9f0c2b7a4e5f6a8b9c0d1e",
                    text: "Use one primary button per form.",
                  },
                  route: "/settings/profile",
                  views: [
                    { viewport: "desktop", theme: "dark" },
                    { viewport: "narrow", theme: "light" },
                  ],
                  followsProbability: 0.82,
                  breaksProbability: 0.18,
                  explanation:
                    "The promoted model found the Build more likely to follow this learning.",
                },
              ],
              createdAt: "2026-11-12T20:00:00Z",
            },
          ]
        : [],
      deletions: [],
    },
  }
}
