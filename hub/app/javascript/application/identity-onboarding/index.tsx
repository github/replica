import { useEffect, useState } from "react"

import { IdentityOnboardingPage } from "@/pages/identity-onboarding-page"
import type {
  IdentityConfiguration,
  IdentityProviderName,
  IdentitySession,
} from "@/pages/identity-onboarding-page/types"

async function readError(response: Response) {
  const body: unknown = await response.json().catch(() => null)
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error
  }
  return "Hub could not complete this request."
}

export function IdentityOnboarding() {
  const [configuration, setConfiguration] = useState<IdentityConfiguration | null>(null)
  const [session, setSession] = useState<IdentitySession | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<IdentityProviderName | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadSession() {
    const response = await fetch("/api/session")
    if (response.status === 401) {
      setSession(null)
      return
    }
    if (!response.ok) throw new Error(await readError(response))
    setSession((await response.json()) as IdentitySession)
  }

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/identity/configuration")
        if (!response.ok) throw new Error(await readError(response))
        const loadedConfiguration = (await response.json()) as IdentityConfiguration
        setConfiguration(loadedConfiguration)
        setShowSetup(loadedConfiguration.demoMode)
        await loadSession()
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Hub identity is unavailable.")
      }
    }
    void load()
  }, [])

  async function run(operation: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (operationError) {
      setError(
        operationError instanceof Error ? operationError.message : "Hub identity is unavailable.",
      )
    } finally {
      setBusy(false)
    }
  }

  if (!configuration) {
    return (
      <div role="status" className="identity-onboarding">
        Loading identity providers…
        {error ? <p>{error}</p> : null}
      </div>
    )
  }

  return (
    <IdentityOnboardingPage
      configuration={configuration}
      session={session}
      showSetup={showSetup}
      selectedProvider={selectedProvider}
      busy={busy}
      error={error}
      onContinueFromSetup={() => setShowSetup(false)}
      onSelectProvider={setSelectedProvider}
      onBack={() => setSelectedProvider(null)}
      onStartGitHub={() => {
        void run(async () => {
          const response = await fetch("/api/auth/github", {
            method: "POST",
            headers: { "content-type": "application/json" },
          })
          if (!response.ok) throw new Error(await readError(response))
          const result = (await response.json()) as { url: string }
          window.location.assign(result.url)
        })
      }}
      onSubmitGitHubDemo={(profile) => {
        void run(async () => {
          const response = await fetch("/api/auth/github-demo", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(profile),
          })
          if (!response.ok) throw new Error(await readError(response))
          await loadSession()
        })
      }}
      onSubmitOidc={(profile) => {
        void run(async () => {
          const response = await fetch("/api/auth/oidc-demo", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(profile),
          })
          if (!response.ok) throw new Error(await readError(response))
          await loadSession()
        })
      }}
      onSignOut={() => {
        if (!session) return
        void run(async () => {
          const response = await fetch("/api/session", {
            method: "DELETE",
            headers: { "x-csrf-token": session.csrfToken },
          })
          if (!response.ok) throw new Error(await readError(response))
          setSession(null)
          setSelectedProvider(null)
        })
      }}
    />
  )
}
