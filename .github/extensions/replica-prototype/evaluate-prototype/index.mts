import { readHubObject } from "../read-hub-object/index.mjs"
import type { HubClient } from "../create-hub-client/index.mjs"

const maximumBase64Length = 2_796_204
const commitPattern = /^[0-9a-f]{40}$/
const routePattern = /^\/(?!\/)[^?#]*$/

type Screenshot = {
  route: string
  viewport: "desktop" | "narrow"
  theme: "light" | "dark"
  dataBase64: string
}

function route(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    !routePattern.test(value)
  )
    throw new Error("Prototype evaluation routes must be root-relative paths.")
  return value
}

function screenshots(value: unknown): Screenshot[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    throw new Error("Provide between one and eight bounded prototype screenshots.")
  return value.map((item) => {
    const screenshot = readHubObject(item)
    if (
      !screenshot ||
      (screenshot.viewport !== "desktop" && screenshot.viewport !== "narrow") ||
      (screenshot.theme !== "light" && screenshot.theme !== "dark") ||
      typeof screenshot.dataBase64 !== "string" ||
      screenshot.dataBase64.length === 0 ||
      screenshot.dataBase64.length > maximumBase64Length ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshot.dataBase64)
    )
      throw new Error("Prototype evaluation received an invalid screenshot.")
    return {
      route: route(screenshot.route),
      viewport: screenshot.viewport,
      theme: screenshot.theme,
      dataBase64: screenshot.dataBase64,
    }
  })
}

function probability(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error("Hub returned an invalid prototype-evaluation probability.")
  return value
}

function projectResult(value: unknown) {
  const result = readHubObject(value)
  const context = readHubObject(result?.context)
  const model = readHubObject(result?.model)
  const guidance = readHubObject(result?.guidance)
  if (
    !result ||
    typeof result.evaluationId !== "string" ||
    (result.status !== "cached" && result.status !== "fresh") ||
    (result.environment !== "fixture" && result.environment !== "production") ||
    !context ||
    typeof context.repositoryId !== "string" ||
    (context.prototypeId !== null && typeof context.prototypeId !== "string") ||
    (context.buildId !== null && typeof context.buildId !== "string") ||
    typeof context.branch !== "string" ||
    typeof context.commitSha !== "string" ||
    !commitPattern.test(context.commitSha) ||
    !model ||
    typeof model.candidateId !== "string" ||
    typeof model.runtimeCandidateId !== "string" ||
    typeof model.promotionGeneration !== "number" ||
    !Number.isSafeInteger(model.promotionGeneration) ||
    model.promotionGeneration < 0 ||
    typeof result.screenshotSetDigest !== "string" ||
    !guidance ||
    typeof guidance.available !== "boolean" ||
    typeof guidance.notice !== "string" ||
    guidance.notice.length === 0 ||
    guidance.notice.length > 512 ||
    (result.environment === "fixture" && guidance.available) ||
    !Array.isArray(result.findings) ||
    result.findings.length > 800
  )
    throw new Error("Hub returned an invalid prototype evaluation.")

  const findings = result.findings.map((item) => {
    const finding = readHubObject(item)
    const learning = readHubObject(finding?.learning)
    if (
      !finding ||
      !learning ||
      typeof learning.id !== "string" ||
      learning.id.length === 0 ||
      learning.id.length > 255 ||
      (learning.text !== null && typeof learning.text !== "string") ||
      (typeof learning.text === "string" && learning.text.length > 4_000) ||
      !Array.isArray(finding.views) ||
      finding.views.length === 0 ||
      finding.views.length > 4 ||
      typeof finding.explanation !== "string" ||
      finding.explanation.length === 0 ||
      finding.explanation.length > 1_000
    )
      throw new Error("Hub returned an invalid prototype-evaluation finding.")
    return {
      learning: { id: learning.id, text: learning.text },
      route: route(finding.route),
      views: finding.views.map((item) => {
        const view = readHubObject(item)
        if (
          !view ||
          (view.viewport !== "desktop" && view.viewport !== "narrow") ||
          (view.theme !== "light" && view.theme !== "dark")
        )
          throw new Error("Hub returned an invalid evaluated view.")
        return { viewport: view.viewport, theme: view.theme }
      }),
      followsProbability: probability(finding.followsProbability),
      breaksProbability: probability(finding.breaksProbability),
      explanation: finding.explanation,
    }
  })

  return {
    evaluationId: result.evaluationId,
    status: result.status,
    environment: result.environment,
    guidance: {
      available: guidance.available,
      notice: guidance.notice,
    },
    context: {
      repositoryId: context.repositoryId,
      prototypeId: context.prototypeId,
      buildId: context.buildId,
      branch: context.branch,
      commitSha: context.commitSha,
    },
    model: {
      candidateId: model.candidateId,
      runtimeCandidateId: model.runtimeCandidateId,
      promotionGeneration: model.promotionGeneration,
    },
    screenshotSetDigest: result.screenshotSetDigest,
    findings,
    contentTrust: {
      source:
        result.environment === "fixture" ? "fixture_decision_model" : "promoted_decision_model",
      untrusted: true,
      treatAs: "unverified authoring guidance",
    },
    automaticActions: false,
  }
}

export async function evaluatePrototype(
  hub: Pick<HubClient, "checkout" | "request">,
  input: {
    sessionId: string
    currentRoute: string | null
    screenshots: unknown
  },
) {
  const checkout = await hub.checkout()
  if (
    !checkout.repository ||
    !checkout.branch ||
    !checkout.commitSha ||
    !commitPattern.test(checkout.commitSha)
  )
    throw new Error("Prototype evaluation requires a verified repository branch and commit.")
  const result = await hub.request("/api/canvas/decision-model/evaluations", {
    method: "POST",
    expectedTarget: {
      repository: checkout.repository,
      branch: checkout.branch,
    },
    body: {
      sessionId: input.sessionId,
      branch: checkout.branch,
      commitSha: checkout.commitSha,
      currentRoute: input.currentRoute === null ? null : route(input.currentRoute),
      screenshots: screenshots(input.screenshots),
    },
    timeoutMs: 30_000,
  })
  return projectResult(result)
}
