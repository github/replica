import type { ReactNode } from "react"
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { HubNavigation } from "./hub-navigation"
import { RouteFeedback } from "./route-feedback"
import { RouteErrorFeedback } from "./route-error-feedback"

import "@/tokens/base.css"
import "./styles.css"

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

export default function HubRoot() {
  return (
    <HubNavigation>
      <div className="hub-route-outlet">
        <Outlet />
      </div>
    </HubNavigation>
  )
}
