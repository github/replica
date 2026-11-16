import { useEffect, useState } from "react"
import { Navigate } from "react-router"
import { z } from "zod"

import { currentHubSessionSchema } from "@application/hub/administrator-contracts"
import { noRepositoryAccessLocation } from "@application/hub/no-repository-access-location"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { useHubTheme } from "@hooks/use-hub-theme"
import { CurrentSessionPage } from "@pages/current-session-page"
import { HomeIndexPage } from "@pages/home-index-page"
import { HubAdminEnrollmentPage } from "@pages/hub-admin-enrollment-page"
import type { HomeSignInAction } from "@pages/home-index-page/types"
import { SessionLoadingPage } from "@pages/session-loading-page"

type SessionState =
  | { status: "loading" }
  | { status: "no-access"; location: string }
  | {
      status: "signed-out"
      providerDiscoveryFailed: boolean
      providers: HomeSignInAction["provider"][]
      restoreFailed: boolean
    }
  | {
      status: "signed-in"
      providerDiscoveryFailed: boolean
      providers: HomeSignInAction["provider"][]
      membershipId: string
      userId: string
      provider: string
      login: string
      name: string | null
      role: "MEMBER" | "ADMINISTRATOR"
    }

const providersSchema = z
  .object({
    providers: z.array(z.enum(["github", "entra", "local"])),
  })
  .strict()

const signInLabels: Record<HomeSignInAction["provider"], string> = {
  entra: "Sign in with Microsoft Entra",
  github: "Sign in with GitHub",
  local: "Sign in as local developer",
}

export function HubApplication() {
  const { resolvedColorMode } = useHubTheme()
  const [session, setSession] = useState<SessionState>({ status: "loading" })
  const authentication = new URLSearchParams(window.location.search).get("authentication")

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/auth/providers", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return { failed: false, providers: [] }
        if (!response.ok) throw new Error("Authentication provider discovery failed.")
        return { failed: false, ...providersSchema.parse(await response.json()) }
      })
      .catch(() => ({
        failed: true,
        providers: [] as HomeSignInAction["provider"][],
      }))
      .then(async (providerResult) => {
        if (controller.signal.aborted) return
        try {
          const response = await fetch("/api/auth/session", {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          })
          if (controller.signal.aborted) return
          if (response.status === 401 || response.status === 404) {
            if (
              response.status === 401 &&
              response.headers.get("content-type")?.includes("application/json")
            ) {
              const body: unknown = await response.json()
              if (controller.signal.aborted) return
              const location = noRepositoryAccessLocation(new ApiRequestError(401, "", body))
              if (location) {
                setSession({ status: "no-access", location })
                return
              }
            }
            setSession({
              status: "signed-out",
              providerDiscoveryFailed: providerResult.failed,
              providers: providerResult.providers,
              restoreFailed: authentication === "success",
            })
            return
          }
          if (!response.ok) throw new Error("Session restoration failed.")
          const parsed = currentHubSessionSchema.safeParse(await response.json())
          if (controller.signal.aborted) return
          if (!parsed.success) throw new Error("Session restoration returned an invalid response.")
          setSession({
            status: "signed-in",
            providerDiscoveryFailed: providerResult.failed,
            providers: providerResult.providers,
            ...parsed.data,
          })
        } catch {
          if (controller.signal.aborted) return
          setSession({
            status: "signed-out",
            providerDiscoveryFailed: providerResult.failed,
            providers: providerResult.providers,
            restoreFailed: true,
          })
        }
      })
    return () => controller.abort()
  }, [authentication])

  if (session.status === "loading") return <SessionLoadingPage />
  if (session.status === "no-access") return <Navigate to={session.location} replace />
  const providerActions = session.providers.map((provider) => ({
    label: signInLabels[provider],
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
          // The local developer is already an administrator, so it has no enrollment step.
          providerActions: providerActions.flatMap((action) =>
            action.provider === "local"
              ? []
              : [
                  {
                    ...action,
                    provider: action.provider,
                    label:
                      action.provider === "github"
                        ? "Verify with GitHub"
                        : "Verify with Microsoft Entra",
                    path: `/api/auth/${action.provider}/admin-enrollment/start`,
                  },
                ],
          ),
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
          administratorLabel:
            session.role === "ADMINISTRATOR" ? "Manage Hub administrators" : undefined,
          administratorPath:
            session.role === "ADMINISTRATOR" ? "/settings/administrators" : undefined,
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
              : authentication === "no_repository_access"
                ? "Your GitHub account cannot read any repository connected to this Hub. Ask a repository owner for access, then sign in again."
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
