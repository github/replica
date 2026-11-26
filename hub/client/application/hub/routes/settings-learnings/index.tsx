import { useEffect, useRef, useState } from "react"
import { data, useFetcher, useOutletContext, useRevalidator } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { LearningsPage } from "@pages/learnings-page"
import { recordIdentifierSchema, workspaceResponseSchema } from "@application/hub/contracts"
import {
  decisionBuildEvaluationMutationResponseSchema,
  decisionCandidateRejectionMutationResponseSchema,
  decisionModelConfigurationResponseSchema,
  decisionModelOverviewResponseSchema,
  decisionPromotionMutationResponseSchema,
  decisionTrainingJobResponseSchema,
  decisionTrainingMutationResponseSchema,
  decisionTrainingRequestResponseSchema,
} from "@application/hub/decision-model-contracts"
import type { DecisionModelAvailability } from "@application/hub/decision-model-contracts/types"
import type { DecisionTrainingJobResponse } from "@application/hub/decision-model-contracts/types"
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
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = { workspaceSection: "learnings" } satisfies WorkspaceRouteHandle

type LearningActionResult = ProductActionResult & {
  revalidate?: boolean
  trainingJobId?: string
  trainingJob?: DecisionTrainingJobResponse
}

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
  // The decision model needs both roles, so skip a request that can only be refused.
  if (
    !response.accessDenied &&
    response.capabilities.administerHub &&
    response.capabilities.administerRepository
  ) {
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
        ? {
            notice: (
              await requestProductJson(
                request,
                `/api/repositories/${id}/learnings/runs`,
                learningMutationResponseSchema,
                { method: "POST" },
              )
            ).notice,
          }
        : source.pathname.startsWith(`${route}/decision-model/`)
          ? await submitDecisionModelAction(request, id, route, source, form)
          : {
              notice: (await submitDecision(request, id, route, source, form)).notice,
            }
    return data<LearningActionResult>({ saved: true, ...response })
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
    return {
      notice: enabled
        ? "Decision-model settings were saved and training is enabled."
        : "Decision-model settings were saved and training is paused.",
    }
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
    return {
      notice: response.created
        ? "Training was queued within the confirmed repository budget."
        : "This training request was already queued.",
      trainingJob: response.job,
      trainingJobId: response.job.id,
    }
  }
  if (source.pathname === `${prefix}/rollback`) {
    const expectedGeneration = Number(form.get("expectedGeneration"))
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/rollback`,
      decisionPromotionMutationResponseSchema,
      { method: "POST", body: { expectedGeneration } },
    )
    return { notice: "The previous decision model was restored as a new promotion generation." }
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
    return { notice: "The Build evaluation was saved with the promoted decision model." }
  }
  const cancel = source.pathname.match(new RegExp(`^${prefix}/training/([0-9a-f-]+)/cancel$`, "i"))
  if (cancel?.[1]) {
    await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/decision-model/training-jobs/${cancel[1]}/cancel`,
      decisionTrainingMutationResponseSchema,
      { method: "POST" },
    )
    return { notice: "Training cancellation was requested." }
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
    return { notice: "The reviewed candidate is now the promoted decision model." }
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
    return { notice: "The candidate was rejected and remains unavailable for promotion." }
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
  return <SettingsLearningsContent key={loaderData.repository.id} loaderData={loaderData} />
}

function SettingsLearningsContent({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>
}) {
  const workspace = workspaceResponseSchema.parse(useOutletContext<unknown>())
  const fetcher = useFetcher<LearningActionResult>()
  const revalidator = useRevalidator()
  const revalidateRef = useRef(revalidator.revalidate)
  const revalidatedResult = useRef<LearningActionResult | undefined>(undefined)
  const completedResult = useRef<LearningActionResult | undefined>(undefined)
  const loadedDecisionModel = loaderData.decisionModel
  const [previousLoadedDecisionModel, setPreviousLoadedDecisionModel] =
    useState(loadedDecisionModel)
  const [lastAvailableDecisionModel, setLastAvailableDecisionModel] = useState<
    Extract<DecisionModelAvailability, { state: "available" }> | undefined
  >(loadedDecisionModel?.state === "available" ? loadedDecisionModel : undefined)
  const [previousActionResult, setPreviousActionResult] = useState(fetcher.data)
  const [trackedTrainingJob, setTrackedTrainingJob] = useState<
    DecisionTrainingJobResponse | undefined
  >(fetcher.data?.saved ? fetcher.data.trainingJob : undefined)
  const [decisionModelActionRevision, setDecisionModelActionRevision] = useState(0)
  const busy = fetcher.state !== "idle" || revalidator.state !== "idle"
  const result = busy ? undefined : fetcher.data
  const action = fetcher.formData?.get("_action")
  const trainingSubmitting =
    fetcher.state !== "idle" &&
    typeof action === "string" &&
    action.endsWith("/decision-model/training")
  if (loadedDecisionModel !== previousLoadedDecisionModel) {
    setPreviousLoadedDecisionModel(loadedDecisionModel)
    if (loadedDecisionModel?.state === "available") {
      setLastAvailableDecisionModel(loadedDecisionModel)
    }
  }
  if (fetcher.data !== previousActionResult) {
    setPreviousActionResult(fetcher.data)
    if (fetcher.data?.saved && fetcher.data.trainingJob) {
      setTrackedTrainingJob(fetcher.data.trainingJob)
    }
  }
  const previousDecisionModel =
    loadedDecisionModel?.state === "available" ? loadedDecisionModel : lastAvailableDecisionModel
  const activeTrackedJob =
    trackedTrainingJob &&
    ["queued", "submitting", "cancel_requested", "submitted", "running"].includes(
      trackedTrainingJob.state,
    )
      ? trackedTrainingJob
      : undefined
  const activeTrackedJobId = activeTrackedJob?.id
  const transientLearningLock =
    loadedDecisionModel?.state === "unavailable" &&
    loadedDecisionModel.error === "Another learning operation is still running."
  const overviewWithTrackedJob =
    previousDecisionModel && trackedTrainingJob
      ? {
          ...previousDecisionModel.overview,
          jobs: [
            trackedTrainingJob,
            ...previousDecisionModel.overview.jobs.filter(
              (job) => job.id !== trackedTrainingJob.id,
            ),
          ],
        }
      : previousDecisionModel?.overview
  const decisionModel: DecisionModelAvailability | null =
    previousDecisionModel &&
    (trainingSubmitting || (transientLearningLock && activeTrackedJob)) &&
    (loadedDecisionModel?.state === "available" || transientLearningLock)
      ? {
          state: "available",
          overview: overviewWithTrackedJob!,
          preparationStatus: trainingSubmitting
            ? "Submitting the confirmed training request. Hub is preparing its private evidence."
            : `Status refresh is delayed while Hub prepares evidence. The last confirmed job state is ${activeTrackedJob?.state.replaceAll("_", " ")}.`,
        }
      : loadedDecisionModel?.state === "available" && overviewWithTrackedJob
        ? { ...loadedDecisionModel, overview: overviewWithTrackedJob }
        : loadedDecisionModel
  useEffect(() => {
    revalidateRef.current = revalidator.revalidate
  }, [revalidator.revalidate])
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
  useEffect(() => {
    if (!activeTrackedJobId) return
    const delays = [750, 1_500, 3_000, 5_000]
    const controller = new AbortController()
    let timer: number | undefined
    function schedule(attempt: number) {
      timer = window.setTimeout(
        () => {
          void requestProductJson(
            new Request(window.location.href, { signal: controller.signal }),
            `/api/repositories/${loaderData.repository.id}/decision-model/training-jobs/${activeTrackedJobId}`,
            decisionTrainingJobResponseSchema,
          )
            .then((current) => {
              setTrackedTrainingJob(current)
              if (["succeeded", "failed", "cancelled"].includes(current.state)) {
                void revalidateRef.current()
              } else {
                schedule(0)
              }
            })
            .catch(() => {
              if (!controller.signal.aborted) {
                schedule(Math.min(attempt + 1, delays.length - 1))
              }
            })
        },
        delays[Math.min(attempt, delays.length - 1)],
      )
    }
    schedule(0)
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [activeTrackedJobId, loaderData.repository.id])
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
        data={settingsLearnings(workspace, loaderData, decisionModel)}
        decisionModelActionRevision={decisionModelActionRevision}
        decisionModelTrainingSubmitting={trainingSubmitting}
      />
    </ProductFormBoundary>
  )
}
