import { useLocation, useOutletContext } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { NewPrototypePage } from "@pages/new-prototype-page"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { productCatalogResponseSchema } from "@application/hub/product-contracts"
import type { ProductCatalogResponse } from "@application/hub/product-contracts/types"
import { readRouteIdentifier } from "@application/hub/read-route-identifier"
import { productNewData } from "@application/hub/view-models/product-new-data"

import { requestProductJson } from "../request-product-json"

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRouteIdentifier(params.repositoryId, "repository")
  return requestProductJson(
    request,
    `/api/repositories/${repositoryId}/templates`,
    productCatalogResponseSchema,
  )
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

export default function ProductNew({ loaderData }: { loaderData: ProductCatalogResponse }) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  return (
    <NewPrototypePage
      data={productNewData(workspace, loaderData, new URLSearchParams(location.search))}
      submissionDisabled={!loaderData.canCreate}
    />
  )
}
