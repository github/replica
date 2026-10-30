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
  useFetcher,
  useFetchers,
  useNavigate,
  useRouteLoaderData,
  useRouteError,
  useSearchParams,
} from "react-router"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import "@/tokens/base.css"

import type { Route } from "./+types/root"
import type { SessionResponse } from "./session-contracts"
import { ModeNotice } from "./mode-notice"
import { HubNavigation } from "./navigation"
import { ApiContractError } from "./requests/api-contract-error"
import { ApiRequestError } from "./requests/api-request-error"
import { getSession } from "./requests/get-session"
import { RouteFeedback } from "./route-feedback"

import "./styles.css"

const mockMode = import.meta.env.DEV && import.meta.env.MODE === "mock"
const mockDestinations = [
  { path: "/welcome", label: "Welcome" },
  { path: "/notifications", label: "Notifications" },
  { path: "/repositories/2001", label: "Repository" },
  { path: "/repositories/2001/prototypes/1", label: "Prototype and reviews" },
  { path: "/repositories/2001/prototypes/1/builds", label: "Build history" },
  { path: "/repositories/2001/prototypes/1/builds/3", label: "Build details" },
  { path: "/repositories/2001/new", label: "Create a prototype" },
  { path: "/repositories/2001/templates/default", label: "Browse a template" },
  { path: "/repositories/2001/prototypes/manage", label: "Manage prototypes" },
  { path: "/repositories/2001/prototypes/1/share-links", label: "Share links" },
  { path: "/admin/sharing", label: "Sharing settings" },
  { path: "/shared/demo-active", label: "Public shared preview" },
  { path: "/shared/demo-expired", label: "Expired share link" },
  { path: "/shared/demo-revoked", label: "Revoked share link" },
  { path: "/settings/analytics", label: "Analytics" },
  { path: "/settings/learnings", label: "Learnings" },
  { path: "/settings/canvas", label: "Canvas connections" },
  { path: "/settings/canvas/approve", label: "Approve a mock connection" },
  { path: "/settings/copilot", label: "Copilot connection" },
  { path: "/settings/github", label: "GitHub App" },
  { path: "/settings/admins", label: "Administrators" },
  { path: "/settings/audit", label: "Activity" },
  { path: "/settings/github/setup", label: "GitHub App setup" },
  { path: "/settings/github/register", label: "Register a mock app" },
  { path: "/settings/github/installed", label: "Mock installation" },
  { path: "/settings/enroll", label: "Mock enrollment" },
  { path: "/settings/authorize", label: "Mock confirmation" },
  { path: "/settings/sessions", label: "End mock sessions" },
]

export async function clientLoader({
  request,
}: Pick<Route.ClientLoaderArgs, "request">): Promise<SessionResponse> {
  return getSession(request)
}

export function meta() {
  return [{ title: "Replica Hub" }]
}

function MockControls() {
  const [params, setParams] = useSearchParams()
  const session = useRouteLoaderData<SessionResponse>("root")
  const fetcher = useFetcher()
  const navigate = useNavigate()
  return (
    <ModeNotice
      profile={session?.profile ?? "owner"}
      sessionUnavailable={!session}
      changingProfile={fetcher.state !== "idle"}
      onProfileChange={(profile) => {
        void fetcher.submit({ profile }, { method: "post", action: "/session" })
      }}
      destinations={mockDestinations}
      onNavigate={(path) => {
        const destination = new URL(path, window.location.origin)
        const scenario = params.get("mockScenario")
        if (scenario) destination.searchParams.set("mockScenario", scenario)
        void navigate(`${destination.pathname}${destination.search}`)
      }}
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
  const fetchers = useFetchers()
  const sessionFetcher = useFetcher()
  const changingSession = fetchers.some(
    (fetcher) => fetcher.state !== "idle" && fetcher.formAction === "/session",
  )
  return (
    <HubNavigation
      onSignOut={() => {
        void sessionFetcher.submit(
          { profile: "signed-out" },
          { method: "post", action: "/session" },
        )
      }}
    >
      {changingSession ? <HydrateFallback /> : null}
      <div className="hub-route-outlet" hidden={changingSession} inert={changingSession}>
        <Outlet key={`${loaderData.profile}:${loaderData.revision}`} context={loaderData} />
      </div>
    </HubNavigation>
  )
}
