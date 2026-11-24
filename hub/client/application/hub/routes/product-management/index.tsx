import { data, useFetcher, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { PrototypeManagementPage } from "@pages/prototype-management-page"
import { prototypeEditSchema, recordIdentifierSchema } from "@application/hub/contracts"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { productManagementResponseSchema } from "@application/hub/product-contracts"
import type {
  ProductActionResult,
  ProductManagementResponse,
} from "@application/hub/product-contracts/types"
import { readRecordIdentifier } from "@application/hub/read-record-identifier"
import { updatePrototype } from "@application/hub/requests/update-prototype"
import { ProductFormBoundary } from "@application/hub/screens/product-form-boundary"
import { productManagementData } from "@application/hub/view-models/product-management-data"

import { productActionError } from "../product-action-error"
import { requestProductJson } from "../request-product-json"
import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = { workspaceSection: "prototypes" } satisfies WorkspaceRouteHandle

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRecordIdentifier(params.repositoryId, "repository")
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
  const repositoryId = readRecordIdentifier(params.repositoryId, "repository")
  const form = await request.formData()
  const actionValue = form.get("_action")
  const action = typeof actionValue === "string" ? actionValue.split("?")[0] : null
  const match = action?.match(
    new RegExp(`^/repositories/${repositoryId}/prototypes/([^/]+)/registration$`),
  )
  if (
    !match ||
    !recordIdentifierSchema.safeParse(match[1]).success ||
    form.get("_method") !== "patch"
  ) {
    return data<ProductActionResult>(
      { saved: false, error: "This prototype management action is not connected." },
      { status: 400 },
    )
  }
  const description = form.get("prototype[description]")
  const startPage = form.get("prototype[start_page]")
  const input = {
    name: form.get("prototype[name]"),
    description: typeof description === "string" ? description.trim() || null : description,
    startPage: typeof startPage === "string" ? startPage.trim() || null : startPage,
  }
  const parsed = prototypeEditSchema.safeParse(input)
  if (!parsed.success) {
    return data<ProductActionResult>(
      { saved: false, error: parsed.error.issues.map(({ message }) => message).join(" ") },
      { status: 422 },
    )
  }
  try {
    const prototypeId = readRecordIdentifier(match[1], "prototype")
    await updatePrototype(request, repositoryId, prototypeId, parsed.data, true)
    return data<ProductActionResult>({ saved: true, notice: "Prototype listing saved." })
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
        data={productManagementData(workspace, loaderData)}
        saving={busy}
        saveError={result?.saved === false ? result.error : null}
        saved={result?.saved}
        readOnly={!loaderData.canManage}
      />
    </ProductFormBoundary>
  )
}
