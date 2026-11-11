import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { LearningsPage } from "@pages/learnings-page"
import { recordIdentifierSchema, workspaceResponseSchema } from "@application/hub/contracts"
import {
  learningDecisionInputSchema,
  learningMutationResponseSchema,
  learningsResponseSchema,
} from "@application/hub/learnings-contracts"
import type { ProductActionResult } from "@application/hub/product-contracts/types"
import { ProductFormBoundary } from "@application/hub/screens/product-form-boundary"
import { settingsLearnings } from "@application/hub/view-models/settings-learnings"

import { productActionError } from "../product-action-error"
import { requestProductJson } from "../request-product-json"

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
  return response
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
        : await submitDecision(request, id, route, source, form)
    return data<ProductActionResult>({ saved: true, notice: response.notice })
  } catch (error) {
    if (error instanceof Response) {
      return data<ProductActionResult>(
        { saved: false, error: await error.text() },
        { status: error.status },
      )
    }
    return productActionError(error)
  }
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

export function meta() {
  return [{ title: "Learnings - Replica Hub" }]
}

export default function SettingsLearnings({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof clientLoader>>
}) {
  const workspace = workspaceResponseSchema.parse(useOutletContext<unknown>())
  const location = useLocation()
  const fetcher = useFetcher<ProductActionResult>()
  const busy = fetcher.state !== "idle"
  const result = busy ? undefined : fetcher.data
  const search = new URLSearchParams(location.search)
  return (
    <ProductFormBoundary
      busy={busy}
      error={result?.saved === false ? result.error : null}
      notice={result?.saved ? result.notice : null}
      onSubmit={(input) => {
        void fetcher.submit(input, { method: "post" })
      }}
    >
      <LearningsPage data={settingsLearnings(workspace, loaderData, search)} />
    </ProductFormBoundary>
  )
}
