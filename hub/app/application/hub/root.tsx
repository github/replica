import { useEffect } from "react"
import type { ReactNode } from "react"
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import "@/tokens/base.css"

import type { Route } from "./+types/root"
import type { WorkspaceResponse } from "./contracts"
import { ModeNotice } from "./mode-notice"
import { HubNavigation } from "./navigation"
import { ApiContractError } from "./requests/api-contract-error"
import { ApiRequestError } from "./requests/api-request-error"
import { getWorkspace } from "./requests/get-workspace"
import { RouteFeedback } from "./route-feedback"

import "./styles.css"

const mockMode = import.meta.env.DEV && import.meta.env.MODE === "mock"

export async function clientLoader({
  request,
}: Pick<Route.ClientLoaderArgs, "request">): Promise<WorkspaceResponse> {
  return getWorkspace(request)
}

export function meta() {
  return [{ title: "Replica Hub" }]
}

function MockControls() {
  const [params, setParams] = useSearchParams()
  return (
    <ModeNotice
      scenario={params.get("mockScenario") ?? "normal"}
      onScenarioChange={(scenario) => {
        const next = new URLSearchParams(params)
        if (scenario === "normal") next.delete("mockScenario")
        else next.set("mockScenario", scenario)
        next.delete("page")
        setParams(next)
      }}
      onReset={() => window.location.reload()}
    />
  )
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        <HubThemeProvider>
          <div className={`hub-app-frame${mockMode ? " hub-app-frame--mock" : ""}`}>
            {mockMode ? <MockControls /> : null}
            <div id="app">{children}</div>
          </div>
        </HubThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export function HydrateFallback() {
  return (
    <RouteFeedback
      kind="loading"
      heading="Loading Hub"
      description="Connecting the frontend to its API."
    />
  )
}

export function ErrorBoundary() {
  const error: unknown = useRouteError()
  const revalidator = useRevalidator()
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
    console.error("The Hub route could not be loaded.", error)
    document.title = `${heading} - Replica Hub`
    document.querySelector("main")?.focus()
  }, [error, heading])

  return (
    <HubNavigation>
      <RouteFeedback
        kind="error"
        heading={heading}
        description={description}
        status={status}
        onRetry={status === 404 ? undefined : () => void revalidator.revalidate()}
        retrying={revalidator.state !== "idle"}
      />
    </HubNavigation>
  )
}

export default function HubRoot({ loaderData }: Pick<Route.ComponentProps, "loaderData">) {
  return (
    <HubNavigation>
      <Outlet context={loaderData} />
    </HubNavigation>
  )
}
