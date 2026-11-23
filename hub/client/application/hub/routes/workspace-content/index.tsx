import {
  isRouteErrorResponse,
  Navigate,
  Outlet,
  useOutletContext,
  useRouteError,
} from "react-router"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { noRepositoryAccessLocation } from "@application/hub/no-repository-access-location"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { RouteErrorFeedback } from "@application/hub/route-error-feedback"

export function ErrorBoundary() {
  const error: unknown = useRouteError()
  const workspace = useOutletContext<WorkspaceResponse | null>()
  const mock = import.meta.env.DEV && import.meta.env.MODE === "mock"
  if (
    (isRouteErrorResponse(error) ||
      error instanceof ApiRequestError ||
      error instanceof ApiContractError) &&
    error.status === 401
  ) {
    return <Navigate to={noRepositoryAccessLocation(error) ?? (mock ? "/sign-in" : "/")} replace />
  }
  return <RouteErrorFeedback error={error} embedded={!mock && Boolean(workspace)} />
}

export default function WorkspaceContent() {
  return <Outlet context={useOutletContext<WorkspaceResponse | null>()} />
}
