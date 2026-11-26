import { z } from "zod"

import { recordIdentifierSchema, repositorySchema } from "@application/hub/contracts"

import type {
  AcceptedLearningResponse,
  LearningActivityDayResponse,
  LearningDecisionInput,
  LearningEvidenceResponse,
  LearningHistoryResponse,
  LearningMutationResponse,
  LearningRunResponse,
  LearningShareInput,
  LearningSuggestionResponse,
  LearningsResponse,
  RejectedLearningResponse,
  SharedLearningResponse,
} from "./types"

const identifier = z.number().int().positive()
const count = z.number().int().nonnegative()
const timestamp = z.iso.datetime({ offset: true })
const credits = z.string().regex(/^\d+(?:\.\d+)?$/)
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const learningIdentifier = z
  .string()
  .regex(/^[a-z0-9._~-]+$/i)
  .refine((value) => value !== "." && value !== "..")

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

// The package owns stored titles, so responses accept any title it returns. Only
// titles people type are held to Hub's stricter rule.
const storedTitle = z.string().nullable()
const titleInput = z.string().trim().min(1).max(120)

export const learningSuggestionResponseSchema = z
  .object({
    id: learningIdentifier,
    title: storedTitle,
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
    title: storedTitle,
    content: z.string().nullable(),
    digest: digest.nullable(),
    acceptedBy: z.string().nullable(),
    acceptedAt: timestamp.nullable(),
    edited: z.boolean(),
    lastDecision: z.enum(["accepted", "edited", "reinstated"]),
    status: z.enum(["recalled", "not-recalled", "budget-excluded", "damaged", "identity-review"]),
    shared: z.boolean(),
  })
  .strict() satisfies z.ZodType<AcceptedLearningResponse>

export const sharedLearningResponseSchema = z
  .object({
    id: learningIdentifier,
    title: storedTitle,
    content: z.string().nullable(),
    source: z.string().min(1),
    sharedBy: z.string().nullable(),
    sharedAt: timestamp,
    status: z.enum(["recalled", "budget-excluded"]),
  })
  .strict() satisfies z.ZodType<SharedLearningResponse>

export const rejectedLearningResponseSchema = z
  .object({
    id: learningIdentifier,
    title: storedTitle,
    content: z.string().nullable(),
    digest: digest.nullable(),
    state: z.enum(["rejected", "retired"]),
    decidedBy: z.string().nullable(),
    decidedAt: timestamp.nullable(),
    reason: z.string().nullable(),
    shared: z.boolean(),
  })
  .strict() satisfies z.ZodType<RejectedLearningResponse>

export const learningHistoryResponseSchema = z
  .object({
    decisions: z.array(
      z
        .object({
          version: identifier,
          state: z.enum(["proposed", "accepted", "rejected", "retired"]),
          change: z.enum(["proposed", "accepted", "edited", "reinstated", "rejected", "retired"]),
          by: z.string().nullable(),
          at: timestamp.nullable(),
          reason: z.string().nullable(),
        })
        .strict(),
    ),
    evidence: z.array(learningEvidenceResponseSchema),
    otherEvidenceCount: count,
    contradictions: z.array(learningEvidenceResponseSchema),
    otherContradictionsCount: count,
  })
  .strict() satisfies z.ZodType<LearningHistoryResponse>

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

const learningActivityDayResponseSchema = z
  .object({
    date: z.iso.date(),
    runState: z.enum(["succeeded", "failed"]),
    startedAt: timestamp,
    startedBy: learningRunResponseSchema.shape.startedBy,
    commentsAnalyzed: count,
    commentsTagged: count,
    suggestions: count,
  })
  .strict() satisfies z.ZodType<LearningActivityDayResponse>

export const learningsResponseSchema = z.discriminatedUnion("accessDenied", [
  z
    .object({
      accessDenied: z.literal(true),
      repository: repositorySchema,
      capabilities: z
        .object({
          administerHub: z.boolean(),
          administerRepository: z.literal(false),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      accessDenied: z.literal(false),
      repository: repositorySchema,
      capabilities: z
        .object({
          administerHub: z.boolean(),
          administerRepository: z.boolean(),
        })
        .strict(),
      permissions: z
        .object({
          viewEvidence: z.boolean(),
          decide: z.boolean(),
          requestRun: z.boolean(),
          share: z.boolean(),
        })
        .strict(),
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
      automaticRunsEnabled: z.boolean(),
      usageCredits: credits.nullable(),
      runAvailable: z.boolean(),
      loadError: z.string().min(1).nullable(),
      identityReviewCount: count,
      suggestions: z.array(learningSuggestionResponseSchema),
      learnings: z.array(acceptedLearningResponseSchema),
      rejected: z.array(rejectedLearningResponseSchema),
      shared: z.array(sharedLearningResponseSchema),
      recall: z.object({ text: z.string(), count }).strict(),
      runs: z.array(learningRunResponseSchema).max(10),
      activity: z.array(learningActivityDayResponseSchema).max(366),
      today: z.iso.date(),
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
  z
    .object({
      decision: z.literal("edit"),
      digest,
      title: titleInput.optional(),
      content: z.string().trim().min(1).max(2000).optional(),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      decision: z.literal("reinstate"),
      digest,
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]) satisfies z.ZodType<LearningDecisionInput>

export const learningShareInputSchema = z
  .object({ shared: z.boolean() })
  .strict() satisfies z.ZodType<LearningShareInput>

export const learningMutationResponseSchema = z
  .object({ notice: z.string().min(1) })
  .strict() satisfies z.ZodType<LearningMutationResponse>
