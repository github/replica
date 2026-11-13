import { z } from "zod"

import { createGitHubAppJwt } from "../create-github-app-jwt/index.ts"

import type {
  GitHubConnectionCheck,
  GitHubConnectionTestInput,
  GitHubConnectionTestOptions,
} from "./types.ts"

const appSchema = z.object({ id: z.number(), client_id: z.string().optional() })
const installationSchema = z.object({
  app_id: z.number(),
  html_url: z.string().optional(),
  suspended_at: z.string().nullable().optional(),
})
const githubUrlSchema = z.url({ protocol: /^https$/, hostname: /^github\.com$/ })

const callbackCheck: GitHubConnectionCheck = {
  name: "callback_url",
  result: "unknown",
  detail: "GitHub does not expose callback URLs. Confirm the callback URL in the App settings.",
}

/** Verifies App credentials against GitHub without returning or logging secret values. */
export async function testGitHubAppConnection(
  input: GitHubConnectionTestInput,
  {
    apiUrl = "https://api.github.com",
    fetch: request = fetch,
    now = () => new Date(),
    timeoutMs = 10_000,
  }: GitHubConnectionTestOptions = {},
): Promise<GitHubConnectionCheck[]> {
  let jwt: string
  try {
    jwt = createGitHubAppJwt(input, now())
  } catch {
    return [
      {
        name: "private_key",
        result: "fail",
        detail: "The private key could not sign a GitHub App token.",
      },
      {
        name: "app_identity",
        result: "unknown",
        detail: "Skipped because the private key failed.",
      },
      {
        name: "installation",
        result: "unknown",
        detail: "Skipped because the private key failed.",
      },
      callbackCheck,
    ]
  }
  async function get(path: string) {
    try {
      const response = await request(new URL(path, apiUrl), {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "User-Agent": "Replica-Hub",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
      return {
        status: response.status,
        body: response.ok ? ((await response.json()) as unknown) : undefined,
      }
    } catch {
      return { status: 0, body: undefined }
    }
  }

  const app = await get("/app")
  if (app.status === 0) {
    const detail = "GitHub could not be reached. Check outbound network access and try again."
    return [
      { name: "private_key", result: "unknown", detail },
      { name: "app_identity", result: "unknown", detail },
      { name: "installation", result: "unknown", detail },
      callbackCheck,
    ]
  }
  if (app.status === 401) {
    return [
      {
        name: "private_key",
        result: "fail",
        detail:
          "GitHub rejected the App token. Check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_BASE64 belong to the same App.",
      },
      {
        name: "app_identity",
        result: "unknown",
        detail: "Skipped because GitHub rejected the App token.",
      },
      {
        name: "installation",
        result: "unknown",
        detail: "Skipped because GitHub rejected the App token.",
      },
      callbackCheck,
    ]
  }
  if (app.status < 200 || app.status >= 300) {
    const detail = `GitHub returned HTTP ${app.status}. The App connection could not be verified.`
    return [
      { name: "private_key", result: "unknown", detail },
      { name: "app_identity", result: "unknown", detail },
      { name: "installation", result: "unknown", detail },
      callbackCheck,
    ]
  }
  const checks: GitHubConnectionCheck[] = [
    { name: "private_key", result: "pass", detail: "The private key signs tokens GitHub accepts." },
  ]
  const parsedApp = appSchema.safeParse(app.body)
  if (!parsedApp.success) {
    checks.push({
      name: "app_identity",
      result: "fail",
      detail: `GitHub returned HTTP ${app.status} for the App.`,
    })
  } else if (String(parsedApp.data.id) !== input.appId) {
    checks.push({
      name: "app_identity",
      result: "fail",
      detail: "GitHub's App ID does not match GITHUB_APP_ID.",
    })
  } else if (
    input.clientId &&
    parsedApp.data.client_id &&
    parsedApp.data.client_id !== input.clientId
  ) {
    checks.push({
      name: "app_identity",
      result: "fail",
      detail:
        "GITHUB_CLIENT_ID belongs to a different App. Copy the client ID from this App's settings.",
    })
  } else if (!input.clientId || !parsedApp.data.client_id) {
    checks.push({
      name: "app_identity",
      result: "unknown",
      detail: "GitHub did not provide a client ID to compare. Confirm it in the App settings.",
    })
  } else {
    checks.push({ name: "app_identity", result: "pass", detail: "The App ID and client ID match." })
  }

  const installation = await get(`/app/installations/${encodeURIComponent(input.installationId)}`)
  const parsedInstallation = installationSchema.safeParse(installation.body)
  if (installation.status === 404) {
    checks.push({
      name: "installation",
      result: "fail",
      detail:
        "The installation was not found. Install the App and copy the ID from the installation URL.",
    })
  } else if (!parsedInstallation.success) {
    checks.push({
      name: "installation",
      result: installation.status === 0 ? "unknown" : "fail",
      detail:
        installation.status === 0
          ? "GitHub could not be reached."
          : `GitHub returned HTTP ${installation.status} for the installation.`,
    })
  } else if (String(parsedInstallation.data.app_id) !== input.appId) {
    checks.push({
      name: "installation",
      result: "fail",
      detail: "The installation belongs to a different App.",
    })
  } else if (parsedInstallation.data.suspended_at) {
    checks.push({
      name: "installation",
      result: "fail",
      detail: "The installation is suspended. Unsuspend it in GitHub.",
    })
  } else {
    const parsedUrl = githubUrlSchema.safeParse(parsedInstallation.data.html_url)
    const url = parsedUrl.success ? new URL(parsedUrl.data) : null
    const path = url?.pathname.match(
      /^\/(?:settings|organizations\/[a-z0-9-]+\/settings)\/installations\/([1-9]\d*)\/?$/i,
    )
    const settingsUrl =
      url &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      path?.[1] === input.installationId
        ? url.href
        : undefined
    checks.push({
      name: "installation",
      result: "pass",
      detail: "The App is installed and active.",
      ...(settingsUrl ? { settingsUrl } : {}),
    })
  }
  checks.push(callbackCheck)
  return checks
}
