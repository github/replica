import { useEffect, useRef } from "react"
import { isRouteErrorResponse, useRevalidator } from "react-router"

import { ApiContractError } from "../requests/api-contract-error"
import { ApiRequestError } from "../requests/api-request-error"
import { RouteFeedback } from "../route-feedback"

export function RouteErrorFeedback({
  error,
  embedded = false,
}: {
  error: unknown
  embedded?: boolean
}) {
  const revalidator = useRevalidator()
  const feedback = useRef<HTMLDivElement>(null)
  let heading = "Unable to load Hub"
  let description = "An unexpected error occurred. Try again or return to repositories."
  let status: number | undefined

  if (isRouteErrorResponse(error)) {
    status = error.status
    if (typeof error.data === "string") description = error.data
  } else if (error instanceof ApiRequestError) {
    status = error.status || undefined
    description = error.message
    if (error.status === 0) heading = "Hub API unavailable"
  } else if (error instanceof ApiContractError) {
    heading = "Unexpected API response"
    description = error.message
    if (error.status >= 400) status = error.status
  }
  if (status === 404) heading = "Page or record not found"
  else if (status === 403) heading = "Access denied"
  else if (status === 401) heading = "Sign-in needed"
  else if (status === 400) heading = "Invalid address"

  useEffect(() => {
    console.error("The Hub route could not be loaded.")
    document.title = `${heading} - Replica Hub`
    feedback.current?.querySelector<HTMLElement>(".hub-route-feedback")?.focus()
  }, [error, heading])

  return (
    <div ref={feedback}>
      <RouteFeedback
        kind="error"
        heading={heading}
        description={description}
        embedded={embedded}
        status={status}
        onRetry={status === 404 ? undefined : () => void revalidator.revalidate()}
        retrying={revalidator.state !== "idle"}
      />
    </div>
  )
}
