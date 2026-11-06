import { useRef } from "react"
import { useLocation, useOutletContext } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { ReplicaBrowsePage } from "@pages/replica-browse-page"
import type { AnchorReference } from "@utils/review-anchor/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import {
  productTemplateIdSchema,
  productTemplateResponseSchema,
} from "@application/hub/product-contracts"
import type { ProductTemplateResponse } from "@application/hub/product-contracts/types"
import { readRouteIdentifier } from "@application/hub/read-route-identifier"
import { productBrowseData } from "@application/hub/view-models/product-browse-data"

import { requestProductJson } from "../request-product-json"

const EMPTY_ANCHORS: AnchorReference[] = []

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

export function meta({ loaderData }: { loaderData?: ProductTemplateResponse }) {
  return [
    {
      title: loaderData
        ? `${loaderData.template.name} template - ${loaderData.repository.nameWithOwner} - Replica Hub`
        : "Replica Hub",
    },
  ]
}

export default function ProductBrowse({ loaderData }: { loaderData: ProductTemplateResponse }) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedColorMode } = useHubTheme()
  const pageData = productBrowseData(workspace, loaderData, new URLSearchParams(location.search))
  const bridge = usePreviewBridge({
    iframeRef,
    previewUrl: pageData.selectedBuild?.previewUrl,
    previewTheme: resolvedColorMode,
    anchors: EMPTY_ANCHORS,
    reviewEnabled: false,
  })
  return (
    <ReplicaBrowsePage
      key={`${loaderData.repository.id}:${loaderData.template.id}`}
      data={pageData}
      iframeRef={iframeRef}
      previewTheme={resolvedColorMode}
      route={bridge.route}
      onFrameLoad={bridge.handleFrameLoad}
      initialMinimized={pageData.minimizedPreview}
    />
  )
}
