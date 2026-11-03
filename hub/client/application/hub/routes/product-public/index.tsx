import type { LoaderFunctionArgs } from "react-router"

import { SharedBuildsShowPage } from "@pages/shared-builds-show-page"

import { productPublicResponseSchema, productShareIdSchema } from "../../product-contracts"
import type { ProductPublicResponse } from "../../product-contracts"
import { productPublicData } from "../../view-models/product-public"
import { requestProductJson } from "../product-request"

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const shareId = productShareIdSchema.safeParse(params.shareId)
  if (!shareId.success) throw new Response("Shared preview not found.", { status: 404 })
  return requestProductJson(request, `/api/shared/${shareId.data}`, productPublicResponseSchema)
}

export function meta({ loaderData }: { loaderData?: ProductPublicResponse }) {
  if (!loaderData) return [{ title: "Replica Hub" }]
  if (loaderData.state === "active") {
    return [
      {
        title: `${loaderData.prototypeName} - Build ${loaderData.buildNumber} shared preview - Replica Hub`,
      },
    ]
  }
  const stateLabel = {
    expired: "Expired shared preview",
    revoked: "Revoked shared preview",
    disabled: "Sharing disabled",
  }[loaderData.state]
  return [{ title: `${stateLabel} - Replica Hub` }]
}

export default function ProductPublicRoute({ loaderData }: { loaderData: ProductPublicResponse }) {
  return <SharedBuildsShowPage data={productPublicData(loaderData)} />
}
