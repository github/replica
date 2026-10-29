import { useEffect, useState } from "react"

import { SignInPage } from "@pages/sign-in-page"
import type { SignInPageUser } from "@pages/sign-in-page/types"
import { MembershipAdministrationPage } from "@pages/membership-administration-page"
import type {
  InvitationRecord,
  MembershipRecord,
} from "@pages/membership-administration-page/types"

interface SessionResponse {
  authenticated: boolean
  configured: boolean
  provider: "github" | "oidc" | null
  providerLabel: string | null
  csrfToken: string
  user?: SignInPageUser
  membership?: {
    id: string
    role: "member" | "administrator"
    status: "active"
  }
}

interface AdministrationResponse {
  memberships: MembershipRecord[]
  invitations: InvitationRecord[]
}

async function fetchSession(): Promise<SessionResponse> {
  const response = await fetch("/api/session", { credentials: "same-origin" })
  if (!response.ok) throw new Error("Session request failed")
  return (await response.json()) as SessionResponse
}

export function AuthenticationApplication() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("reason") === "provider_role_changed"
      ? "Your provider role changed. Sign in again to update your Hub access."
      : null,
  )
  const [loading, setLoading] = useState(true)
  const [administration, setAdministration] = useState<AdministrationResponse | null>(null)

  useEffect(() => {
    fetchSession()
      .then(async (value) => {
        setSession(value)
        if (value.membership?.role === "administrator") {
          const response = await fetch("/api/administration", { credentials: "same-origin" })
          if (!response.ok) throw new Error("Administration request failed")
          setAdministration((await response.json()) as AdministrationResponse)
        }
      })
      .catch(() => setError("Hub could not load your sign-in status."))
      .finally(() => setLoading(false))
  }, [])

  async function signIn() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      if (!session.provider) throw new Error("Sign-in provider is not configured")
      const response = await fetch(`/api/auth/${session.provider}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": session.csrfToken },
      })
      if (!response.ok) throw new Error("Sign-in request failed")
      const data = (await response.json()) as { authorizationUrl: string }
      window.location.assign(data.authorizationUrl)
    } catch {
      setError("Hub could not start sign-in.")
      setLoading(false)
    }
  }

  async function startEnrollment(purpose: "bootstrap" | "recovery", secret: string) {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/auth/${purpose}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({ secret }),
      })
      if (!response.ok) throw new Error("Enrollment is unavailable.")
      const data = (await response.json()) as { authorizationUrl: string }
      window.location.assign(data.authorizationUrl)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Enrollment is unavailable.")
      setLoading(false)
    }
  }

  async function signOut() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": session.csrfToken },
      })
      if (!response.ok) throw new Error("Sign-out request failed")
      setSession(await fetchSession())
      setAdministration(null)
    } catch {
      setError("Hub could not sign you out.")
    } finally {
      setLoading(false)
    }
  }

  async function startVerification() {
    if (!session) throw new Error("Session is unavailable.")
    const response = await fetch("/api/session/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": session.csrfToken },
    })
    if (!response.ok) throw new Error("Hub could not start verification.")
    const data = (await response.json()) as { authorizationUrl: string }
    window.location.assign(data.authorizationUrl)
  }

  async function updateAdministration(path: string, method: string, body?: unknown) {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string; message?: string }
        if (data.error === "fresh_authorization_required") {
          await startVerification()
          return
        }
        throw new Error(data.message ?? data.error ?? "Administration request failed")
      }
      const current = await fetchSession()
      setSession(current)
      if (current.membership?.role === "administrator") {
        const refreshed = await fetch("/api/administration", { credentials: "same-origin" })
        if (!refreshed.ok) throw new Error("Administration request failed")
        setAdministration((await refreshed.json()) as AdministrationResponse)
      } else {
        setAdministration(null)
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Hub could not update membership.",
      )
    } finally {
      setLoading(false)
    }
  }

  if (session?.authenticated && session.membership?.role === "administrator" && administration) {
    return (
      <MembershipAdministrationPage
        memberships={administration.memberships}
        invitations={administration.invitations}
        loading={loading}
        error={error}
        onInvite={(input) =>
          void updateAdministration("/api/administration/invitations", "POST", input)
        }
        onChange={(membershipId, input) =>
          void updateAdministration(
            `/api/administration/memberships/${membershipId}`,
            "PATCH",
            input,
          )
        }
        onRevokeInvitation={(invitationId) =>
          void updateAdministration(`/api/administration/invitations/${invitationId}`, "DELETE")
        }
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
      />
    )
  }

  return (
    <SignInPage
      configured={session?.configured ?? false}
      providerLabel={session?.providerLabel ?? null}
      loading={loading}
      user={session?.authenticated ? (session.user ?? null) : null}
      error={error}
      onSignIn={() => void signIn()}
      onSignOut={() => void signOut()}
      onBootstrap={(secret) => void startEnrollment("bootstrap", secret)}
      onRecovery={(secret) => void startEnrollment("recovery", secret)}
    />
  )
}
