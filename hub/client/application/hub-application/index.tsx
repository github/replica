import { useEffect, useState } from "react"
import { z } from "zod"

import { useHubTheme } from "@hooks/use-hub-theme"
import { CurrentSessionPage } from "@pages/current-session-page"
import { HomeIndexPage } from "@pages/home-index-page"
import { HubAdminEnrollmentPage } from "@pages/hub-admin-enrollment-page"
import { SessionLoadingPage } from "@pages/session-loading-page"

type SessionState =
  | { status: "loading" }
  | {
      status: "signed-out"
      providerDiscoveryFailed: boolean
      providers: Array<"github" | "entra">
      restoreFailed: boolean
    }
  | {
      status: "signed-in"
      providerDiscoveryFailed: boolean
      providers: Array<"github" | "entra">
      role: "MEMBER" | "ADMINISTRATOR"
    }

const currentSessionSchema = z
  .object({
    authenticated: z.literal(true),
    role: z.enum(["MEMBER", "ADMINISTRATOR"]),
  })
  .strict()
const providersSchema = z
  .object({
    providers: z.array(z.enum(["github", "entra"])),
  })
  .strict()

export function HubApplication() {
  const { resolvedColorMode } = useHubTheme()
  const [session, setSession] = useState<SessionState>({ status: "loading" })
  const authentication = new URLSearchParams(window.location.search).get("authentication")

  useEffect(() => {
    void fetch("/api/auth/providers", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return { failed: false, providers: [] }
        if (!response.ok) throw new Error("Authentication provider discovery failed.")
        return { failed: false, ...providersSchema.parse(await response.json()) }
      })
      .catch(() => ({
        failed: true,
        providers: [] as Array<"github" | "entra">,
      }))
      .then(async (providerResult) => {
        try {
          const response = await fetch("/api/auth/session", {
            credentials: "same-origin",
            cache: "no-store",
          })
          if (response.status === 401 || response.status === 404) {
            setSession({
              status: "signed-out",
              providerDiscoveryFailed: providerResult.failed,
              providers: providerResult.providers,
              restoreFailed: authentication === "success",
            })
            return
          }
          if (!response.ok) throw new Error("Session restoration failed.")
          const parsed = currentSessionSchema.safeParse(await response.json())
          if (!parsed.success) throw new Error("Session restoration returned an invalid response.")
          setSession({
            status: "signed-in",
            providerDiscoveryFailed: providerResult.failed,
            providers: providerResult.providers,
            role: parsed.data.role,
          })
        } catch {
          setSession({
            status: "signed-out",
            providerDiscoveryFailed: providerResult.failed,
            providers: providerResult.providers,
            restoreFailed: true,
          })
        }
      })
  }, [authentication])

  if (session.status === "loading") return <SessionLoadingPage />
  const providerActions = session.providers.map((provider) => ({
    label: provider === "github" ? "Sign in with GitHub" : "Sign in with Microsoft Entra",
    path: `/api/auth/${provider}/start`,
    provider,
  }))

  if (window.location.pathname === "/admin-enrollment") {
    return (
      <HubAdminEnrollmentPage
        data={{
          alert: session.providerDiscoveryFailed
            ? "Replica Hub could not load sign-in options. Reload the page to try again."
            : authentication === "denied"
              ? "Administrator enrollment was denied."
              : null,
          productName: "Replica Hub",
          pageTitle: "Enroll a Hub administrator",
          heading: "Enroll a Hub administrator",
          description: "Enter the deployment bootstrap secret, then verify your identity.",
          secretLabel: "Bootstrap secret",
          providerActions: providerActions.map((action) => ({
            ...action,
            label:
              action.provider === "github" ? "Verify with GitHub" : "Verify with Microsoft Entra",
            path: `/api/auth/${action.provider}/admin-enrollment/start`,
          })),
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
              ? "Sign-in succeeded and Replica Hub restored your active session."
              : null,
          roleLabel: session.role === "ADMINISTRATOR" ? "Administrator" : "Member",
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
        alert: session.providerDiscoveryFailed
          ? "Replica Hub could not load sign-in options. Reload the page to try again."
          : session.restoreFailed
            ? "Replica Hub could not restore your session. Sign in again to continue."
            : authentication === "denied"
              ? "Sign-in could not be completed, or this account is not an active Hub member."
              : null,
        authenticityToken: "",
        badge: "Collaborative prototyping",
        badgeAlternate: "Built for feedback",
        description: "Sign in with an active Replica Hub membership.",
        footerNote: "\u00a9 2026 GitHub, Inc.",
        heading: "Build and review prototypes with your team.",
        notice: null,
        pageTitle: "Replica Hub",
        pauseAnimationLabel: "Pause animation",
        resumeAnimationLabel: "Resume animation",
        signInActions: providerActions,
      }}
    />
  )
}
