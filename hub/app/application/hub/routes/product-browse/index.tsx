import { useRef } from "react"
import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { ReplicaBrowsePage } from "@pages/replica-browse-page"

import type { WorkspaceResponse } from "../../contracts"
import {
  productCreatedResponseSchema,
  productCreateInputSchema,
  productTemplateIdSchema,
  productTemplateResponseSchema,
} from "../../product-contracts"
import type { ProductActionResult, ProductTemplateResponse } from "../../product-contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { ProductFormBoundary } from "../../screens/product-form-boundary"
import { productBrowseData } from "../../view-models/product-browse"
import { resourcePath } from "../../view-models/resource-path"
import { productActionError } from "../product-action-error"
import { requestProductJson } from "../product-request"

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRouteIdentifier(params.repositoryId, "repository")
  const templateId = productTemplateIdSchema.safeParse(params.templateId)
  if (!templateId.success) throw new Response("Template not found.", { status: 404 })
  return requestProductJson(
    request,
    `/api/repositories/${repositoryId}/templates/${templateId.data}`,
    productTemplateResponseSchema,
  )
}

export async function clientAction({
  request,
  params,
}: Pick<ActionFunctionArgs, "request" | "params">) {
  if (request.method.toUpperCase() !== "POST") {
    return data<ProductActionResult>(
      { saved: false, error: "Method not allowed." },
      { status: 405 },
    )
  }
  const repositoryId = readRouteIdentifier(params.repositoryId, "repository")
  const templateId = productTemplateIdSchema.safeParse(params.templateId)
  if (!templateId.success) {
    return data<ProductActionResult>(
      { saved: false, error: "Template not found." },
      { status: 404 },
    )
  }
  const form = await request.formData()
  const action = form.get("_action")
  if (
    action !== null &&
    (typeof action !== "string" ||
      action.split("?")[0] !== `/repositories/${repositoryId}/templates/${templateId.data}`)
  ) {
    return data<ProductActionResult>(
      { saved: false, error: "This action is not connected to template creation." },
      { status: 400 },
    )
  }
  const parsed = productCreateInputSchema.safeParse({
    brief: form.get("brief"),
    description: form.get("brief"),
    templateId: templateId.data,
  })
  if (!parsed.success) {
    return data<ProductActionResult>(
      { saved: false, error: parsed.error.issues.map(({ message }) => message).join(" ") },
      { status: 422 },
    )
  }
  try {
    const response = await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/prototypes`,
      productCreatedResponseSchema,
      { method: "POST", body: parsed.data },
    )
    return data<ProductActionResult>({
      saved: true,
      notice: response.notice,
      prototypePath: resourcePath(
        `/repositories/${repositoryId}/prototypes/${response.resource.prototype.id}`,
        new URL(request.url).searchParams,
      ),
    })
  } catch (error) {
    return productActionError(error)
  }
}

export function meta({ loaderData }: { loaderData?: ProductTemplateResponse }) {
  return [
    {
      title: loaderData
        ? `${loaderData.template.name} template - ${loaderData.repository.nameWithOwner} - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function ProductBrowseRoute({
  loaderData,
}: {
  loaderData: ProductTemplateResponse
}) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedColorMode } = useHubTheme()
  const fetcher = useFetcher<ProductActionResult>()
  const busy = fetcher.state !== "idle"
  const result = busy ? undefined : fetcher.data
  return (
    <ProductFormBoundary
      busy={busy}
      error={result?.saved === false ? result.error : null}
      notice={result?.saved ? result.notice : null}
      feedback={
        result?.saved && result.prototypePath ? (
          <a href={result.prototypePath}>Open created mock prototype</a>
        ) : null
      }
      onSubmit={(input) => {
        void fetcher.submit(input, { method: "post" })
      }}
    >
      <ReplicaBrowsePage
        data={productBrowseData(workspace, loaderData, new URLSearchParams(location.search))}
        iframeRef={iframeRef}
        previewTheme={resolvedColorMode}
        busy={busy}
        onCreate={(brief) => {
          void fetcher.submit({ brief }, { method: "post" })
        }}
      />
    </ProductFormBoundary>
  )
}
