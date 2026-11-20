import { createHash, randomUUID } from "node:crypto"

import { validateBuildScreenshot } from "../../../integrations/png/validate-build-screenshot/index.ts"
import { DecisionModelError } from "../errors.ts"
import type {
  AgentEvaluationAuthority,
  AgentEvaluationDependencies,
  AgentEvaluationResult,
  AgentEvaluationScreenshot,
  AgentLearningAuthority,
} from "../types.ts"

const maximumScreenshotBytes = 2 * 1_024 * 1_024
const maximumScreenshots = 8
const maximumQuestions = 100
const viewports = {
  desktop: { width: 1_440, minimumHeight: 900 },
  narrow: { width: 390, minimumHeight: 844 },
} as const

async function screenshotBytes(screenshot: AgentEvaluationScreenshot) {
  const bytes = Buffer.from(screenshot.dataBase64, "base64")
  if (
    bytes.length === 0 ||
    bytes.length > maximumScreenshotBytes ||
    bytes.toString("base64").replace(/=+$/, "") !== screenshot.dataBase64.replace(/=+$/, "") ||
    !(await validateBuildScreenshot(
      bytes,
      viewports[screenshot.viewport].width,
      viewports[screenshot.viewport].minimumHeight,
    ))
  ) {
    throw new DecisionModelError(
      422,
      "invalid_screenshot",
      "Prototype evaluation requires bounded complete PNG screenshots.",
    )
  }
  return bytes
}

function explanation(
  finding: { followsProbability: number; breaksProbability: number },
  environment: "fixture" | "production",
) {
  const direction = finding.followsProbability >= finding.breaksProbability ? "follows" : "breaks"
  const prefix = environment === "fixture" ? "Fixture only. " : ""
  return `${prefix}The promoted model assigns the higher probability to ${direction} this learning across the supplied views. This is unverified authoring guidance, not a review outcome.`
}

function learningText(question: AgentLearningAuthority["questions"][string] | undefined) {
  return question && "learning_text" in question ? question.learning_text : null
}

function samePromotion(
  promotion: Awaited<ReturnType<AgentEvaluationDependencies["store"]["getPromotion"]>>,
  candidateId: string,
  generation: number,
) {
  return promotion?.candidateId === candidateId && promotion.runtimeGeneration === generation
}

async function requireCurrentAuthority(
  input: { repositoryId: string; candidateId: string; generation: number },
  dependencies: AgentEvaluationDependencies,
) {
  const [promotion, revoked] = await Promise.all([
    dependencies.store.getPromotion(input.repositoryId),
    dependencies.store.isCandidateRevoked?.(input.repositoryId, input.candidateId),
  ])
  if (revoked) {
    throw new DecisionModelError(
      409,
      "deletion_revoked",
      "Decision-model use is blocked by a runtime deletion.",
    )
  }
  if (!samePromotion(promotion, input.candidateId, input.generation)) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The promoted decision model changed during prototype evaluation.",
    )
  }
}

export async function evaluatePrototypeWithDecisionModel(
  input: {
    authority: AgentEvaluationAuthority
    currentRoute: string | null
    screenshots: AgentEvaluationScreenshot[]
  },
  dependencies: AgentEvaluationDependencies,
): Promise<AgentEvaluationResult> {
  await dependencies.limits.checkRate(input.authority)
  if (input.screenshots.length === 0 || input.screenshots.length > maximumScreenshots) {
    throw new DecisionModelError(
      422,
      "invalid_screenshot",
      `Prototype evaluation requires between 1 and ${maximumScreenshots} screenshots.`,
    )
  }

  const configuration = await dependencies.store.getConfiguration(input.authority.repositoryId)
  if (!configuration?.enabled) {
    throw new DecisionModelError(
      409,
      "configuration_disabled",
      "Decision-model evaluation is not enabled for this repository.",
    )
  }
  const promotion = await dependencies.store.getPromotion(input.authority.repositoryId)
  if (!promotion) {
    throw new DecisionModelError(
      409,
      "configuration_disabled",
      "No decision candidate is promoted for this repository.",
    )
  }
  const [candidate, learningAuthority, readiness] = await Promise.all([
    dependencies.store.getCandidate(input.authority.repositoryId, promotion.candidateId),
    dependencies.readLearningAuthority({
      repositoryId: input.authority.repositoryId,
      candidateId: promotion.candidateId,
      promotionGeneration: promotion.runtimeGeneration,
    }),
    dependencies.readRuntimeReadiness({ repositoryId: input.authority.repositoryId }),
  ])
  await requireCurrentAuthority(
    {
      repositoryId: input.authority.repositoryId,
      candidateId: promotion.candidateId,
      generation: promotion.runtimeGeneration,
    },
    dependencies,
  )
  if (!readiness.ready) {
    throw new DecisionModelError(
      503,
      "runtime_not_ready",
      "The repository decision runtime is not ready for prototype evaluation.",
    )
  }
  if (!candidate || candidate.rejectedAt) {
    throw new DecisionModelError(
      409,
      "promotion_stale",
      "The promoted decision candidate is no longer available.",
    )
  }
  if (!learningAuthority.consentGranted) {
    throw new DecisionModelError(
      409,
      "consent_required",
      "Repository learning consent does not allow prototype evaluation.",
    )
  }
  const questions = Object.entries(learningAuthority.questions)
  if (
    questions.length === 0 ||
    questions.length > maximumQuestions ||
    questions.some(
      ([id, question]) =>
        id.length === 0 ||
        id.length > 255 ||
        ("learning_text" in question &&
          (question.learning_text.length === 0 || question.learning_text.length > 4_000)),
    )
  ) {
    throw new DecisionModelError(
      409,
      "learning_ineligible",
      "No bounded promoted learnings are eligible for prototype evaluation.",
    )
  }
  if (readiness.environment === "production" && candidate.productionEligible !== true) {
    throw new DecisionModelError(
      409,
      "learning_ineligible",
      "The promoted candidate is not eligible for production guidance.",
    )
  }

  const views = new Set<string>()
  const prepared = await Promise.all(
    input.screenshots.map(async (screenshot) => {
      if (
        !screenshot.route.startsWith("/") ||
        screenshot.route.startsWith("//") ||
        screenshot.route.includes("?") ||
        screenshot.route.includes("#") ||
        screenshot.route.length > 2_048
      ) {
        throw new DecisionModelError(
          422,
          "invalid_screenshot",
          "Prototype evaluation routes must be bounded root-relative paths.",
        )
      }
      const view = `${screenshot.route}\0${screenshot.viewport}\0${screenshot.theme}`
      if (views.has(view)) {
        throw new DecisionModelError(
          422,
          "invalid_screenshot",
          "Prototype evaluation cannot repeat the same route and view.",
        )
      }
      views.add(view)
      const bytes = await screenshotBytes(screenshot)
      return {
        screenshot,
        bytes,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      }
    }),
  )
  const screenshotSetDigest = `sha256:${createHash("sha256")
    .update(
      prepared
        .map(
          ({ screenshot, digest }) =>
            `${screenshot.route}\0${screenshot.viewport}\0${screenshot.theme}\0${digest}`,
        )
        .sort()
        .join("\n"),
    )
    .digest("hex")}`
  const cacheKey = createHash("sha256")
    .update(
      [
        input.authority.repositoryId,
        input.authority.prototypeId ?? "",
        input.authority.buildId ?? "",
        input.authority.branch,
        input.authority.commitSha,
        input.currentRoute ?? "",
        promotion.candidateId,
        String(promotion.runtimeGeneration),
        readiness.environment,
        learningAuthority.questionDigest,
        screenshotSetDigest,
      ].join("\0"),
    )
    .digest("hex")
  const byRoute = new Map<string, typeof prepared>()
  for (const item of prepared) {
    const routeScreenshots = byRoute.get(item.screenshot.route) ?? []
    routeScreenshots.push(item)
    byRoute.set(item.screenshot.route, routeScreenshots)
  }
  if (byRoute.size > 4) {
    throw new DecisionModelError(
      422,
      "invalid_screenshot",
      "Prototype evaluation supports at most four routes per request.",
    )
  }
  const reservation = await dependencies.cache.reserve({
    cacheKey,
    candidateId: promotion.candidateId,
    promotionGeneration: promotion.runtimeGeneration,
    questionDigest: learningAuthority.questionDigest,
    repositoryId: input.authority.repositoryId,
    requestUnits: byRoute.size,
    screenshotSetDigest,
  })
  if (reservation.status === "cached") {
    await requireCurrentAuthority(
      {
        repositoryId: input.authority.repositoryId,
        candidateId: promotion.candidateId,
        generation: promotion.runtimeGeneration,
      },
      dependencies,
    )
    return {
      ...reservation.result,
      status: "cached",
      findings: reservation.result.findings.map((finding) => ({
        ...finding,
        learning: {
          ...finding.learning,
          text: learningText(learningAuthority.questions[finding.learning.id]),
        },
      })),
    }
  }

  const findings: AgentEvaluationResult["findings"] = []
  const deadline = AbortSignal.timeout(120_000)
  try {
    for (const [route, routeScreenshots] of byRoute) {
      const currentLearningAuthority = await dependencies.readLearningAuthority({
        repositoryId: input.authority.repositoryId,
        candidateId: promotion.candidateId,
        promotionGeneration: promotion.runtimeGeneration,
      })
      if (
        !currentLearningAuthority.consentGranted ||
        currentLearningAuthority.questionDigest !== learningAuthority.questionDigest
      ) {
        throw new DecisionModelError(
          409,
          "consent_required",
          "Repository learning authority changed during prototype evaluation.",
        )
      }
      await requireCurrentAuthority(
        {
          repositoryId: input.authority.repositoryId,
          candidateId: promotion.candidateId,
          generation: promotion.runtimeGeneration,
        },
        dependencies,
      )
      routeScreenshots.sort(
        (left, right) =>
          (left.screenshot.viewport === right.screenshot.viewport
            ? 0
            : left.screenshot.viewport === "desktop"
              ? -1
              : 1) ||
          (left.screenshot.theme === right.screenshot.theme
            ? 0
            : left.screenshot.theme === "light"
              ? -1
              : 1),
      )
      const result = await dependencies.runtime.evaluate({
        state: {
          route,
          currentRoute: input.currentRoute,
          branch: input.authority.branch,
          commitSha: input.authority.commitSha,
          imagesNote: routeScreenshots
            .map(
              ({ screenshot }, index) =>
                `Image ${index + 1} is ${viewports[screenshot.viewport].width} pixels wide and at least ${viewports[screenshot.viewport].minimumHeight} pixels high in ${screenshot.theme} theme.`,
            )
            .join(" "),
        },
        images: routeScreenshots.map(
          ({ bytes }) => `data:image/png;base64,${bytes.toString("base64")}`,
        ),
        questions: learningAuthority.questions,
        idempotencyKey: `agent-evaluation:${createHash("sha256")
          .update(
            [cacheKey, route, ...routeScreenshots.map(({ digest }) => digest).sort()].join("\0"),
          )
          .digest("hex")}`,
        signal: deadline,
      })
      if (
        result.candidateId !== promotion.runtimeCandidateId ||
        result.generation !== promotion.runtimeGeneration ||
        !samePromotion(
          await dependencies.store.getPromotion(input.authority.repositoryId),
          promotion.candidateId,
          promotion.runtimeGeneration,
        )
      ) {
        throw new DecisionModelError(
          409,
          "promotion_stale",
          "The promoted decision model changed during prototype evaluation.",
        )
      }
      const views = routeScreenshots.map(({ screenshot }) => ({
        viewport: screenshot.viewport,
        theme: screenshot.theme,
      }))
      for (const evaluation of result.evaluations) {
        const question = learningAuthority.questions[evaluation.learningId]
        if (!question || !("learning_text" in question)) {
          throw new DecisionModelError(
            502,
            "runtime_unavailable",
            "The decision runtime returned an ineligible learning.",
          )
        }
        const finding = {
          learning: { id: evaluation.learningId, text: question.learning_text },
          route,
          views,
          followsProbability: evaluation.followsProbability,
          breaksProbability: evaluation.breaksProbability,
        }
        findings.push({
          ...finding,
          explanation: explanation(finding, readiness.environment),
        })
      }
    }
    const finalAuthority = await dependencies.readLearningAuthority({
      repositoryId: input.authority.repositoryId,
      candidateId: promotion.candidateId,
      promotionGeneration: promotion.runtimeGeneration,
    })
    if (
      !finalAuthority.consentGranted ||
      finalAuthority.questionDigest !== learningAuthority.questionDigest
    ) {
      throw new DecisionModelError(
        409,
        "consent_required",
        "Repository learning authority changed during prototype evaluation.",
      )
    }
    await requireCurrentAuthority(
      {
        repositoryId: input.authority.repositoryId,
        candidateId: promotion.candidateId,
        generation: promotion.runtimeGeneration,
      },
      dependencies,
    )

    const guidanceAvailable =
      readiness.environment === "production" && candidate.productionEligible === true
    const value: AgentEvaluationResult = {
      evaluationId: randomUUID(),
      status: "fresh",
      environment: readiness.environment,
      guidance: {
        available: guidanceAvailable,
        notice: guidanceAvailable
          ? "Use these findings only as unverified authoring guidance."
          : "Fixture findings are test data and must not be used as production guidance.",
      },
      context: {
        repositoryId: input.authority.repositoryId,
        prototypeId: input.authority.prototypeId,
        buildId: input.authority.buildId,
        branch: input.authority.branch,
        commitSha: input.authority.commitSha,
      },
      model: {
        candidateId: promotion.candidateId,
        runtimeCandidateId: promotion.runtimeCandidateId,
        promotionGeneration: promotion.runtimeGeneration,
      },
      screenshotSetDigest,
      findings,
    }
    await dependencies.cache.complete(reservation.id, value)
    return value
  } catch (error) {
    await dependencies.cache.fail(reservation.id)
    throw error
  }
}
