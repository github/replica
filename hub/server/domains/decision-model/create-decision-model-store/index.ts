import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

import { saveDecisionBuildEvaluation } from "../../../repositories/decision-build-evaluations/save-decision-build-evaluation/index.ts"
import { getDecisionCandidate } from "../../../repositories/decision-candidates/get-decision-candidate/index.ts"
import { saveDecisionCandidate } from "../../../repositories/decision-candidates/save-decision-candidate/index.ts"
import { rejectDecisionCandidate } from "../../../repositories/decision-candidates/reject-decision-candidate/index.ts"
import { getDecisionModelConfiguration } from "../../../repositories/decision-model-configurations/get-decision-model-configuration/index.ts"
import { getDecisionModelPromotion } from "../../../repositories/decision-model-promotions/get-decision-model-promotion/index.ts"
import { saveDecisionModelPromotion } from "../../../repositories/decision-model-promotions/save-decision-model-promotion/index.ts"
import { createOrGetDecisionTrainingJob } from "../../../repositories/decision-training-jobs/create-or-get-decision-training-job/index.ts"
import { getDecisionTrainingJob } from "../../../repositories/decision-training-jobs/get-decision-training-job/index.ts"
import { sumDecisionTrainingUsage } from "../../../repositories/decision-training-jobs/sum-decision-training-usage/index.ts"
import { updateDecisionTrainingJob } from "../../../repositories/decision-training-jobs/update-decision-training-job/index.ts"
import { requestDecisionTrainingCancellation } from "../../../repositories/decision-training-jobs/request-decision-training-cancellation/index.ts"
import { markDecisionTrainingSubmitting } from "../../../repositories/decision-training-jobs/mark-decision-training-submitting/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockRepositoryAdministratorAuthority } from "../../../repositories/repository-access/lock-repository-administrator-authority/index.ts"
import { DecisionModelError } from "../errors.ts"
import type { DecisionModelStore, DecisionTrainingJobRecord } from "../types.ts"

const activeStates = ["QUEUED", "SUBMITTING", "CANCEL_REQUESTED", "SUBMITTED", "RUNNING"] as const

function decimalUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".")
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"))
}

function decimalString(value: bigint): string {
  const whole = value / 1_000_000_000n
  const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function jobRecord(
  job: Awaited<ReturnType<typeof getDecisionTrainingJob>> extends infer Result
    ? NonNullable<Result>
    : never,
): DecisionTrainingJobRecord {
  return {
    id: job.id,
    repositoryId: job.repositoryId,
    requestedByMembershipId: job.requestedByMembershipId,
    idempotencyKey: job.idempotencyKey,
    runtimeJobId: job.runtimeJobId,
    runtimeTasksetId: job.runtimeTasksetId,
    configurationGeneration: job.configurationGeneration,
    state: job.state,
    backend: job.backend,
    maxUpdates: job.maxUpdates,
    maxSeconds: job.maxSeconds,
    budgetCredits: job.budgetCredits.toString(),
    consentGrantId: job.consentGrantId,
    trainingExportId: job.trainingExportId,
    evidenceDigest: job.evidenceDigest,
    exportDigest: job.exportDigest,
    repeatableReviewSnapshotDigest: job.repeatableReviewSnapshotDigest,
    questionDigest: job.questionDigest,
    buildSetDigest: job.buildSetDigest,
    tasksetDigest: job.tasksetDigest,
    candidateRuntimeId: job.candidateRuntimeId,
    failureCode: job.failureCode,
    createdAt: job.createdAt,
  }
}

export function createDecisionModelStore(
  database: PrismaClient,
  options: {
    authorizeRepositoryAdministration?: (
      transaction: Prisma.TransactionClient,
      input: { membershipId: string; repositoryId: string },
    ) => Promise<boolean>
  } = {},
): DecisionModelStore {
  const authorize =
    options.authorizeRepositoryAdministration ?? lockRepositoryAdministratorAuthority
  return {
    async getConfiguration(repositoryId) {
      const configuration = await getDecisionModelConfiguration(database, repositoryId)
      return configuration
        ? {
            enabled: configuration.enabled,
            generation: configuration.generation,
            backend: configuration.backend,
            maxUpdates: configuration.maxUpdates,
            maxSeconds: configuration.maxSeconds,
            monthlyBudgetCredits: configuration.monthlyBudgetCredits.toString(),
          }
        : null
    },
    getMonthlyUsageCredits: (repositoryId, since) =>
      sumDecisionTrainingUsage(database, repositoryId, since),
    async createOrGetJob(input) {
      return database.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT id
            FROM decision_model_configurations
            WHERE repository_id = ${input.repositoryId}::uuid
            FOR UPDATE
          `
          if (
            !(await authorize(transaction, {
              membershipId: input.requestedByMembershipId,
              repositoryId: input.repositoryId,
            }))
          ) {
            throw new DecisionModelError(
              403,
              "access_denied",
              "Repository administrator access is required.",
            )
          }
          const configuration = await getDecisionModelConfiguration(transaction, input.repositoryId)
          if (
            !configuration?.enabled ||
            configuration.generation !== input.configurationGeneration
          ) {
            throw new DecisionModelError(
              409,
              "configuration_stale",
              "The repository decision-model settings changed.",
            )
          }
          const existing = await getDecisionTrainingJobByIdempotencyKey(
            transaction,
            input.repositoryId,
            input.idempotencyKey,
          )
          if (existing) return { created: false, job: jobRecord(existing) }
          const since = new Date()
          since.setUTCDate(1)
          since.setUTCHours(0, 0, 0, 0)
          const [active, used, unknownTerminal] = await Promise.all([
            transaction.decisionTrainingJob.aggregate({
              where: {
                repositoryId: input.repositoryId,
                createdAt: { gte: since },
                state: { in: [...activeStates] },
              },
              _sum: { budgetCredits: true },
            }),
            transaction.decisionTrainingJob.aggregate({
              where: {
                repositoryId: input.repositoryId,
                createdAt: { gte: since },
                usageUnit: "credits",
                state: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
              },
              _sum: { usageQuantity: true },
            }),
            transaction.decisionTrainingJob.aggregate({
              where: {
                repositoryId: input.repositoryId,
                createdAt: { gte: since },
                state: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
                usageQuantity: null,
              },
              _sum: { budgetCredits: true },
            }),
          ])
          const remaining =
            decimalUnits(configuration.monthlyBudgetCredits.toFixed(9)) -
            decimalUnits(active._sum.budgetCredits?.toFixed(9) ?? "0.000000000") -
            decimalUnits(unknownTerminal._sum.budgetCredits?.toFixed(9) ?? "0.000000000") -
            decimalUnits(used._sum.usageQuantity?.toFixed(9) ?? "0.000000000")
          if (remaining < 1_000_000_000n) {
            throw new DecisionModelError(
              409,
              "budget_exceeded",
              "The repository decision-model budget has been reached.",
            )
          }
          const result = await createOrGetDecisionTrainingJob(transaction, {
            repositoryId: input.repositoryId,
            requestedByMembershipId: input.requestedByMembershipId,
            idempotencyKey: input.idempotencyKey,
            configurationGeneration: input.configurationGeneration,
            backend: input.settings.backend,
            maxUpdates: input.settings.maxUpdates,
            maxSeconds: input.settings.maxSeconds,
            budgetCredits: decimalString(remaining),
            consentGrantId: input.taskset.consentGrantId,
            trainingExportId: input.taskset.trainingExportId,
            evidenceDigest: input.taskset.evidenceDigest,
            exportDigest: input.taskset.exportDigest,
            repeatableReviewSnapshotDigest: input.taskset.repeatableReviewSnapshotDigest,
            questionDigest: input.taskset.questionDigest,
            buildSetDigest: input.taskset.buildSetDigest,
            tasksetDigest: input.taskset.tasksetDigest,
          })
          if (result.created) {
            await createSecurityAudit(transaction, {
              id: randomUUID(),
              type: "decision_training",
              actorMembershipId: input.requestedByMembershipId,
              outcome: "requested",
              repositoryId: input.repositoryId,
              jobId: result.job.id,
            })
          }
          return { created: result.created, job: jobRecord(result.job) }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      )
    },
    async getJob(repositoryId, jobId) {
      const job = await getDecisionTrainingJob(database, repositoryId, jobId)
      return job ? jobRecord(job) : null
    },
    async getJobByIdempotencyKey(repositoryId, idempotencyKey) {
      const job = await getDecisionTrainingJobByIdempotencyKey(
        database,
        repositoryId,
        idempotencyKey,
      )
      return job ? jobRecord(job) : null
    },
    async markJobSubmitted(input) {
      const result = await updateDecisionTrainingJob(database, {
        id: input.jobId,
        runtimeJobId: input.runtimeJobId,
        runtimeTasksetId: input.runtimeTasksetId,
        expectedStates: ["QUEUED"],
      })
      return jobRecord(result.job)
    },
    async markJobSubmitting(jobId) {
      return jobRecord(await markDecisionTrainingSubmitting(database, jobId))
    },
    async requestCancellation(input) {
      return database.$transaction(async (transaction) => {
        if (
          !(await authorize(transaction, {
            membershipId: input.actorMembershipId,
            repositoryId: input.repositoryId,
          }))
        ) {
          throw new DecisionModelError(
            403,
            "access_denied",
            "Repository administrator access is required.",
          )
        }
        const result = await requestDecisionTrainingCancellation(transaction, input.jobId)
        if (result.terminal) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_training",
            actorMembershipId: input.actorMembershipId,
            outcome: "cancelled",
            repositoryId: input.repositoryId,
            jobId: input.jobId,
          })
        }
        return { terminal: result.terminal, job: jobRecord(result.job) }
      })
    },
    async completeAdministratorCancellation(input) {
      return database.$transaction(async (transaction) => {
        if (
          !(await authorize(transaction, {
            membershipId: input.actorMembershipId,
            repositoryId: input.repositoryId,
          }))
        ) {
          throw new DecisionModelError(
            403,
            "access_denied",
            "Repository administrator access is required.",
          )
        }
        const result = await updateDecisionTrainingJob(transaction, {
          id: input.jobId,
          state: input.state,
          expectedStates: [...activeStates],
          failureCode: input.failureCode,
          usage: input.usage,
        })
        if (result.changed) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_training",
            actorMembershipId: input.actorMembershipId,
            outcome: input.state === "FAILED" ? "failed" : "cancelled",
            repositoryId: input.repositoryId,
            jobId: input.jobId,
            ...(input.failureCode ? { reason: input.failureCode } : {}),
          })
        }
        return jobRecord(result.job)
      })
    },
    async updateJobState(input) {
      return database.$transaction(async (transaction) => {
        const result = await updateDecisionTrainingJob(transaction, {
          id: input.jobId,
          state: input.state,
          expectedStates: [...activeStates],
          candidateRuntimeId: input.candidateRuntimeId,
          failureCode: input.failureCode,
          usage: input.usage,
        })
        if (result.changed && input.audit) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_training",
            actorMembershipId: input.audit.actorMembershipId,
            outcome: input.audit.outcome,
            repositoryId: input.audit.repositoryId,
            jobId: input.jobId,
            ...(input.audit.reason ? { reason: input.audit.reason } : {}),
          })
        }
        return jobRecord(result.job)
      })
    },
    async completeJobWithCandidate(input) {
      return database.$transaction(async (transaction) => {
        const result = await updateDecisionTrainingJob(transaction, {
          id: input.trainingJobId,
          state: "SUCCEEDED",
          expectedStates: ["SUBMITTED", "RUNNING"],
          candidateRuntimeId: input.runtimeCandidateId,
          usage: input.jobUsage,
        })
        if (!result.changed) return { candidate: null, job: jobRecord(result.job) }
        const candidate = await saveDecisionCandidate(transaction, {
          ...input,
          learningMetrics: input.learningMetrics,
        })
        if (input.actorMembershipId) {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_training",
            actorMembershipId: input.actorMembershipId,
            outcome: "succeeded",
            repositoryId: input.repositoryId,
            jobId: input.trainingJobId,
          })
        }
        return {
          candidate: {
            id: candidate.id,
            repositoryId: candidate.repositoryId,
            runtimeCandidateId: candidate.runtimeCandidateId,
            tasksetDigest: candidate.tasksetDigest,
            rejectedAt: candidate.rejectedAt,
          },
          job: jobRecord(result.job),
        }
      })
    },
    async getCandidate(repositoryId, candidateId) {
      const candidate = await getDecisionCandidate(database, repositoryId, candidateId)
      return candidate
        ? {
            id: candidate.id,
            repositoryId: candidate.repositoryId,
            runtimeCandidateId: candidate.runtimeCandidateId,
            tasksetDigest: candidate.tasksetDigest,
            rejectedAt: candidate.rejectedAt,
          }
        : null
    },
    async rejectCandidate(input) {
      return database.$transaction(async (transaction) => {
        if (
          !(await authorize(transaction, {
            membershipId: input.rejectedByMembershipId,
            repositoryId: input.repositoryId,
          }))
        ) {
          throw new DecisionModelError(
            403,
            "access_denied",
            "Repository administrator access is required.",
          )
        }
        await transaction.$queryRaw`
          SELECT id
          FROM decision_candidates
          WHERE id = ${input.candidateId}::uuid
            AND repository_id = ${input.repositoryId}::uuid
          FOR UPDATE
        `
        const result = await rejectDecisionCandidate(transaction, {
          ...input,
          rejectedAt: new Date(),
        })
        if (result.status === "promoted") {
          throw new DecisionModelError(
            409,
            "candidate_already_promoted",
            "A promoted decision candidate cannot be rejected.",
          )
        }
        if (result.status === "not-found") {
          throw new DecisionModelError(404, "candidate_not_found", "Decision candidate not found.")
        }
        if (result.status === "rejected") {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_candidate_rejection",
            actorMembershipId: input.rejectedByMembershipId,
            repositoryId: input.repositoryId,
            candidateId: input.candidateId,
          })
        }
        return {
          id: result.candidate.id,
          repositoryId: result.candidate.repositoryId,
          runtimeCandidateId: result.candidate.runtimeCandidateId,
          tasksetDigest: result.candidate.tasksetDigest,
          rejectedAt: result.candidate.rejectedAt,
        }
      })
    },
    async getPromotion(repositoryId) {
      const promotion = await getDecisionModelPromotion(database, repositoryId)
      return promotion
        ? {
            candidateId: promotion.candidateId,
            runtimeCandidateId: promotion.candidate.runtimeCandidateId,
            previousCandidateId: promotion.previousCandidateId,
            previousRuntimeCandidateId: promotion.previousCandidate?.runtimeCandidateId ?? null,
            runtimeGeneration: Number(promotion.runtimeGeneration),
          }
        : null
    },
    async savePromotion(input) {
      return database.$transaction(async (transaction) => {
        if (
          !(await authorize(transaction, {
            membershipId: input.promotedByMembershipId,
            repositoryId: input.repositoryId,
          }))
        ) {
          throw new DecisionModelError(
            403,
            "access_denied",
            "Repository administrator access is required.",
          )
        }
        await transaction.$queryRaw`
          SELECT id
          FROM decision_candidates
          WHERE id = ${input.candidateId}::uuid
            AND repository_id = ${input.repositoryId}::uuid
          FOR UPDATE
        `
        const candidate = await transaction.decisionCandidate.findFirst({
          where: { id: input.candidateId, repositoryId: input.repositoryId },
          select: { rejectedAt: true },
        })
        if (!candidate) {
          throw new DecisionModelError(404, "candidate_not_found", "Decision candidate not found.")
        }
        if (candidate.rejectedAt) {
          throw new DecisionModelError(
            409,
            "candidate_rejected",
            "A rejected decision candidate cannot be promoted.",
          )
        }
        const promotion = await saveDecisionModelPromotion(transaction, {
          ...input,
          runtimeGeneration: BigInt(input.runtimeGeneration),
        })
        await createSecurityAudit(transaction, {
          id: randomUUID(),
          type: "decision_promotion",
          actorMembershipId: input.promotedByMembershipId,
          operation: input.operation === "PROMOTE" ? "promote" : "rollback",
          outcome: "succeeded",
          repositoryId: input.repositoryId,
          candidateId: input.candidateId,
          generation: input.runtimeGeneration,
        })
        return {
          candidateId: promotion.candidateId,
          runtimeCandidateId: promotion.candidate.runtimeCandidateId,
          previousCandidateId: promotion.previousCandidateId,
          previousRuntimeCandidateId: promotion.previousCandidate?.runtimeCandidateId ?? null,
          runtimeGeneration: Number(promotion.runtimeGeneration),
        }
      })
    },
    async saveBuildEvaluation(input) {
      return database.$transaction(async (transaction) => {
        if (
          !(await authorize(transaction, {
            membershipId: input.actorMembershipId,
            repositoryId: input.repositoryId,
          }))
        ) {
          throw new DecisionModelError(
            403,
            "access_denied",
            "Repository administrator access is required.",
          )
        }
        const summary: Prisma.InputJsonObject = {
          findings: input.summary.findings.map((finding) => ({
            learning: {
              id: finding.learning.id,
            },
            route: finding.route,
            views: finding.views.map((view) => ({
              viewport: view.viewport,
              theme: view.theme,
            })),
            followsProbability: finding.followsProbability,
            breaksProbability: finding.breaksProbability,
            explanation: finding.explanation,
          })),
        }
        return saveDecisionBuildEvaluation(transaction, {
          ...input,
          promotionGeneration: BigInt(input.promotionGeneration),
          summary,
        })
      })
    },
    async isTasksetRevoked(input) {
      return Boolean(
        await database.decisionRuntimeDeletion.findFirst({
          where: {
            repositoryId: input.repositoryId,
            state: { in: ["PENDING", "COMPLETED", "FAILED"] },
            OR: [
              { exportId: input.exportId },
              { grantId: input.grantId },
              { evidenceDigest: input.evidenceDigest },
              { tasksetDigest: input.tasksetDigest },
            ],
          },
          select: { id: true },
        }),
      )
    },
    async isCandidateRevoked(repositoryId, candidateId) {
      const candidate = await database.decisionCandidate.findFirst({
        where: { id: candidateId, repositoryId },
        select: {
          trainingJob: {
            select: {
              trainingExportId: true,
              consentGrantId: true,
              evidenceDigest: true,
              tasksetDigest: true,
            },
          },
        },
      })
      if (!candidate) return false
      return Boolean(
        await database.decisionRuntimeDeletion.findFirst({
          where: {
            repositoryId,
            state: { in: ["PENDING", "COMPLETED", "FAILED"] },
            OR: [
              { exportId: candidate.trainingJob.trainingExportId },
              { grantId: candidate.trainingJob.consentGrantId },
              { evidenceDigest: candidate.trainingJob.evidenceDigest },
              { tasksetDigest: candidate.trainingJob.tasksetDigest },
            ],
          },
          select: { id: true },
        }),
      )
    },
    async createOrGetDeletion(input) {
      const selectors = input.selectors
      const record = await database.decisionRuntimeDeletion.upsert({
        where: {
          repositoryId_idempotencyKey: {
            repositoryId: input.repositoryId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        create: {
          repositoryId: input.repositoryId,
          requestedByMembershipId: input.requestedByMembershipId,
          idempotencyKey: input.idempotencyKey,
          exportId: selectors.exportId,
          grantId: selectors.grantId,
          evidenceDigest: selectors.evidenceDigest,
          tasksetDigest: selectors.tasksetDigest,
          reason: input.reason,
        },
        update: {},
      })
      return {
        id: record.id,
        runtimeDeletionId: record.runtimeDeletionId,
        state: record.state,
      }
    },
    async saveRuntimeCopies(repositoryId, copies) {
      await database.$transaction(
        copies.map((copy) =>
          database.decisionRuntimeCopy.upsert({
            where: {
              repositoryId_runtimeCopyId: {
                repositoryId,
                runtimeCopyId: copy.runtimeCopyId,
              },
            },
            create: {
              repositoryId,
              runtimeCopyId: copy.runtimeCopyId,
              kind: copy.kind,
              runtimeConnector: copy.storage.connector,
              runtimeReference: copy.storage.reference,
              exportId: copy.sourceTrainingExportId,
              grantIds: copy.permittingGrantIds ?? [],
              evidenceDigest: copy.evidenceDigest,
              tasksetDigest: copy.tasksetDigest,
              useState: copy.useState,
              promotionState: copy.promotionState,
              retention: copy.retention as Prisma.InputJsonValue,
              runtimeCreatedAt: copy.createdAt ? new Date(copy.createdAt) : null,
              disclosedAt: new Date(),
            },
            update: {
              useState: copy.useState,
              promotionState: copy.promotionState,
              runtimeConnector: copy.storage.connector,
              runtimeReference: copy.storage.reference,
              exportId: copy.sourceTrainingExportId,
              grantIds: copy.permittingGrantIds ?? [],
              evidenceDigest: copy.evidenceDigest,
              tasksetDigest: copy.tasksetDigest,
              retention: copy.retention as Prisma.InputJsonValue,
              runtimeCreatedAt: copy.createdAt ? new Date(copy.createdAt) : null,
              disclosedAt: new Date(),
            },
          }),
        ),
      )
    },
    async updateDeletionReceipt(deletionId, receipt) {
      await database.$transaction(async (transaction) => {
        const existing = await transaction.decisionRuntimeDeletion.findUniqueOrThrow({
          where: { id: deletionId },
        })
        const state =
          receipt.state === "completed"
            ? "COMPLETED"
            : receipt.failures.length > 0 && receipt.pendingItems.length === 0
              ? "FAILED"
              : "PENDING"
        const receiptJson: Prisma.InputJsonObject = {
          id: receipt.id,
          state: receipt.state,
          selectors: { ...receipt.selectors },
          items: receipt.items.map((item) => ({
            kind: item.kind,
            runtimeCopyId: item.runtimeCopyId,
            state: item.state,
            ...(item.storage
              ? {
                  storage: {
                    connector: item.storage.connector,
                    reference: item.storage.reference,
                  },
                }
              : {}),
            ...(item.retention ? { retention: item.retention as Prisma.InputJsonObject } : {}),
          })),
          pendingItems: receipt.pendingItems.map((item) => ({ ...item })),
          failures: receipt.failures.map((item) => ({ ...item })),
          updatedAt: receipt.updatedAt,
          ...(receipt.revokedAt ? { revokedAt: receipt.revokedAt } : {}),
          ...(receipt.completedAt ? { completedAt: receipt.completedAt } : {}),
        }
        await transaction.decisionRuntimeDeletion.update({
          where: { id: deletionId },
          data: {
            runtimeDeletionId: receipt.id,
            state,
            pendingCount: receipt.pendingItems.length,
            failureCount: receipt.failures.length,
            receipt: receiptJson,
            failureCode: receipt.failures[0]?.code,
            revokedAt: receipt.revokedAt ? new Date(receipt.revokedAt) : undefined,
            completedAt: receipt.completedAt ? new Date(receipt.completedAt) : undefined,
          },
        })
        if (existing.state !== state && state !== "PENDING") {
          await createSecurityAudit(transaction, {
            id: randomUUID(),
            type: "decision_runtime_deletion",
            actorMembershipId: existing.requestedByMembershipId,
            repositoryId: existing.repositoryId,
            deletionId,
            outcome: state === "COMPLETED" ? "completed" : "failed",
          })
        }
      })
    },
    async getDeletion(id) {
      return database.decisionRuntimeDeletion.findUnique({
        where: { id },
        select: {
          id: true,
          repositoryId: true,
          runtimeDeletionId: true,
          state: true,
        },
      })
    },
    listPendingDeletions: () =>
      database.decisionRuntimeDeletion.findMany({
        where: { state: "PENDING" },
        select: { id: true, repositoryId: true, runtimeDeletionId: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: 100,
      }),
  }
}

function getDecisionTrainingJobByIdempotencyKey(
  database: Pick<Prisma.TransactionClient, "decisionTrainingJob">,
  repositoryId: string,
  idempotencyKey: string,
) {
  return database.decisionTrainingJob.findUnique({
    where: { repositoryId_idempotencyKey: { repositoryId, idempotencyKey } },
  })
}
