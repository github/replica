import { redirect, useFetcher } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { HomeIndexPage } from "@pages/home-index-page"

import { FlowFormBoundary } from "../../form-boundary"
import type { Route } from "./+types/index"
import { getSession } from "../../requests/get-session"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const session = await getSession(request)
  if (session.viewer) throw redirect("/")
  return null
}

export function meta() {
  return [{ title: "Mock sign-in - Replica Hub" }]
}

export default function SignInRoute() {
  const { resolvedColorMode } = useHubTheme()
  const fetcher = useFetcher()
  return (
    <FlowFormBoundary
      busy={fetcher.state !== "idle"}
      onSubmit={() => {
        void fetcher.submit({ profile: "owner" }, { method: "post", action: "/session" })
      }}
    >
      <HomeIndexPage
        colorMode={resolvedColorMode}
        data={{
          authenticityToken: "",
          alert: null,
          notice: null,
          badge: "Local mock frontend",
          badgeAlternate: "Explore with synthetic data",
          heading: "Try Replica",
          description: "Sign in as a synthetic user to explore this local frontend.",
          signInLabel: "Mock sign in as Octocat",
          signInPath: "/session",
          localMode: true,
          pageTitle: "Mock sign-in - Replica Hub",
          footerNote: "No credentials or real authentication. Reload resets the mock environment.",
          pauseAnimationLabel: "Pause animation",
          resumeAnimationLabel: "Resume animation",
        }}
      />
    </FlowFormBoundary>
  )
}
