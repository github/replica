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
  csrfToken: string
  user?: SignInPageUser
  membership?: {
    id: string
    role: "member" | "administrator"
    status: "active"
  }
}

interface AdministrationResponse {
  memberships: {
    memberships: MembershipRecord[]
    nextCursor: string | null
  }
  invitations: {
    invitations: InvitationRecord[]
    nextCursor: string | null
  }
}

interface AdministrationErrorResponse {
  error?: string
  message?: string
}

class AdministrationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

async function fetchSession(): Promise<SessionResponse> {
  const response = await fetch("/api/session", { credentials: "same-origin" })
  if (!response.ok) throw new Error("Session request failed")
  return (await response.json()) as SessionResponse
}

async function fetchAdministration(cursors?: {
  memberships?: string | null
  invitations?: string | null
}): Promise<AdministrationResponse> {
  const query = new URLSearchParams()
  if (cursors?.memberships) query.set("membershipsCursor", cursors.memberships)
  if (cursors?.invitations) query.set("invitationsCursor", cursors.invitations)
  const response = await fetch(`/api/administration${query.size ? `?${query}` : ""}`, {
    credentials: "same-origin",
  })
  if (!response.ok) {
    const data = (await response.json()) as AdministrationErrorResponse
    throw new AdministrationRequestError(
      response.status,
      data.error,
      data.message ?? "Administration request failed",
    )
  }
  return (await response.json()) as AdministrationResponse
}

export function AuthenticationApplication() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("authentication") === "failed"
      ? "GitHub could not authorize this Hub session."
      : null,
  )
  const [loading, setLoading] = useState(true)
  const [administration, setAdministration] = useState<AdministrationResponse | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has("authentication")) {
      url.searchParams.delete("authentication")
      window.history.replaceState(window.history.state, "", url)
    }
    fetchSession()
      .then(async (value) => {
        setSession(value)
        if (value.membership?.role === "administrator") {
          setAdministration(await fetchAdministration())
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
      const current = await fetchSession()
      setSession(current)
      const response = await fetch("/api/auth/github", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": current.csrfToken },
      })
      if (!response.ok) throw new Error("Sign-in request failed")
      const data = (await response.json()) as { authorizationUrl: string }
      window.location.assign(data.authorizationUrl)
    } catch {
      setError("Hub could not start GitHub sign-in.")
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
      const current = await fetchSession()
      setSession(current)
      if (!current.authenticated) return
      const response = await fetch("/api/session", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": current.csrfToken },
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
        const data = (await response.json()) as AdministrationErrorResponse
        if (data.error === "fresh_authorization_required") {
          const verification = await fetch("/api/session/verify", {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": session.csrfToken },
          })
          if (!verification.ok) {
            throw new Error("Hub could not start identity verification.")
          }
          const verificationData = (await verification.json()) as { authorizationUrl: string }
          window.location.assign(verificationData.authorizationUrl)
          return
        }
        if (response.status === 401 || data.error === "administrator_required") {
          setAdministration(null)
          setSession(await fetchSession())
        }
        throw new Error(data.message ?? "Administration request failed")
      }
      const current = await fetchSession()
      setSession(current)
      if (current.membership?.role === "administrator") {
        setAdministration(await fetchAdministration())
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

  async function loadMoreAdministration(collection: "memberships" | "invitations") {
    if (!administration) return
    const cursor =
      collection === "memberships"
        ? administration.memberships.nextCursor
        : administration.invitations.nextCursor
    if (!cursor) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchAdministration({ [collection]: cursor })
      setAdministration((current) => {
        if (!current) return current
        if (collection === "memberships") {
          return {
            ...current,
            memberships: {
              memberships: [...current.memberships.memberships, ...page.memberships.memberships],
              nextCursor: page.memberships.nextCursor,
            },
          }
        }
        return {
          ...current,
          invitations: {
            invitations: [...current.invitations.invitations, ...page.invitations.invitations],
            nextCursor: page.invitations.nextCursor,
          },
        }
      })
    } catch (requestError) {
      if (
        requestError instanceof AdministrationRequestError &&
        (requestError.status === 401 || requestError.code === "administrator_required")
      ) {
        setAdministration(null)
        try {
          setSession(await fetchSession())
        } catch {
          setSession(null)
        }
        setError(requestError.message)
      } else {
        setError("Hub could not load more administration records.")
      }
    } finally {
      setLoading(false)
    }
  }

  if (session?.authenticated && session.membership?.role === "administrator" && administration) {
    return (
      <MembershipAdministrationPage
        memberships={administration.memberships.memberships}
        invitations={administration.invitations.invitations}
        hasMoreMemberships={administration.memberships.nextCursor !== null}
        hasMoreInvitations={administration.invitations.nextCursor !== null}
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
        onLoadMoreMemberships={() => void loadMoreAdministration("memberships")}
        onLoadMoreInvitations={() => void loadMoreAdministration("invitations")}
        onSignOut={() => void signOut()}
      />
    )
  }

  return (
    <SignInPage
      configured={session?.configured ?? false}
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
