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
  if (
    (isRouteErrorResponse(error) ||
      error instanceof ApiRequestError ||
      error instanceof ApiContractError) &&
    error.status === 401
  ) {
    return <Navigate to={noRepositoryAccessLocation(error) ?? "/"} replace />
  }
  return <RouteErrorFeedback error={error} embedded={Boolean(workspace)} />
}

export default function WorkspaceContent() {
  return <Outlet context={useOutletContext<WorkspaceResponse | null>()} />
}
