import { useEffect, useState } from "react"

import { SignInPage } from "@pages/sign-in-page"
import type { SignInPageUser } from "@pages/sign-in-page/types"

interface SessionResponse {
  authenticated: boolean
  configured: boolean
  csrfToken: string
  user?: SignInPageUser
}

async function fetchSession(): Promise<SessionResponse> {
  const response = await fetch("/api/session", { credentials: "same-origin" })
  if (!response.ok) throw new Error("Session request failed")
  return (await response.json()) as SessionResponse
}

export function AuthenticationApplication() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("authentication") === "failed"
      ? "GitHub could not authorize this Hub session."
      : null,
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has("authentication")) {
      url.searchParams.delete("authentication")
      window.history.replaceState(window.history.state, "", url)
    }
    fetchSession()
      .then(setSession)
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
    } catch {
      setError("Hub could not sign you out.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <SignInPage
      configured={session?.configured ?? false}
      loading={loading}
      user={session?.authenticated ? (session.user ?? null) : null}
      error={error}
      onSignIn={() => void signIn()}
      onSignOut={() => void signOut()}
    />
  )
}
