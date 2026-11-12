import { z } from "zod"

import { CopilotCredentialError } from "./errors.ts"
import type { CreateInstallationAccessTokenInput } from "./types.ts"

const responseSchema = z
  .object({
    expires_at: z.iso.datetime({ offset: true }),
    permissions: z
      .object({
        organization_copilot_requests: z.literal("read"),
      })
      .loose(),
    token: z.string().min(1).max(2_000),
  })
  .loose()
const installationSchema = z
  .object({
    account: z
      .object({
        login: z.string().min(1).max(39),
        type: z.literal("Organization"),
      })
      .loose(),
    app_id: z.number().int().positive(),
    id: z.number().int().positive(),
    permissions: z
      .object({
        organization_copilot_requests: z.literal("read"),
      })
      .loose(),
  })
  .loose()
const requestTimeoutMs = 10_000

function classifyResponse(response: Response) {
  if (response.status === 404) {
    throw new CopilotCredentialError(
      "installation_revoked",
      "The configured GitHub App installation is unavailable.",
    )
  }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")))
  ) {
    throw new CopilotCredentialError(
      "unavailable",
      "GitHub temporarily limited installation credential requests.",
    )
  }
  if (response.status === 401 || response.status === 403 || response.status === 422) {
    throw new CopilotCredentialError(
      "permission_denied",
      "GitHub denied the configured App installation credential.",
    )
  }
  if (!response.ok) {
    throw new CopilotCredentialError(
      "unavailable",
      "GitHub could not issue an installation credential.",
    )
  }
}

async function readJson(response: Response, message: string): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown
  } catch (error) {
    throw new CopilotCredentialError("unavailable", message, { cause: error })
  }
}

export function createInstallationAccessToken(input: CreateInstallationAccessTokenInput) {
  const request = input.fetch ?? globalThis.fetch
  const now = input.now ?? (() => new Date())

  return async function mintInstallationAccessToken() {
    const issuedAt = new Date(now().getTime() - 60_000)
    const jwt = await input.signer.sign({
      appId: input.appId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 10 * 60_000),
    })
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": "2022-11-28",
    }
    let installationResponse: Response
    try {
      installationResponse = await request(
        `https://api.github.com/app/installations/${input.installationId}`,
        {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      )
    } catch (error) {
      throw new CopilotCredentialError(
        "unavailable",
        "GitHub could not verify the configured App installation.",
        { cause: error },
      )
    }
    classifyResponse(installationResponse)
    let installation: z.infer<typeof installationSchema>
    const installationData = await readJson(
      installationResponse,
      "GitHub returned an unreadable App installation response.",
    )
    try {
      installation = installationSchema.parse(installationData)
    } catch (error) {
      throw new CopilotCredentialError(
        "permission_denied",
        "The configured GitHub App installation does not grant read-only Copilot Requests permission.",
        { cause: error },
      )
    }
    if (
      String(installation.app_id) !== input.appId ||
      String(installation.id) !== input.installationId ||
      installation.account.login.toLowerCase() !== input.organization
    ) {
      throw new CopilotCredentialError(
        "permission_denied",
        "The configured GitHub App, organization, and installation do not match.",
      )
    }

    let response: Response
    try {
      response = await request(
        `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({ permissions: { organization_copilot_requests: "read" } }),
          redirect: "error",
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      )
    } catch (error) {
      throw new CopilotCredentialError(
        "unavailable",
        "GitHub could not issue an installation credential.",
        { cause: error },
      )
    }
    classifyResponse(response)
    let parsed: z.infer<typeof responseSchema>
    const responseData = await readJson(
      response,
      "GitHub returned an unreadable installation credential response.",
    )
    try {
      parsed = responseSchema.parse(responseData)
    } catch (error) {
      throw new CopilotCredentialError(
        "permission_denied",
        "GitHub did not grant read-only Copilot Requests permission.",
        { cause: error },
      )
    }
    const expiresAt = new Date(parsed.expires_at)
    if (expiresAt.getTime() <= now().getTime() + 60_000) {
      throw new CopilotCredentialError(
        "unavailable",
        "GitHub issued an installation credential without enough remaining lifetime.",
      )
    }
    return { expiresAt, token: parsed.token }
  }
}
