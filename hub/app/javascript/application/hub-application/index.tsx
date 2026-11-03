import { useEffect, useState } from "react"
import { z } from "zod"

import { useHubTheme } from "@hooks/use-hub-theme"
import { CurrentSessionPage } from "@pages/current-session-page"
import { HomeIndexPage } from "@pages/home-index-page"
import { HubAdminEnrollmentPage } from "@pages/hub-admin-enrollment-page"
import { SessionLoadingPage } from "@pages/session-loading-page"

type SessionState =
  | { status: "loading" }
  | { status: "signed-out"; restoreFailed: boolean }
  | { status: "signed-in"; role: "administrator" }

const currentSessionSchema = z
  .object({
    authenticated: z.literal(true),
    role: z.literal("administrator"),
  })
  .strict()

export function HubApplication() {
  const { resolvedColorMode } = useHubTheme()
  const [session, setSession] = useState<SessionState>({ status: "loading" })
  const authentication = new URLSearchParams(window.location.search).get("authentication")

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return { authenticated: false as const }
        if (!response.ok) throw new Error("Session restoration failed.")
        const parsed = currentSessionSchema.safeParse(await response.json())
        if (!parsed.success) throw new Error("Session restoration returned an invalid response.")
        return parsed.data
      })
      .then((result) =>
        setSession(
          result.authenticated
            ? { status: "signed-in", role: result.role }
            : { status: "signed-out", restoreFailed: authentication === "success" },
        ),
      )
      .catch(() => setSession({ status: "signed-out", restoreFailed: true }))
  }, [authentication])

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
          notice:
            authentication === "success"
              ? "GitHub sign-in succeeded and Replica Hub restored your active session."
              : null,
          roleLabel: "Administrator",
          signOutLabel: "Sign out",
          signOutPath: "/api/auth/session/sign-out",
        }}
      />
    )
  }
  if (session.status === "loading") return <SessionLoadingPage />
  return (
    <HomeIndexPage
      colorMode={resolvedColorMode}
      data={{
        alert: session.restoreFailed
          ? "Replica Hub could not restore your session. Sign in again to continue."
          : authentication === "denied"
            ? "GitHub could not complete sign-in, or this account is not an active Hub member."
            : null,
        authenticityToken: "",
        badge: "Collaborative prototyping",
        badgeAlternate: "Built for feedback",
        description: "Sign in with an active Replica Hub membership.",
        footerNote: "\u00a9 2026 GitHub, Inc.",
        heading: "Build and review prototypes with your team.",
        localMode: false,
        notice: null,
        pageTitle: "Replica Hub",
        pauseAnimationLabel: "Pause animation",
        resumeAnimationLabel: "Resume animation",
        signInLabel: "Sign in with GitHub",
        signInPath: "/api/auth/github/start",
      }}
    />
  )
}
