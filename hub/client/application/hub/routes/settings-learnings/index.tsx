import { useEffect, useRef, useState } from "react"
import { data, useFetcher, useLocation, useOutletContext, useRevalidator } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { LearningsPage } from "@pages/learnings-page"
import { recordIdentifierSchema, workspaceResponseSchema } from "@application/hub/contracts"
import {
  decisionBuildEvaluationMutationResponseSchema,
  decisionCandidateRejectionMutationResponseSchema,
  decisionModelConfigurationResponseSchema,
  decisionModelOverviewResponseSchema,
  decisionPromotionMutationResponseSchema,
  decisionTrainingMutationResponseSchema,
  decisionTrainingRequestResponseSchema,
} from "@application/hub/decision-model-contracts"
import type { DecisionModelAvailability } from "@application/hub/decision-model-contracts/types"
import {
  learningDecisionInputSchema,
  learningMutationResponseSchema,
  learningsResponseSchema,
} from "@application/hub/learnings-contracts"
import type { ProductActionResult } from "@application/hub/product-contracts/types"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { ProductFormBoundary } from "@application/hub/screens/product-form-boundary"
import { settingsLearnings } from "@application/hub/view-models/settings-learnings"

import { productActionError } from "../product-action-error"
import { requestProductJson } from "../request-product-json"

type LearningActionResult = ProductActionResult & { revalidate?: boolean }

function repositoryId(params: LoaderFunctionArgs["params"]) {
  const parsed = recordIdentifierSchema.safeParse(params.repositoryId)
  if (!parsed.success) throw new Response("Invalid repository identifier.", { status: 400 })
  return parsed.data
}

export async function clientLoader({ request, params }: LoaderFunctionArgs) {
  const id = repositoryId(params)
  const response = await requestProductJson(
    request,
    `/api/repositories/${id}/learnings`,
    learningsResponseSchema,
  )
  if (response.repository.id !== id) {
    throw new Response("This repository is not available.", { status: 404 })
  }
  let decisionModel: DecisionModelAvailability | null = null
  if (!response.accessDenied && response.capabilities.administerHub) {
    try {
      decisionModel = {
        state: "available",
        overview: await requestProductJson(
          request,
          `/api/repositories/${id}/decision-model`,
          decisionModelOverviewResponseSchema,
        ),
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        decisionModel = { state: "not-configured" }
      } else if (
        (error instanceof ApiRequestError && ![401, 403].includes(error.status)) ||
        error instanceof ApiContractError
      ) {
        decisionModel = { state: "unavailable", error: error.message }
      } else {
        throw error
      }
    }
  }
  return { ...response, decisionModel }
}

export async function clientAction({ request, params }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return data<ProductActionResult>(
      { saved: false, error: "Method not allowed." },
      { status: 405 },
    )
  }
  const id = repositoryId(params)
  const route = `/repositories/${id}/learnings`
  const form = await request.formData()
  const action = form.get("_action")
  if (typeof action !== "string") {
    return data<ProductActionResult>(
      { saved: false, error: "This learning action is not connected." },
      { status: 400 },
    )
  }
  const source = new URL(action, request.url)
  if (source.origin !== new URL(request.url).origin) {
    return data<ProductActionResult>(
      { saved: false, error: "External form destinations are not supported." },
      { status: 422 },
    )
  }
  try {
    const response =
      source.pathname === `${route}/runs`
        ? await requestProductJson(
            request,
            `/api/repositories/${id}/learnings/runs`,
            learningMutationResponseSchema,
            { method: "POST" },
          )
        : source.pathname.startsWith(`${route}/decision-model/`)
          ? {
              notice: await submitDecisionModelAction(request, id, route, source, form),
            }
          : await submitDecision(request, id, route, source, form)
    return data<ProductActionResult>({ saved: true, notice: response.notice })
  } catch (error) {
    if (error instanceof Response) {
      return data<LearningActionResult>(
        {
          saved: false,
          error: await error.text(),
          revalidate: [403, 404, 409].includes(error.status),
        },
        { status: error.status },
      )
    }
    if (error instanceof ApiRequestError && [403, 404, 409, 502, 503].includes(error.status)) {
      return data<LearningActionResult>(
        { saved: false, error: error.message, revalidate: true },
        { status: error.status },
      )
    }
    return productActionError(error)
  }
}

async function submitDecisionModelAction(
  request: Request,
  repositoryId: string,
  route: string,
  source: URL,
  form: FormData,
) {
  const prefix = `${route}/decision-model`
  if (source.pathname === `${prefix}/settings`) {
    const enabled = form.get("enabled") === "on"
    const backend = form.get("backend")
    const maxUpdates = Number(form.get("maxUpdates"))
    const maxSeconds = Number(form.get("maxSeconds"))
    const monthlyBudgetCredits = form.get("monthlyBudgetCredits")
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model`,
      decisionModelConfigurationResponseSchema,
      {
        method: "PATCH",
        body: { enabled, backend, maxUpdates, maxSeconds, monthlyBudgetCredits },
      },
    )
    return enabled
      ? "Decision-model settings were saved and training is enabled."
      : "Decision-model settings were saved and training is paused."
  }
  if (source.pathname === `${prefix}/training`) {
    const idempotencyKey = form.get("idempotencyKey")
    const expectedConfigurationGeneration = Number(form.get("expectedConfigurationGeneration"))
    const parsed = decisionTrainingRequestResponseSchema
    const response = await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/training-jobs`,
      parsed,
      { method: "POST", body: { idempotencyKey, expectedConfigurationGeneration } },
    )
    return response.created
      ? "Training was queued within the confirmed repository budget."
      : "This training request was already queued."
  }
  if (source.pathname === `${prefix}/rollback`) {
    const expectedGeneration = Number(form.get("expectedGeneration"))
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/rollback`,
      decisionPromotionMutationResponseSchema,
      { method: "POST", body: { expectedGeneration } },
    )
    return "The previous decision model was restored as a new promotion generation."
  }
  const evaluation = source.pathname.match(
    new RegExp(`^${prefix}/builds/([0-9a-f-]+)/evaluate$`, "i"),
  )
  if (evaluation?.[1]) {
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/builds/${evaluation[1]}/evaluation`,
      decisionBuildEvaluationMutationResponseSchema,
      { method: "POST" },
    )
    return "The Build evaluation was saved with the promoted decision model."
  }
  const cancel = source.pathname.match(new RegExp(`^${prefix}/training/([0-9a-f-]+)/cancel$`, "i"))
  if (cancel?.[1]) {
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/training-jobs/${cancel[1]}/cancel`,
      decisionTrainingMutationResponseSchema,
      { method: "POST" },
    )
    return "Training cancellation was requested."
  }
  const promotion = source.pathname.match(
    new RegExp(`^${prefix}/candidates/([0-9a-f-]+)/promote$`, "i"),
  )
  if (promotion?.[1]) {
    const expectedGeneration = Number(form.get("expectedGeneration"))
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/candidates/${promotion[1]}/promotion`,
      decisionPromotionMutationResponseSchema,
      { method: "POST", body: { expectedGeneration } },
    )
    return "The reviewed candidate is now the promoted decision model."
  }
  const rejection = source.pathname.match(
    new RegExp(`^${prefix}/candidates/([0-9a-f-]+)/reject$`, "i"),
  )
  if (rejection?.[1]) {
    const reason = form.get("reason")
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/candidates/${rejection[1]}/rejection`,
      decisionCandidateRejectionMutationResponseSchema,
      { method: "POST", body: { reason } },
    )
    return "The candidate was rejected and remains unavailable for promotion."
  }
  throw new Response("This decision-model action is not connected.", { status: 400 })
}

function submitDecision(
  request: Request,
  repositoryId: string,
  route: string,
  source: URL,
  form: FormData,
) {
  const prefix = `${route}/`
  const suffix = "/decision"
  if (!source.pathname.startsWith(prefix) || !source.pathname.endsWith(suffix)) {
    throw new Response("This learning action is not connected.", { status: 400 })
  }
  let learningId: string
  try {
    learningId = decodeURIComponent(source.pathname.slice(prefix.length, -suffix.length))
  } catch {
    throw new Response("Invalid learning identifier.", { status: 400 })
  }
  if (!learningId || learningId.includes("/")) {
    throw new Response("Invalid learning identifier.", { status: 400 })
  }
  const decision = form.get("decision")
  const input =
    decision === "accept"
      ? {
          decision,
          digest: form.get("digest"),
          ...(form.has("content") ? { content: form.get("content") } : {}),
        }
      : decision === "reject"
        ? { decision, digest: form.get("digest"), reason: form.get("reason") }
        : decision === "retire"
          ? { decision, reason: form.get("reason") }
          : { decision }
  const parsed = learningDecisionInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new Response(parsed.error.issues.map(({ message }) => message).join(" "), { status: 422 })
  }
  return requestProductJson(
    request,
    `/api/repositories/${repositoryId}/learnings/${encodeURIComponent(learningId)}/decision`,
    learningMutationResponseSchema,
    { method: "POST", body: parsed.data },
  )
}

export function meta({ loaderData }: { loaderData?: { repository: { nameWithOwner: string } } }) {
  return [
    {
      title: loaderData
        ? `Learnings - ${loaderData.repository.nameWithOwner} - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function SettingsLearnings({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>
}) {
  const workspace = workspaceResponseSchema.parse(useOutletContext<unknown>())
  const location = useLocation()
  const fetcher = useFetcher<LearningActionResult>()
  const revalidator = useRevalidator()
  const revalidatedResult = useRef<LearningActionResult | undefined>(undefined)
  const completedResult = useRef<LearningActionResult | undefined>(undefined)
  const [decisionModelActionRevision, setDecisionModelActionRevision] = useState(0)
  const busy = fetcher.state !== "idle" || revalidator.state !== "idle"
  const result = busy ? undefined : fetcher.data
  const search = new URLSearchParams(location.search)
  useEffect(() => {
    if (!result?.revalidate || revalidatedResult.current === result) return
    revalidatedResult.current = result
    void revalidator.revalidate()
  }, [result, revalidator])
  useEffect(() => {
    if (!result?.saved || completedResult.current === result) return
    completedResult.current = result
    setDecisionModelActionRevision((revision) => revision + 1)
  }, [result])
  return (
    <ProductFormBoundary
      busy={busy}
      error={result?.saved === false ? result.error : null}
      notice={result?.saved ? result.notice : null}
      onSubmit={(input) => {
        void fetcher.submit(input, { method: "post" })
      }}
    >
      <LearningsPage
        data={settingsLearnings(workspace, loaderData, loaderData.decisionModel, search)}
        decisionModelActionRevision={decisionModelActionRevision}
      />
    </ProductFormBoundary>
  )
}
