import { useState } from "react"

import { GithubAppSetupShowPage } from "@pages/github-app-setup-show-page"
import { githubAppCreationUrl } from "@application/hub/github-app-creation-url"
import type {
  GitHubConnectionCheck,
  GitHubSetupStatus,
} from "@application/hub/github-setup-contracts/types"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getGitHubSetupStatus } from "@application/hub/requests/get-github-setup-status"
import { testGitHubConnection } from "@application/hub/requests/test-github-connection"

import type { Route } from "./+types/index"

function requiredAccess(error: unknown) {
  if (!(error instanceof ApiRequestError) || error.status !== 403) return null
  const body = error.body
  if (typeof body !== "object" || body === null || !("requires" in body)) return null
  return body.requires === "bootstrap" || body.requires === "administrator" ? body.requires : null
}

function failureMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status === 429) {
    return "Too many attempts. Wait a few minutes and try again."
  }
  if (requiredAccess(error) === "bootstrap") return "The bootstrap secret is incorrect."
  return error instanceof Error && error.message ? error.message : fallback
}

export async function clientLoader({
  request,
}: Pick<Route.ClientLoaderArgs, "request">): Promise<{ status: GitHubSetupStatus | null }> {
  try {
    return { status: await getGitHubSetupStatus(request) }
  } catch (error) {
    const access = requiredAccess(error)
    if (access === "bootstrap") return { status: null }
    if (access === "administrator") {
      throw new Response("Administrator access is required.", { status: 403 })
    }
    throw error
  }
}

export function meta() {
  return [{ title: "GitHub App setup - Replica Hub" }]
}

export default function SettingsGithubSetup({
  loaderData,
}: Pick<Route.ComponentProps, "loaderData">) {
  const [status, setStatus] = useState(loaderData.status)
  const [secret, setSecret] = useState<string | undefined>()
  const [bootstrap, setBootstrap] = useState({ pending: false, error: null as string | null })
  const [organization, setOrganization] = useState("")
  const [connection, setConnection] = useState({
    checks: null as GitHubConnectionCheck[] | null,
    testing: false,
    error: null as string | null,
  })

  async function onBootstrapSubmit(value: string) {
    if (bootstrap.pending) return
    setBootstrap({ pending: true, error: null })
    try {
      const next = await getGitHubSetupStatus(new Request(window.location.href), value)
      setSecret(value)
      setStatus(next)
      setBootstrap({ pending: false, error: null })
    } catch (error) {
      setBootstrap({
        pending: false,
        error: failureMessage(error, "Hub could not check the bootstrap secret."),
      })
    }
  }

  async function onTest() {
    if (connection.testing) return
    setConnection({ checks: null, testing: true, error: null })
    try {
      const request = new Request(window.location.href)
      const result = await testGitHubConnection(request, secret)
      try {
        setStatus(await getGitHubSetupStatus(request, secret))
        setConnection({ checks: result.checks, testing: false, error: null })
      } catch {
        setConnection({
          checks: result.checks,
          testing: false,
          error:
            "The connection was tested, but the connected repositories could not be refreshed.",
        })
      }
    } catch (error) {
      setConnection({
        checks: null,
        testing: false,
        error: failureMessage(error, "Hub could not test the GitHub connection."),
      })
    }
  }

  return (
    <GithubAppSetupShowPage
      key={status ? "setup" : "bootstrap"}
      status={status}
      bootstrap={{ ...bootstrap, onSubmit: (value) => void onBootstrapSubmit(value) }}
      organization={organization}
      onOrganizationChange={setOrganization}
      creationUrl={status ? githubAppCreationUrl(status.urls, organization) : ""}
      connection={{ ...connection, onTest: () => void onTest() }}
      signInPath={import.meta.env.DEV && import.meta.env.MODE === "mock" ? "/sign-in" : "/"}
    />
  )
}
