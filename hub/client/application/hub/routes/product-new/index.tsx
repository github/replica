import { useLocation, useOutletContext } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { NewPrototypePage } from "@pages/new-prototype-page"

import type { WorkspaceResponse } from "../../contracts/types"
import { productCatalogResponseSchema } from "../../product-contracts"
import type { ProductCatalogResponse } from "../../product-contracts/types"
import { readRouteIdentifier } from "../../read-route-identifier"
import { productNewData } from "../../view-models/product-new"
import { requestProductJson } from "../product-request"

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

export default function ProductNewRoute({ loaderData }: { loaderData: ProductCatalogResponse }) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  return (
    <NewPrototypePage
      data={productNewData(workspace, loaderData, new URLSearchParams(location.search))}
      submissionDisabled={!loaderData.canCreate}
    />
  )
}
