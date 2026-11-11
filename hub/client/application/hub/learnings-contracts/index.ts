import { z } from "zod"

import { recordIdentifierSchema, repositorySchema } from "@application/hub/contracts"

import type {
  AcceptedLearningResponse,
  LearningDecisionInput,
  LearningEvidenceResponse,
  LearningMutationResponse,
  LearningRunResponse,
  LearningSuggestionResponse,
  LearningsResponse,
} from "./types"

const identifier = z.number().int().positive()
const count = z.number().int().nonnegative()
const timestamp = z.iso.datetime({ offset: true })
const credits = z.string().regex(/^\d+(?:\.\d+)?$/)
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const learningIdentifier = z.string().regex(/^[a-z0-9._~-]+$/i)

export const learningEvidenceResponseSchema = z
  .object({
    eventId: z.string().min(1),
    commentId: identifier,
    body: z.string().nullable(),
    authorLogin: z.string().min(1),
    authorAvatarUrl: z.url().nullable(),
    prototypeId: recordIdentifierSchema,
    prototypeName: z.string().min(1),
    createdAt: timestamp,
  })
  .strict() satisfies z.ZodType<LearningEvidenceResponse>

export const learningSuggestionResponseSchema = z
  .object({
    id: learningIdentifier,
    content: z.string().trim().min(1).max(2000),
    reviewDigest: digest,
    support: z.object({ reviewers: count, prototypes: count }).strict().nullable(),
    replaces: z.array(
      z.object({ id: learningIdentifier, content: z.string().nullable() }).strict(),
    ),
    evidence: z.array(learningEvidenceResponseSchema),
    otherEvidenceCount: count,
    contradictions: z.array(learningEvidenceResponseSchema),
    otherContradictionsCount: count,
  })
  .strict() satisfies z.ZodType<LearningSuggestionResponse>

export const acceptedLearningResponseSchema = z
  .object({
    id: learningIdentifier,
    content: z.string().nullable(),
    acceptedBy: z.string().nullable(),
    acceptedAt: timestamp.nullable(),
    edited: z.boolean(),
    status: z.enum(["recalled", "not-recalled", "budget-excluded", "damaged", "identity-review"]),
  })
  .strict() satisfies z.ZodType<AcceptedLearningResponse>

const learningRunResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("succeeded"),
      commentsConsidered: count,
      commentsLabeled: count,
      commentsRemaining: count,
      suggestions: count,
      suggestionsRemaining: count,
    })
    .strict(),
  z.object({ type: z.literal("failed"), summary: z.string().min(1) }).strict(),
])

export const learningRunResponseSchema = z
  .object({
    id: identifier,
    startedAt: timestamp,
    startedBy: z.discriminatedUnion("type", [
      z.object({ type: z.literal("daily") }).strict(),
      z.object({ type: z.literal("user"), login: z.string().min(1) }).strict(),
      z.object({ type: z.literal("unknown") }).strict(),
    ]),
    state: z.enum(["queued", "running", "succeeded", "failed"]),
    result: learningRunResultSchema.nullable(),
    usage: z.object({ credits, requests: identifier }).strict().nullable(),
  })
  .strict() satisfies z.ZodType<LearningRunResponse>

export const learningsResponseSchema = z.discriminatedUnion("accessDenied", [
  z
    .object({
      accessDenied: z.literal(true),
      repository: repositorySchema,
      canAdministerHub: z.boolean(),
    })
    .strict(),
  z
    .object({
      accessDenied: z.literal(false),
      repository: repositorySchema,
      canAdministerHub: z.boolean(),
      permissions: z.object({ decide: z.boolean(), requestRun: z.boolean() }).strict(),
      copilot: z.discriminatedUnion("state", [
        z
          .object({
            state: z.literal("connected"),
            connectedBy: z.string().nullable(),
          })
          .strict(),
        z.object({ state: z.literal("not-connected") }).strict(),
        z
          .object({
            state: z.literal("refused"),
            refusedAt: timestamp.nullable(),
          })
          .strict(),
      ]),
      usageCredits: credits,
      runAvailable: z.boolean(),
      loadError: z.string().min(1).nullable(),
      identityReviewCount: count,
      suggestions: z.array(learningSuggestionResponseSchema),
      learnings: z.array(acceptedLearningResponseSchema),
      recall: z.object({ text: z.string(), count }).strict(),
      runs: z.array(learningRunResponseSchema).max(10),
    })
    .strict(),
]) satisfies z.ZodType<LearningsResponse>

export const learningDecisionInputSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("accept"),
      digest,
      content: z.string().trim().min(1).max(2000).optional(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      digest,
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      decision: z.literal("retire"),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]) satisfies z.ZodType<LearningDecisionInput>

export const learningMutationResponseSchema = z
  .object({ notice: z.string().min(1) })
  .strict() satisfies z.ZodType<LearningMutationResponse>
