import { createHash } from "node:crypto"
import type { PrismaClient } from "../../../../../generated/prisma/client.ts"
import { z } from "zod"

import { createAgentEvaluationLimits } from "../../../../../domains/decision-model/create-agent-evaluation-limits/index.ts"
import { createDecisionModelStore } from "../../../../../domains/decision-model/create-decision-model-store/index.ts"
import { evaluatePrototypeWithDecisionModel } from "../../../../../domains/decision-model/evaluate-prototype-with-decision-model/index.ts"
import type { AgentLearningAuthority } from "../../../../../domains/decision-model/types.ts"
import type { DecisionRuntimeClient } from "../../../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"
import { reserveAuthenticationRateLimit } from "../../../../../repositories/authentication-rate-limits/reserve-authentication-rate-limit/index.ts"
import { completeDecisionAgentEvaluation } from "../../../../../repositories/decision-agent-evaluations/complete-decision-agent-evaluation/index.ts"
import { deleteDecisionAgentEvaluation } from "../../../../../repositories/decision-agent-evaluations/delete-decision-agent-evaluation/index.ts"
import { reserveDecisionAgentEvaluation } from "../../../../../repositories/decision-agent-evaluations/reserve-decision-agent-evaluation/index.ts"
import type { AgentVisualCriticRouteDependencies } from "../types.ts"

const resultSchema = z
  .object({
    evaluationId: z.uuid(),
    status: z.enum(["cached", "fresh"]),
    environment: z.enum(["fixture", "production"]),
    guidance: z.object({ available: z.boolean(), notice: z.string() }).strict(),
    context: z
      .object({
        repositoryId: z.uuid(),
        prototypeId: z.uuid().nullable(),
        buildId: z.uuid().nullable(),
        branch: z.string(),
        commitSha: z.string(),
      })
      .strict(),
    model: z
      .object({
        candidateId: z.uuid(),
        runtimeCandidateId: z.string(),
        promotionGeneration: z.number().int().nonnegative(),
      })
      .strict(),
    screenshotSetDigest: z.string(),
    findings: z.array(
      z
        .object({
          learning: z.object({ id: z.string(), text: z.string().nullable() }).strict(),
          route: z.string(),
          views: z.array(
            z
              .object({
                viewport: z.string(),
                theme: z.string(),
              })
              .strict(),
          ),
          followsProbability: z.number().min(0).max(1),
          breaksProbability: z.number().min(0).max(1),
          explanation: z.string(),
        })
        .strict(),
    ),
  })
  .strict()

export function createAgentVisualCriticRouteDependencies(options: {
  database: PrismaClient
  readLearningAuthority(input: {
    repositoryId: string
    actorMembershipId: string
  }): Promise<AgentLearningAuthority>
  runtimeForRepository(repositoryId: string): DecisionRuntimeClient
}): AgentVisualCriticRouteDependencies {
  const store = createDecisionModelStore(options.database)
  const limits = createAgentEvaluationLimits({
    reserve: async ({ limit, operation, subject }) =>
      (
        await reserveAuthenticationRateLimit(options.database, {
          auditFirstDenial: false,
          limit,
          operation,
          subjectDigest: createHash("sha256").update(subject).digest("hex"),
          windowSeconds: 60,
        })
      ).allowed,
  })
  return {
    evaluate: (input) => {
      const runtime = options.runtimeForRepository(input.authority.repositoryId)
      return evaluatePrototypeWithDecisionModel(input, {
        cache: {
          async reserve(reservation) {
            const result = await reserveDecisionAgentEvaluation(options.database, {
              ...reservation,
              ttlMs: 15 * 60 * 1_000,
            })
            return result.status === "cached"
              ? { status: "cached", result: resultSchema.parse(result.result) }
              : result
          },
          async complete(id, value) {
            await completeDecisionAgentEvaluation(options.database, {
              id,
              result: {
                ...value,
                findings: value.findings.map((finding) => ({
                  ...finding,
                  learning: { ...finding.learning, text: null },
                })),
              },
            })
          },
          async fail(id) {
            await deleteDecisionAgentEvaluation(options.database, id)
          },
        },
        limits,
        readLearningAuthority: ({ repositoryId }) =>
          options.readLearningAuthority({
            repositoryId,
            actorMembershipId: input.authority.actorMembershipId,
          }),
        async readRuntimeReadiness({ repositoryId }) {
          const [configuration, promotion] = await Promise.all([
            store.getConfiguration(repositoryId),
            runtime.getPromotion(),
          ])
          const recorded = await store.getPromotion(repositoryId)
          return {
            ready: Boolean(
              recorded &&
              promotion.candidateId === recorded.runtimeCandidateId &&
              promotion.generation === recorded.runtimeGeneration,
            ),
            environment: configuration?.backend === "fixture" ? "fixture" : "production",
          }
        },
        runtime,
        store,
      })
    },
  }
}
