import type { ReactNode } from "react"
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useFetcher,
  useFetchers,
  useRouteError,
} from "react-router"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import type { Route } from "./+types/root"
import type { SessionResponse } from "./session-contracts/types"
import { DevelopmentTools } from "./development-tools"
import { HubNavigation } from "./hub-navigation"
import { getSession } from "./requests/get-session"
import { RouteFeedback } from "./route-feedback"
import { RouteErrorFeedback } from "./route-error-feedback"

import "@/tokens/base.css"
import "./styles.css"

export async function clientLoader({
  request,
}: Pick<Route.ClientLoaderArgs, "request">): Promise<SessionResponse | null> {
  return import.meta.env.DEV && import.meta.env.MODE === "mock" ? getSession(request) : null
}

export function meta() {
  return [{ title: "Replica Hub" }]
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
          <div className="hub-app-frame">
            <div id="app">{children}</div>
            <DevelopmentTools />
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
    <RouteFeedback kind="loading" heading="Loading Hub" description="Loading your workspace." />
  )
}

export function ErrorBoundary() {
  const error: unknown = useRouteError()
  return (
    <HubNavigation>
      <RouteErrorFeedback error={error} />
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
        void sessionFetcher.submit({ intent: "sign-out" }, { method: "post", action: "/session" })
      }}
    >
      {changingSession ? <HydrateFallback /> : null}
      <div className="hub-route-outlet" hidden={changingSession} inert={changingSession}>
        <Outlet key={loaderData?.viewer?.id} context={loaderData} />
      </div>
    </HubNavigation>
  )
}
