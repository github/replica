import { useLayoutEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  Navigate,
  Outlet,
  redirect,
  useLocation,
  useMatches,
  useNavigation,
  useRevalidator,
} from "react-router"
import type { ShouldRevalidateFunctionArgs } from "react-router"

import { canvasConnectionsPath } from "@application/hub/canvas-connections/contract"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { noRepositoryAccessLocation } from "@application/hub/no-repository-access-location"
import { readWorkspaceRepositoryId } from "@application/hub/read-workspace-repository-id"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSession } from "@application/hub/requests/get-session"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import { RouteErrorFeedback } from "@application/hub/route-error-feedback"
import { RouteFeedback } from "@application/hub/route-feedback"
import { useWorkspaceRepositoryPermissions } from "@application/hub/use-workspace-repository-permissions"
import { hubWorkspace } from "@application/hub/view-models/hub-workspace"
import { WorkspaceCompletionContext } from "@application/hub/workspace-completion-context"
import { HubWorkspace } from "@features/hub-workspace"

import type { Route } from "./+types/index"
import type { WorkspaceRouteHandle } from "./types"

type WorkspaceData = {
  workspace: WorkspaceResponse
  repositoryNavigationError?: ApiRequestError | ApiContractError
}

function isMockMode() {
  return import.meta.env.DEV && import.meta.env.MODE === "mock"
}

async function restoreWorkspaceSession(request: Request) {
  try {
    return await getCurrentHubSession(request)
  } catch (error) {
    const noAccess = noRepositoryAccessLocation(error)
    if (noAccess) throw redirect(noAccess)
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 404)) {
      return null
    }
    throw error
  }
}

export async function clientLoader({
  request,
}: Pick<Route.ClientLoaderArgs, "request">): Promise<WorkspaceData | null> {
  const mock = isMockMode()
  const path = new URL(request.url).pathname.toLowerCase().replace(/\/+$/, "") || "/"
  if (mock && (path === "/" || path === "/repositories") && !(await getSession(request)).viewer) {
    throw redirect("/sign-in")
  }

  const session = !mock && path === "/" ? await restoreWorkspaceSession(request) : undefined
  if (session === null) return null
  const supportsSignedOut = !mock && (path === "/" || path === canvasConnectionsPath)

  try {
    return { workspace: await getWorkspace(request, mock ? undefined : "navigation") }
  } catch (error) {
    if (!(error instanceof ApiRequestError || error instanceof ApiContractError)) throw error
    if (error.status === 401) {
      if (supportsSignedOut) return null
      throw redirect(mock ? "/sign-in" : "/")
    }
    if (mock || error.status === 403) throw error

    // An independently authorized Hub page can still open when repository navigation fails.
    const current = session ?? (await restoreWorkspaceSession(request))
    if (!current) {
      if (supportsSignedOut) return null
      throw redirect("/")
    }
    return {
      workspace: {
        viewer: {
          id: current.userId,
          login: current.login,
          name: current.name,
          provider: current.provider,
          avatarUrl: null,
        },
        repositories: [],
        reviewInboxAvailable: current.reviewInboxAvailable,
        capabilities: {
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
          administerHub: current.role === "ADMINISTRATOR",
        },
      },
      repositoryNavigationError: error,
    }
  }
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (isMockMode()) return defaultShouldRevalidate
  // A different tab can change the session or its readable repositories without a Router action.
  return (
    defaultShouldRevalidate ||
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search !== nextUrl.search
  )
}

export default function Workspace({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  const matches = useMatches()
  const match = matches.at(-1)
  const handle = match?.handle as WorkspaceRouteHandle | undefined
  if (!loaderData && !handle?.signedOutEntry) {
    return <Navigate to="/" replace />
  }
  // Either API can observe session expiry while entering Canvas connections.
  if (!loaderData || (handle?.signedOutEntry === "canvas" && match?.loaderData === null)) {
    return <Outlet context={null} />
  }
  const { workspace } = loaderData
  const viewerKey = `${workspace.viewer.id}:${workspace.viewer.provider ?? ""}`
  if (isMockMode()) {
    return (
      <Outlet
        key={`${viewerKey}:${workspace.capabilities?.administerHub ?? false}`}
        context={workspace}
      />
    )
  }
  return <SignedInWorkspace key={viewerKey} data={loaderData} handle={handle} />
}

type WorkspaceFrameProps = {
  data: WorkspaceData
  handle?: WorkspaceRouteHandle
  inboxHasUnread?: boolean
}

function SignedInWorkspace({ data, handle }: WorkspaceFrameProps) {
  const { inboxHasUnread } = data.workspace
  const [lastUnread, setLastUnread] = useState(inboxHasUnread)
  if (inboxHasUnread !== undefined && inboxHasUnread !== lastUnread) {
    setLastUnread(inboxHasUnread)
  }

  return (
    <WorkspaceSession
      key={String(data.workspace.capabilities?.administerHub ?? false)}
      data={data}
      handle={handle}
      inboxHasUnread={inboxHasUnread ?? lastUnread}
    />
  )
}

function WorkspaceSession({ data, handle, inboxHasUnread }: WorkspaceFrameProps) {
  const { key } = useLocation()
  const navigationPending = useNavigation().state !== "idle"
  const revalidator = useRevalidator()
  const location = useRef({ key, navigationPending })
  const [completion, setCompletion] = useState<{
    key: string
    data: WorkspaceData
    page: ReactNode
  }>()
  useLayoutEffect(() => {
    location.current = { key, navigationPending }
  }, [key, navigationPending])

  if (completion) {
    if (completion.key === key || completion.data === data) return completion.page
    setCompletion(undefined)
  }

  return (
    <WorkspaceCompletionContext
      value={(page) => {
        if (location.current.key === key) setCompletion({ key, data, page })
        // A destination can already be loading with the prior session.
        if (location.current.key !== key || location.current.navigationPending) {
          void revalidator.revalidate()
        }
      }}
    >
      <WorkspaceNavigationFrame data={data} handle={handle} inboxHasUnread={inboxHasUnread} />
    </WorkspaceCompletionContext>
  )
}

function WorkspaceNavigationFrame({ data, handle, inboxHasUnread }: WorkspaceFrameProps) {
  const { pathname, search } = useLocation()
  const parameters = new URLSearchParams(search)
  const repositoryId = readWorkspaceRepositoryId({ pathname, searchParams: parameters })
  if (repositoryId) parameters.set("repositoryId", repositoryId)
  const { workspace, checkingWorkspace, retry } = useWorkspaceRepositoryPermissions(
    data.workspace,
    repositoryId,
  )
  const section = handle?.workspaceSection
  const navigation = hubWorkspace(workspace, parameters, section)

  if (checkingWorkspace) {
    return (
      <RouteFeedback
        kind="loading"
        heading="Refreshing Hub"
        description="Checking your workspace access."
      />
    )
  }
  return (
    <HubWorkspace
      contentResetKey={pathname}
      defaultNavigationCollapsed={handle?.defaultNavigationCollapsed}
      onRetryPermissions={retry}
      data={{
        ...navigation,
        notificationsUnread: inboxHasUnread,
        emptyRepositoryLabel: data.repositoryNavigationError
          ? "Repository navigation unavailable"
          : navigation.emptyRepositoryLabel,
        repositoryUnavailableMessage: data.repositoryNavigationError
          ? "Hub could not load repository navigation."
          : undefined,
        inboxPreviewScope: pathname,
      }}
    >
      {data.repositoryNavigationError && !handle?.independentOfRepositoryNavigation ? (
        <RouteErrorFeedback error={data.repositoryNavigationError} embedded />
      ) : (
        <Outlet context={workspace} />
      )}
    </HubWorkspace>
  )
}
