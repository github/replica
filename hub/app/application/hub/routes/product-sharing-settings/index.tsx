import { data, useFetcher, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { SharingSettingsPage } from "@pages/sharing-settings-page"

import type { WorkspaceResponse } from "../../contracts"
import {
  productMutationResponseSchema,
  productSharingSettingsInputSchema,
  productSharingSettingsSchema,
} from "../../product-contracts"
import type { ProductActionResult, ProductSharingSettings } from "../../product-contracts"
import { ProductFormBoundary } from "../../screens/product-form-boundary"
import { productSharingSettingsData } from "../../view-models/product-sharing-settings"
import { productActionError } from "../product-action-error"
import { requestProductJson } from "../product-request"

export function clientLoader({ request }: Pick<LoaderFunctionArgs, "request">) {
  return requestProductJson(request, "/api/product/sharing-settings", productSharingSettingsSchema)
}

export async function clientAction({ request }: Pick<ActionFunctionArgs, "request">) {
  if (request.method.toUpperCase() !== "POST") {
    return data<ProductActionResult>(
      { saved: false, error: "Method not allowed." },
      { status: 405 },
    )
  }
  const form = await request.formData()
  const action = form.get("_action")
  if (
    typeof action !== "string" ||
    action.split("?")[0] !== "/admin/sharing" ||
    form.get("_method") !== "patch"
  ) {
    return data<ProductActionResult>(
      { saved: false, error: "This sharing-settings action is not connected." },
      { status: 400 },
    )
  }
  const parsed = productSharingSettingsInputSchema.safeParse({
    operation: form.get("operation"),
    confirmed: form.get("confirmed") === "1",
  })
  if (!parsed.success) {
    return data<ProductActionResult>(
      { saved: false, error: "Confirm the current mock sharing change." },
      { status: 422 },
    )
  }
  try {
    const response = await requestProductJson(
      request,
      "/api/product/sharing-settings",
      productMutationResponseSchema,
      { method: "PATCH", body: parsed.data },
    )
    return data<ProductActionResult>({ saved: true, notice: response.notice })
  } catch (error) {
    return productActionError(error)
  }
}

export function meta({ loaderData }: { loaderData?: ProductSharingSettings }) {
  return [{ title: loaderData ? "Public sharing - Replica Hub" : "Replica Hub" }]
}

export default function ProductSharingSettingsRoute({
  loaderData,
}: {
  loaderData: ProductSharingSettings
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
      <SharingSettingsPage data={productSharingSettingsData(workspace, loaderData)} busy={busy} />
    </ProductFormBoundary>
  )
}
