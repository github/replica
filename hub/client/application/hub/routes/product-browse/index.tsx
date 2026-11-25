import { useRef } from "react"
import { useLocation, useOutletContext } from "react-router"
import type { LoaderFunctionArgs } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { usePrototypeViewerUrl } from "@hooks/use-prototype-viewer-url"
import { ReplicaBrowsePage } from "@pages/replica-browse-page"
import type { AnchorReference } from "@utils/review-anchor/types"
import { readPreviewReturnPath } from "@utils/read-preview-return-path"
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
import type { WorkspaceRouteHandle } from "../workspace/types"

const EMPTY_ANCHORS: AnchorReference[] = []

export const handle = { workspaceSection: "new" } satisfies WorkspaceRouteHandle

export function clientLoader({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">) {
  const repositoryId = readRecordIdentifier(params.repositoryId, "repository")
  const templateId = productTemplateIdSchema.safeParse(params.templateId)
  if (!templateId.success) throw new Response("Template not found.", { status: 404 })
  const url = new URL(`/api/repositories/${repositoryId}/templates/${templateId.data}`, request.url)
  const search = new URL(request.url).searchParams
  const routes = search.getAll("return_path")
  const route = routes.length === 1 ? readPreviewReturnPath(routes[0]) : null
  if (routes.length && !route) throw new Response("Template route not found.", { status: 404 })
  if (route) {
    url.searchParams.set("return_path", route)
    if (search.get("return_path_kind") === "logical") {
      url.searchParams.set("return_path_kind", "logical")
    }
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
  const pageData = productBrowseData(workspace, loaderData, new URLSearchParams(location.search))
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
    previewMount: bridge.previewMount,
    initiallyMinimized: pageData.minimizedPreview,
    buildSelection: "ignore",
    initialRoute: pageData.initialRoute,
  })
  return (
    <ReplicaBrowsePage
      data={pageData}
      iframeRef={iframeRef}
      previewTheme={resolvedColorMode}
      route={bridge.route}
      previewMount={bridge.previewMount}
      previewReady={bridge.ready}
      onFrameLoad={bridge.handleFrameLoad}
      initialMinimized={pageData.minimizedPreview}
      viewerUrl={viewer.viewerUrl}
      minimized={viewer.minimized}
      onMinimizedChange={viewer.setMinimized}
      authorizeHandoff={() =>
        authorizeCopilotHandoff(loaderData.repository.id, { allowCopyFallback: true })
      }
    />
  )
}
