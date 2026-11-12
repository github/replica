import { redirect, useFetcher } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { HomeIndexPage } from "@pages/home-index-page"
import { FormBoundary } from "@application/hub/form-boundary"
import { getSession } from "@application/hub/requests/get-session"

import type { Route } from "./+types/index"

export async function clientLoader({ request }: Pick<Route.ClientLoaderArgs, "request">) {
  const session = await getSession(request)
  if (session.viewer) throw redirect("/")
  return null
}

export function meta() {
  return [{ title: "Replica Hub" }]
}

export default function SignIn() {
  const { resolvedColorMode } = useHubTheme()
  const fetcher = useFetcher()
  return (
    <FormBoundary
      busy={fetcher.state !== "idle"}
      onSubmit={() => {
        void fetcher.submit({ intent: "sign-in" }, { method: "post", action: "/session" })
      }}
    >
      <HomeIndexPage
        colorMode={resolvedColorMode}
        data={{
          authenticityToken: "",
          alert: null,
          notice: null,
          badge: "Collaborative prototyping",
          badgeAlternate: "Built for feedback",
          heading: "Build and review prototypes with your team.",
          description:
            "Replica Hub turns GitHub branches into shareable prototypes where your team can review changes and leave feedback.",
          signInActions: [
            {
              label: "Sign in with GitHub",
              path: "/session",
              provider: "github",
            },
          ],
          pageTitle: "Replica Hub",
          footerNote: "\u00a9 2026 GitHub, Inc.",
          pauseAnimationLabel: "Pause animation",
          resumeAnimationLabel: "Resume animation",
        }}
      />
    </FormBoundary>
  )
}
