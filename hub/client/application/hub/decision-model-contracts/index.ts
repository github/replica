import { z } from "zod"

import { recordIdentifierSchema } from "@application/hub/contracts"
import type {
  DecisionCandidateRejectionMutationResponse,
  DecisionCandidateResponse,
  DecisionModelConfigurationResponse,
  DecisionModelOverviewResponse,
  DecisionPromotionMutationResponse,
  DecisionPromotionResponse,
  DecisionTrainingJobResponse,
  DecisionTrainingMutationResponse,
  DecisionTrainingRequestResponse,
} from "./types"

const identifier = z.uuid()
const count = z.number().int().nonnegative()
const credits = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const signedDecimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const timestamp = z.iso.datetime({ offset: true })
const trainingState = z.enum([
  "queued",
  "submitting",
  "cancel_requested",
  "submitted",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])

export const decisionModelConfigurationResponseSchema = z
  .object({
    enabled: z.boolean(),
    generation: count,
    backend: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/),
    maxUpdates: z.number().int().min(1).max(100_000),
    maxSeconds: z.number().int().min(1).max(86_400),
    monthlyBudgetCredits: credits,
  })
  .strict() satisfies z.ZodType<DecisionModelConfigurationResponse>

const decisionTrainingJobResponseSchema = z
  .object({
    id: identifier,
    state: trainingState,
    tasksetDigest: digest,
    runtimeJobId: z.string().min(1).nullable(),
    candidateRuntimeId: z.string().min(1).nullable(),
    failureCode: z.string().min(1).nullable(),
    createdAt: timestamp,
    finishedAt: timestamp.nullable(),
  })
  .strict() satisfies z.ZodType<DecisionTrainingJobResponse>

const decisionCandidateResponseSchema = z
  .object({
    id: identifier,
    runtimeCandidateId: z.string().min(1),
    tasksetDigest: digest,
    productionEligible: z.boolean(),
    baselineMeanReward: signedDecimal.nullable(),
    candidateMeanReward: signedDecimal.nullable(),
    meanRewardDelta: signedDecimal.nullable(),
    baselineCalibrationError: signedDecimal.nullable(),
    candidateCalibrationError: signedDecimal.nullable(),
    calibrationErrorDelta: signedDecimal.nullable(),
    learningMetrics: z.array(
      z
        .object({
          learningId: z.string().min(1),
          baselineBalancedAccuracy: z.number().nullable(),
          candidateBalancedAccuracy: z.number().nullable(),
          delta: z.number().nullable(),
          direction: z.enum(["gain", "regression", "unchanged", "unknown"]),
        })
        .strict(),
    ),
    durationSeconds: z.number().nonnegative().nullable(),
    usage: z.array(
      z
        .object({
          connector: z.string().min(1),
          kind: z.string().min(1),
          quantity: z.number().nonnegative(),
          unit: z.string().min(1),
          cost: z.number().nonnegative().nullable(),
          currency: z.string().min(1).nullable(),
          source: z.string().min(1),
          metadata: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
    rejection: z
      .object({
        rejectedAt: timestamp,
        reason: z.string().nullable(),
        membershipId: identifier.nullable(),
      })
      .strict()
      .nullable(),
    createdAt: timestamp,
  })
  .strict() satisfies z.ZodType<DecisionCandidateResponse>

const decisionPromotionResponseSchema = z
  .object({
    candidateId: identifier,
    runtimeCandidateId: z.string().min(1),
    generation: count,
    operation: z.enum(["promote", "rollback"]),
    rollbackAvailable: z.boolean(),
  })
  .strict() satisfies z.ZodType<DecisionPromotionResponse>

export const decisionModelOverviewResponseSchema = z
  .object({
    preflight: z
      .object({
        state: z.enum(["ready", "blocked"]),
        counts: z
          .object({
            prototypes: count,
            builds: count,
            pages: count,
            screenshots: count,
            questions: count,
            samples: count,
            tasks: count,
            train: count,
            dev: count,
            test: count,
            follows: count,
            breaks: count,
          })
          .strict(),
        warnings: z.array(
          z
            .object({
              code: z.string().min(1),
              message: z.string().min(1),
              count: count.optional(),
            })
            .strict(),
        ),
        reasons: z.array(z.object({ code: z.string().min(1), count }).strict()),
        digests: z
          .object({
            export: digest.nullable(),
            reviewSnapshot: digest,
            buildSet: digest,
            questionSet: digest.nullable(),
            taskset: digest.nullable(),
          })
          .strict(),
      })
      .strict(),
    configuration: decisionModelConfigurationResponseSchema.nullable(),
    jobs: z.array(decisionTrainingJobResponseSchema).max(20),
    candidates: z.array(decisionCandidateResponseSchema).max(20),
    promotion: decisionPromotionResponseSchema.nullable(),
    promotionHistory: z.array(
      z
        .object({
          candidateId: identifier,
          runtimeCandidateId: z.string().min(1),
          previousCandidateId: identifier.nullable(),
          previousRuntimeCandidateId: z.string().min(1).nullable(),
          generation: count,
          operation: z.enum(["promote", "rollback"]),
          membershipId: identifier.nullable(),
          createdAt: timestamp,
        })
        .strict(),
    ),
    evaluations: z.array(
      z
        .object({
          id: identifier,
          build: z
            .object({
              id: identifier,
              number: z.number().int().positive(),
              prototypeId: recordIdentifierSchema,
            })
            .strict(),
          model: z
            .object({
              id: identifier,
              runtimeCandidateId: z.string().min(1),
              generation: count,
            })
            .strict(),
          questionDigest: digest,
          screenshotSetDigest: digest,
          responseDigest: digest,
          findingsAvailable: z.boolean(),
          findings: z.array(
            z
              .object({
                learning: z.object({ id: z.string().min(1), text: z.string().nullable() }).strict(),
                route: z.string().min(1),
                views: z.array(
                  z.object({ viewport: z.string().min(1), theme: z.string().min(1) }).strict(),
                ),
                followsProbability: z.number().min(0).max(1),
                breaksProbability: z.number().min(0).max(1),
                explanation: z.string().min(1),
              })
              .strict(),
          ),
          createdAt: timestamp,
        })
        .strict(),
    ),
    deletions: z.array(
      z
        .object({
          id: identifier,
          state: z.enum(["pending", "completed", "failed"]),
          selectors: z
            .object({
              exportId: z.string().nullable(),
              grantId: z.string().nullable(),
              evidenceDigest: digest.nullable(),
              tasksetDigest: digest.nullable(),
            })
            .strict(),
          pending: count,
          failures: count,
          revokedAt: timestamp.nullable(),
          completedAt: timestamp.nullable(),
          failureCode: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict() satisfies z.ZodType<DecisionModelOverviewResponse>

export const decisionTrainingRequestResponseSchema = z
  .object({
    created: z.boolean(),
    job: z
      .object({
        id: identifier,
        state: trainingState,
        runtimeJobId: z.string().nullable(),
        candidateRuntimeId: z.string().nullable(),
        failureCode: z.string().nullable(),
        createdAt: timestamp,
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<DecisionTrainingRequestResponse>

export const decisionTrainingMutationResponseSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object") return input
    const record = input as Record<string, unknown>
    return {
      ...record,
      state: typeof record.state === "string" ? record.state.toLowerCase() : record.state,
    }
  },
  z.object({ id: identifier, state: trainingState }).loose(),
) satisfies z.ZodType<DecisionTrainingMutationResponse>

export const decisionPromotionMutationResponseSchema = z
  .object({
    candidateId: identifier,
    runtimeCandidateId: z.string().min(1),
    previousCandidateId: identifier.nullable(),
    previousRuntimeCandidateId: z.string().min(1).nullable(),
    runtimeGeneration: count,
  })
  .strict() satisfies z.ZodType<DecisionPromotionMutationResponse>

export const decisionCandidateRejectionMutationResponseSchema = z
  .object({ candidateId: identifier, rejectedAt: timestamp })
  .loose() satisfies z.ZodType<DecisionCandidateRejectionMutationResponse>
