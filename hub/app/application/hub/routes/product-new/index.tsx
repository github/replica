import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { HubAlert } from "@components/hub-alert"
import { NewPrototypePage } from "@pages/new-prototype-page"

import type { WorkspaceResponse } from "../../contracts"
import {
  productCatalogResponseSchema,
  productCreatedResponseSchema,
  productCreateInputSchema,
} from "../../product-contracts"
import type { ProductActionResult, ProductCatalogResponse } from "../../product-contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { ProductFormBoundary } from "../../screens/product-form-boundary"
import { productNewData } from "../../view-models/product-new"
import { resourcePath } from "../../view-models/resource-path"
import { productActionError } from "../product-action-error"
import { requestProductJson } from "../product-request"

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRouteIdentifier(params.repositoryId, "repository")
  return requestProductJson(
    request,
    `/api/repositories/${repositoryId}/templates`,
    productCatalogResponseSchema,
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
  const form = await request.formData()
  const action = form.get("_action")
  if (
    action !== null &&
    (typeof action !== "string" || action.split("?")[0] !== `/repositories/${repositoryId}/new`)
  ) {
    return data<ProductActionResult>(
      { saved: false, error: "This action is not connected to prototype creation." },
      { status: 400 },
    )
  }
  const parsed = productCreateInputSchema.safeParse({
    brief: form.get("brief"),
    description: form.get("description") ?? form.get("brief"),
    templateId: form.get("templateId"),
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

export function meta({ loaderData }: { loaderData?: ProductCatalogResponse }) {
  return [
    {
      title: loaderData
        ? `Create prototype - ${loaderData.repository.nameWithOwner} - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function ProductNewRoute({ loaderData }: { loaderData: ProductCatalogResponse }) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  const fetcher = useFetcher<ProductActionResult>()
  const busy = fetcher.state !== "idle"
  const result = busy ? undefined : fetcher.data
  const createdPath = result?.saved ? result.prototypePath : undefined
  return (
    <ProductFormBoundary
      busy={busy}
      error={result?.saved === false ? result.error : null}
      notice={result?.saved ? result.notice : null}
      feedback={
        createdPath || !loaderData.canCreate ? (
          <>
            {createdPath ? <a href={createdPath}>Open created mock prototype</a> : null}
            {!loaderData.canCreate ? (
              <HubAlert
                title="This mock profile can browse templates but cannot create prototypes."
                variant="warning"
              />
            ) : null}
          </>
        ) : null
      }
      onSubmit={(input) => {
        void fetcher.submit(input, { method: "post" })
      }}
    >
      <NewPrototypePage
        data={productNewData(workspace, loaderData, new URLSearchParams(location.search))}
        busy={busy}
        submissionDisabled={!loaderData.canCreate}
        onCreate={(input) => {
          void fetcher.submit(input, { method: "post" })
        }}
      />
    </ProductFormBoundary>
  )
}
