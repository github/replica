import { useEffect, useState } from "react"
import { z } from "zod"

import { useHubTheme } from "@hooks/use-hub-theme"
import { CurrentSessionPage } from "@pages/current-session-page"
import { HomeIndexPage } from "@pages/home-index-page"
import { HubAdminEnrollmentPage } from "@pages/hub-admin-enrollment-page"

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; role: "administrator" | "member" }

const currentSessionSchema = z
  .object({
    authenticated: z.literal(true),
    role: z.enum(["administrator", "member"]),
  })
  .strict()

export function HubApplication() {
  const { resolvedColorMode } = useHubTheme()
  const [session, setSession] = useState<SessionState>({ status: "loading" })
  const authentication = new URLSearchParams(window.location.search).get("authentication")

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return { authenticated: false as const }
        const parsed = currentSessionSchema.safeParse(await response.json())
        return parsed.success ? parsed.data : { authenticated: false as const }
      })
      .then((result) =>
        setSession(
          result.authenticated
            ? { status: "signed-in", role: result.role }
            : { status: "signed-out" },
        ),
      )
      .catch(() => setSession({ status: "signed-out" }))
  }, [])

  if (window.location.pathname === "/admin-enrollment") {
    return (
      <HubAdminEnrollmentPage
        data={{
          alert: authentication === "denied" ? "Administrator enrollment was denied." : null,
          productName: "Replica Hub",
          pageTitle: "Enroll a Hub administrator",
          heading: "Enroll a Hub administrator",
          description: "Enter the deployment bootstrap secret, then verify your GitHub identity.",
          secretLabel: "Bootstrap secret",
          submitLabel: "Verify with GitHub",
          submitPath: "/api/auth/github/admin-enrollment/start",
        }}
      />
    )
  }
  if (session.status === "signed-in") {
    return (
      <CurrentSessionPage
        data={{
          heading: "Signed in to Replica Hub",
          description: "This session is checked against your current Hub membership.",
          roleLabel: session.role === "administrator" ? "Administrator" : "Member",
          signOutLabel: "Sign out",
          signOutPath: "/api/auth/session/sign-out",
        }}
      />
    )
  }
  return (
    <HomeIndexPage
      colorMode={resolvedColorMode}
      data={{
        alert:
          authentication === "denied"
            ? "GitHub could not complete sign-in, or this account is not an active Hub member."
            : null,
        authenticityToken: "",
        badge: "Collaborative prototyping",
        badgeAlternate: "Built for feedback",
        description: "Sign in with an active Replica Hub membership.",
        footerNote: "\u00a9 2026 GitHub, Inc.",
        heading: "Build and review prototypes with your team.",
        localMode: false,
        notice:
          authentication === "success"
            ? "GitHub sign-in succeeded and Replica Hub created an active session."
            : null,
        pageTitle: "Replica Hub",
        pauseAnimationLabel: "Pause animation",
        resumeAnimationLabel: "Resume animation",
        signInLabel: "Sign in with GitHub",
        signInPath: "/api/auth/github/start",
      }}
    />
  )
}
