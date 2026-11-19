import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"

import { DecisionRuntimeError } from "./errors.ts"
import type {
  DecisionRuntimeCandidate,
  DecisionRuntimeClient,
  DecisionRuntimeCredentialProvider,
  DecisionRuntimeEvaluation,
  DecisionRuntimePromotion,
} from "./types.ts"

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const usage = z
  .object({
    connector: z.string().min(1).max(200),
    kind: z.string().min(1).max(100),
    quantity: z.number().nonnegative(),
    unit: z.string().min(1).max(50),
    cost: z.number().nonnegative().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    source: z.string().min(1).max(200),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine((value) => (value.cost === null) === (value.currency === null))
const job = z
  .object({
    id: z.string().min(1).max(100),
    state: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    tasksetDigest: digest,
    candidateId: z.string().min(1).max(100).optional(),
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    error: z
      .object({ code: z.string().min(1).max(100) })
      .loose()
      .optional(),
    usage: z.array(usage).optional(),
  })
  .loose()
const promotion = z
  .object({
    candidateId: z.string().min(1).max(100).nullable(),
    previousCandidateId: z.string().min(1).max(100).nullable().optional(),
    generation: z.number().int().nonnegative().optional(),
  })
  .loose()
const evaluationReport = z
  .object({
    meanReward: z.number().nullable(),
    noul: z
      .object({
        ece: z.number().nullable(),
        byRule: z
          .record(
            z.string(),
            z
              .object({
                balancedAccuracy: z.number().nullable(),
              })
              .loose(),
          )
          .default({}),
      })
      .loose(),
  })
  .loose()
const candidate = z
  .object({
    manifest: z
      .object({
        id: z.string().min(1).max(100),
        tasksetDigest: digest,
        productionEligible: z.boolean(),
        usage: z.array(usage).optional(),
      })
      .loose(),
    evaluation: z
      .object({
        baseline: evaluationReport,
        candidate: evaluationReport,
        evidence: z
          .object({
            meanRewardDelta: z.number().nullable(),
            calibrationErrorDelta: z.number().nullable(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose()
const evaluation = z
  .object({
    id: z.string().min(1).max(100).optional(),
    candidateId: z.string().min(1).max(100),
    promotionGeneration: z.number().int().positive(),
    evaluations: z.array(
      z
        .object({
          learningId: z.string().min(1).max(255),
          followsProbability: z.number().min(0).max(1),
          breaksProbability: z.number().min(0).max(1),
        })
        .strict(),
    ),
    usage: z.array(usage).optional(),
  })
  .loose()

interface CreateDecisionRuntimeClientOptions {
  baseUrl: string
  credentialProvider: DecisionRuntimeCredentialProvider
  fetch?: typeof globalThis.fetch
  timeoutMilliseconds?: number
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function validateIdempotencyKey(value: string): string {
  return z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,100}$/)
    .parse(value)
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ""
  while (true) {
    const result = await reader.read()
    if (result.done) return text + decoder.decode()
    bytes += result.value.byteLength
    if (bytes > maximumBytes) {
      await reader.cancel()
      throw new DecisionRuntimeError(
        "invalid_response",
        "The decision runtime returned an oversized response.",
      )
    }
    text += decoder.decode(result.value, { stream: true })
  }
}

export function createDecisionRuntimeClient({
  baseUrl,
  credentialProvider,
  fetch: request = globalThis.fetch,
  timeoutMilliseconds = 30_000,
}: CreateDecisionRuntimeClientOptions): DecisionRuntimeClient {
  const parsedBaseUrl = new URL(baseUrl)
  if (
    parsedBaseUrl.protocol !== "https:" ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw new Error("The decision runtime base URL must be an HTTPS URL without credentials.")
  }
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1_000 ||
    timeoutMilliseconds > 120_000
  ) {
    throw new Error("The decision runtime timeout must be from 1000 to 120000 milliseconds.")
  }

  async function call(
    path: string,
    options: {
      body?: string | Uint8Array<ArrayBuffer>
      contentType?: string
      headers?: Record<string, string>
      idempotencyKey?: string
      method?: "GET" | "POST" | "PUT"
      signal?: AbortSignal
    } = {},
  ): Promise<unknown> {
    const operationId = randomUUID()
    const timeout = AbortSignal.timeout(timeoutMilliseconds)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let credential
    try {
      credential = await credentialProvider.getCredential({
        audience: parsedBaseUrl.origin,
        operationId,
        signal,
      })
    } catch (error) {
      if (signal.aborted) {
        throw new DecisionRuntimeError(
          options.signal?.aborted ? "cancelled" : "timeout",
          "The decision runtime request did not start.",
          { cause: error },
        )
      }
      throw new DecisionRuntimeError(
        "authentication_failed",
        "Hub could not obtain a decision runtime credential.",
        { cause: error },
      )
    }
    if (
      !credential.token ||
      credential.expiresAt.getTime() <= Date.now() ||
      credential.expiresAt.getTime() > Date.now() + 10 * 60_000
    ) {
      throw new DecisionRuntimeError(
        "authentication_failed",
        "The decision runtime credential is not valid for this operation.",
      )
    }
    let response: Response
    try {
      response = await request(new URL(path, parsedBaseUrl), {
        method: options.method ?? "GET",
        body: options.body,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential.token}`,
          ...(options.contentType ? { "content-type": options.contentType } : {}),
          ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
          ...options.headers,
        },
        signal,
      })
    } catch (error) {
      if (signal.aborted) {
        throw new DecisionRuntimeError(
          options.signal?.aborted ? "cancelled" : "timeout",
          "The decision runtime request did not complete.",
          { cause: error },
        )
      }
      throw new DecisionRuntimeError("unavailable", "The decision runtime is unavailable.", {
        cause: error,
      })
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0)
    if (contentLength > 2 * 1024 * 1024) {
      throw new DecisionRuntimeError(
        "invalid_response",
        "The decision runtime returned an oversized response.",
      )
    }
    const text = await readBoundedResponse(response, 2 * 1024 * 1024)
    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch (error) {
      throw new DecisionRuntimeError(
        "invalid_response",
        "The decision runtime returned invalid JSON.",
        { cause: error },
      )
    }
    if (!response.ok) {
      const runtimeCode = z
        .object({ error: z.object({ code: z.string() }).loose() })
        .loose()
        .safeParse(body)
      const code =
        response.status === 401 || response.status === 403
          ? "authentication_failed"
          : response.status === 404
            ? "not_found"
            : response.status === 409
              ? "conflict"
              : response.status === 429
                ? "rate_limited"
                : response.status >= 500
                  ? "unavailable"
                  : "runtime_failure"
      throw new DecisionRuntimeError(
        code,
        runtimeCode.success
          ? `The decision runtime rejected the request (${runtimeCode.data.error.code}).`
          : "The decision runtime rejected the request.",
      )
    }
    return body
  }

  function parse<Result>(schema: z.ZodType<Result>, value: unknown): Result {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new DecisionRuntimeError(
        "invalid_response",
        "The decision runtime returned an invalid response.",
        { cause: parsed.error },
      )
    }
    return parsed.data
  }

  return {
    async transferTaskset(input) {
      const tasksetDigest = digest.parse(input.tasksetDigest)
      const value = await call(`/v1/tasksets/${tasksetDigest.slice("sha256:".length)}`, {
        method: "PUT",
        body: JSON.stringify(input.upload),
        contentType: "application/json",
        idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
        signal: input.signal,
      })
      const registered = parse(
        z
          .object({
            reference: z.string().min(1).max(200),
            digest,
          })
          .loose(),
        value,
      )
      return {
        reference: registered.reference,
        tasksetDigest: registered.digest,
      }
    },
    async submitTraining(input) {
      const tasksetDigest = digest.parse(input.tasksetDigest)
      return parse(
        job,
        await call("/v1/jobs", {
          method: "POST",
          body: JSON.stringify({
            backend: input.backend,
            maxUpdates: input.maxUpdates,
            maxSeconds: input.maxSeconds,
            maxCredits: Number(
              z
                .string()
                .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
                .parse(input.maxCredits),
            ),
            budgetMode: "hard",
            tasksetDigest,
          }),
          contentType: "application/json",
          idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
          signal: input.signal,
        }),
      )
    },
    async getTrainingJob(id, signal) {
      return parse(job, await call(`/v1/jobs/${encodeURIComponent(id)}`, { signal }))
    },
    async cancelTrainingJob(input) {
      return parse(
        job,
        await call(`/v1/jobs/${encodeURIComponent(input.id)}/cancel`, {
          method: "POST",
          body: "{}",
          contentType: "application/json",
          idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
          signal: input.signal,
        }),
      )
    },
    async getCandidate(id, signal) {
      const value = parse(
        candidate,
        await call(`/v1/candidates/${encodeURIComponent(id)}`, { signal }),
      )
      const learningIds = new Set([
        ...Object.keys(value.evaluation.baseline.noul.byRule),
        ...Object.keys(value.evaluation.candidate.noul.byRule),
      ])
      const learningMetrics = [...learningIds].sort().map((learningId) => {
        const baselineBalancedAccuracy =
          value.evaluation.baseline.noul.byRule[learningId]?.balancedAccuracy ?? null
        const candidateBalancedAccuracy =
          value.evaluation.candidate.noul.byRule[learningId]?.balancedAccuracy ?? null
        const delta =
          baselineBalancedAccuracy === null || candidateBalancedAccuracy === null
            ? null
            : candidateBalancedAccuracy - baselineBalancedAccuracy
        return {
          learningId,
          baselineBalancedAccuracy,
          candidateBalancedAccuracy,
          delta,
          direction:
            delta === null
              ? ("unknown" as const)
              : delta > 0
                ? ("gain" as const)
                : delta < 0
                  ? ("regression" as const)
                  : ("unchanged" as const),
        }
      })
      return {
        id: value.manifest.id,
        tasksetDigest: value.manifest.tasksetDigest,
        manifestDigest: hashJson(value.manifest),
        evaluationDigest: hashJson(value.evaluation),
        productionEligible: value.manifest.productionEligible,
        evidence: {
          baselineMeanReward: value.evaluation.baseline.meanReward,
          candidateMeanReward: value.evaluation.candidate.meanReward,
          meanRewardDelta: value.evaluation.evidence.meanRewardDelta,
          baselineCalibrationError: value.evaluation.baseline.noul.ece,
          candidateCalibrationError: value.evaluation.candidate.noul.ece,
          calibrationErrorDelta: value.evaluation.evidence.calibrationErrorDelta,
          learningMetrics,
        },
        ...(value.manifest.usage ? { usage: value.manifest.usage } : {}),
      } satisfies DecisionRuntimeCandidate
    },
    async getPromotion(signal) {
      const value = parse(promotion, await call("/v1/promotion", { signal }))
      return {
        ...value,
        generation: value.generation ?? 0,
      } satisfies DecisionRuntimePromotion
    },
    async promote(input) {
      const value = parse(
        promotion,
        await call("/v1/promotions", {
          method: "POST",
          body: JSON.stringify({
            candidateId: input.candidateId,
            expectedGeneration: input.expectedGeneration,
            promotedBy: input.promotedBy,
          }),
          contentType: "application/json",
          idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
          signal: input.signal,
        }),
      )
      return {
        ...value,
        generation: value.generation ?? 0,
      } satisfies DecisionRuntimePromotion
    },
    async rollback(input) {
      const value = parse(
        promotion,
        await call("/v1/rollbacks", {
          method: "POST",
          body: JSON.stringify({
            expectedGeneration: input.expectedGeneration,
            rolledBackBy: input.rolledBackBy,
          }),
          contentType: "application/json",
          idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
          signal: input.signal,
        }),
      )
      return {
        ...value,
        generation: value.generation ?? 0,
      } satisfies DecisionRuntimePromotion
    },
    async evaluate(input) {
      const value = parse(
        evaluation,
        await call("/v1/evaluations", {
          method: "POST",
          body: JSON.stringify({
            state: input.state,
            images: input.images,
            questions: input.questions,
          }),
          contentType: "application/json",
          idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
          signal: input.signal,
        }),
      )
      return {
        id: value.id,
        candidateId: value.candidateId,
        generation: value.promotionGeneration,
        evaluations: value.evaluations,
        ...(value.usage ? { usage: value.usage } : {}),
        responseDigest: hashJson(value),
      } satisfies DecisionRuntimeEvaluation
    },
  }
}
