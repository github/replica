import { useRef } from "react"
import { useLocation, useOutletContext } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { usePrototypeViewerUrl } from "@hooks/use-prototype-viewer-url"
import { ReplicaBrowsePage } from "@pages/replica-browse-page"
import type { AnchorReference } from "@utils/review-anchor/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import {
  productTemplateIdSchema,
  productTemplateResponseSchema,
} from "@application/hub/product-contracts"
import type { ProductTemplateResponse } from "@application/hub/product-contracts/types"
import { readRecordIdentifier } from "@application/hub/read-record-identifier"
import { authorizeCopilotHandoff } from "@application/hub/requests/authorize-copilot-handoff"
import { productBrowseData } from "@application/hub/view-models/product-browse-data"

import { requestProductJson } from "../request-product-json"

const EMPTY_ANCHORS: AnchorReference[] = []

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRecordIdentifier(params.repositoryId, "repository")
  const templateId = productTemplateIdSchema.safeParse(params.templateId)
  if (!templateId.success) throw new Response("Template not found.", { status: 404 })
  const url = new URL(`/api/repositories/${repositoryId}/templates/${templateId.data}`, request.url)
  if (!(import.meta.env.DEV && import.meta.env.MODE === "mock")) {
    const routes = new URL(request.url).searchParams.getAll("return_path")
    if (routes.length > 1) throw new Response("Template route not found.", { status: 404 })
    if (routes[0] !== undefined) url.searchParams.set("return_path", routes[0])
  }
  return requestProductJson(request, url.toString(), productTemplateResponseSchema)
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
  return (
    <TemplateScreen
      key={`${loaderData.repository.id}:${loaderData.template.id}`}
      loaderData={loaderData}
    />
  )
}

function TemplateScreen({ loaderData }: { loaderData: ProductTemplateResponse }) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const location = useLocation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedColorMode } = useHubTheme()
  const real = !(import.meta.env.DEV && import.meta.env.MODE === "mock")
  const pageData = productBrowseData(
    workspace,
    loaderData,
    new URLSearchParams(location.search),
    real,
  )
  const bridge = usePreviewBridge({
    iframeRef,
    previewUrl: pageData.selectedBuild?.previewUrl,
    previewTheme: resolvedColorMode,
    anchors: EMPTY_ANCHORS,
    reviewEnabled: false,
  })
  const viewer = usePrototypeViewerUrl({
    selectedBuild: pageData.selectedBuild,
    route: bridge.route,
    initiallyMinimized: pageData.minimizedPreview,
    buildSelection: "ignore",
    initialRoute: pageData.initialRoute,
    enabled: real,
  })
  return (
    <ReplicaBrowsePage
      data={pageData}
      iframeRef={iframeRef}
      previewTheme={resolvedColorMode}
      route={bridge.route}
      onFrameLoad={bridge.handleFrameLoad}
      initialMinimized={pageData.minimizedPreview}
      viewerUrl={real ? viewer.viewerUrl : undefined}
      minimized={real ? viewer.minimized : undefined}
      onMinimizedChange={real ? viewer.setMinimized : undefined}
      authorizeHandoff={real ? () => authorizeCopilotHandoff(loaderData.repository.id) : undefined}
    />
  )
}
