import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { PrototypeManagementPage } from "@pages/prototype-management-page"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import {
  productManagementResponseSchema,
  productMetadataInputSchema,
  productMutationResponseSchema,
} from "@application/hub/product-contracts"
import type {
  ProductActionResult,
  ProductManagementResponse,
} from "@application/hub/product-contracts/types"
import { readRouteIdentifier } from "@application/hub/read-route-identifier"
import { ProductFormBoundary } from "@application/hub/screens/product-form-boundary"
import { productManagementData } from "@application/hub/view-models/product-management-data"

import { productActionError } from "../product-action-error"
import { requestProductJson } from "../request-product-json"

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRouteIdentifier(params.repositoryId, "repository")
  return requestProductJson(
    request,
    `/api/repositories/${repositoryId}/prototype-management`,
    productManagementResponseSchema,
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
  const actionValue = form.get("_action")
  const action = typeof actionValue === "string" ? actionValue.split("?")[0] : null
  const match = action?.match(
    new RegExp(`^/repositories/${repositoryId}/(prototypes|candidates)/([1-9]\\d*)/registration$`),
  )
  if (!match || form.get("_method") !== "patch") {
    return data<ProductActionResult>(
      { saved: false, error: "This prototype management action is not connected." },
      { status: 400 },
    )
  }
  const description = form.get("prototype[description]")
  const startPage = form.get("prototype[start_page]")
  const parsed = productMetadataInputSchema.safeParse({
    name: form.get("prototype[name]"),
    description: typeof description === "string" ? description.trim() || null : description,
    startPage: typeof startPage === "string" ? startPage.trim() || null : startPage,
  })
  if (!parsed.success) {
    return data<ProductActionResult>(
      { saved: false, error: parsed.error.issues.map(({ message }) => message).join(" ") },
      { status: 422 },
    )
  }
  const candidate = match[1] === "candidates"
  const endpoint = candidate ? "prototype-candidates" : "prototype-management"
  try {
    const response = await requestProductJson(
      request,
      `/api/repositories/${repositoryId}/${endpoint}/${match[2]}`,
      productMutationResponseSchema,
      { method: candidate ? "POST" : "PATCH", body: parsed.data },
    )
    return data<ProductActionResult>({ saved: true, notice: response.notice })
  } catch (error) {
    return productActionError(error)
  }
}

export function meta({ loaderData }: { loaderData?: ProductManagementResponse }) {
  return [
    {
      title: loaderData
        ? `Edit prototype listings - ${loaderData.repository.nameWithOwner} - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function ProductManagement({
  loaderData,
}: {
  loaderData: ProductManagementResponse
}) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  const fetcher = useFetcher<ProductActionResult>()
  const busy = fetcher.state !== "idle"
  const result = busy ? undefined : fetcher.data
  return (
    <ProductFormBoundary
      busy={busy}
      error={result?.saved === false ? result.error : null}
      notice={result?.saved ? result.notice : null}
      onSubmit={(input) => {
        void fetcher.submit(input, { method: "post" })
      }}
    >
      <PrototypeManagementPage
        data={productManagementData(workspace, loaderData, new URLSearchParams(location.search))}
        saving={busy}
        saveError={result?.saved === false ? result.error : null}
        saved={result?.saved}
        readOnly={!loaderData.canCreate}
      />
    </ProductFormBoundary>
  )
}
