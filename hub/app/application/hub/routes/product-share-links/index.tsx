import { data, useFetcher, useLocation, useOutletContext } from "react-router"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"

import { ShareLinksIndexPage } from "@pages/share-links-index-page"

import type { WorkspaceResponse } from "../../contracts"
import {
  productLinkCreatedResponseSchema,
  productMutationResponseSchema,
  productShareIdSchema,
  productShareInputSchema,
  productSharingResponseSchema,
} from "../../product-contracts"
import type { ProductActionResult, ProductSharingResponse } from "../../product-contracts"
import { readRouteIdentifier } from "../../read-route-identifier"
import { readRouteQuery } from "../../read-route-query"
import { ProductFormBoundary } from "../../screens/product-form-boundary"
import { productShareLinksData } from "../../view-models/product-share-links"
import { productActionError } from "../product-action-error"
import { requestProductJson } from "../product-request"

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRouteIdentifier(params.repositoryId, "repository")
  const prototypeId = readRouteIdentifier(params.prototypeId, "prototype")
  const build = readRouteQuery(request).build
  return requestProductJson(
    request,
    `/api/repositories/${repositoryId}/prototypes/${prototypeId}/share-links${build ? `?build=${build}` : ""}`,
    productSharingResponseSchema,
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
  const prototypeId = readRouteIdentifier(params.prototypeId, "prototype")
  const base = `/repositories/${repositoryId}/prototypes/${prototypeId}/share-links`
  const form = await request.formData()
  const actionValue = form.get("_action")
  const action = typeof actionValue === "string" ? actionValue.split("?")[0] : null
  try {
    if (action === base && !form.has("_method")) {
      const parsed = productShareInputSchema.safeParse({
        label: form.get("share_link[label]"),
        expiration: form.get("share_link[expiration]"),
        buildNumber: Number(form.get("share_link[build_number]")),
      })
      if (!parsed.success) {
        return data<ProductActionResult>(
          { saved: false, error: parsed.error.issues.map(({ message }) => message).join(" ") },
          { status: 422 },
        )
      }
      const response = await requestProductJson(
        request,
        `/api${base}`,
        productLinkCreatedResponseSchema,
        { method: "POST", body: parsed.data },
      )
      return data<ProductActionResult>({ saved: true, notice: response.notice })
    }
    if (action?.startsWith(`${base}/`) && form.get("_method") === "delete") {
      const shareId = productShareIdSchema.safeParse(action.slice(base.length + 1))
      if (shareId.success) {
        const response = await requestProductJson(
          request,
          `/api${base}/${shareId.data}`,
          productMutationResponseSchema,
          { method: "DELETE" },
        )
        return data<ProductActionResult>({ saved: true, notice: response.notice })
      }
    }
    return data<ProductActionResult>(
      { saved: false, error: "This share-link action is not connected." },
      { status: 400 },
    )
  } catch (error) {
    return productActionError(error)
  }
}

export function meta({ loaderData }: { loaderData?: ProductSharingResponse }) {
  return [
    {
      title: loaderData
        ? `${loaderData.resource.prototype.name} share links - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function ProductShareLinksRoute({
  loaderData,
}: {
  loaderData: ProductSharingResponse
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
      <ShareLinksIndexPage
        busy={busy}
        data={productShareLinksData(
          workspace,
          loaderData,
          new URLSearchParams(location.search),
          window.location.origin,
        )}
      />
    </ProductFormBoundary>
  )
}
