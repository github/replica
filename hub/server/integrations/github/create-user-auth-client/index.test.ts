import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { createGitHubUserAuthClient } from "#server/integrations/github/create-user-auth-client"

const configuration = {
  clientId: "github-client",
  clientSecret: "github-client-secret-fixture",
  callbackUrl: "https://hub.example/api/auth/github/callback",
  issuer: "https://github.com" as const,
}

describe("createGitHubUserAuthClient()", () => {
  it("builds a state-bound S256 authorization URL without repository scopes", () => {
    const client = createGitHubUserAuthClient(configuration)
    const verifier = "pkce-verifier-fixture"

    const url = new URL(client.authorizationUrl("state-fixture", verifier))

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: configuration.clientId,
      redirect_uri: configuration.callbackUrl,
      state: "state-fixture",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    })
    expect(url.searchParams.has("scope")).toBe(false)
  })

  it("keeps the user access token transient while returning the immutable GitHub subject", async () => {
    const accessToken = "github-user-access-token-fixture"
    const requests: Array<{ input: string; init?: RequestInit }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        requests.push({ input: requestUrl, init })
        if (requests.length === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: accessToken, token_type: "bearer" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 42,
              login: "octocat",
              name: "The Octocat",
              avatar_url: "https://avatars.githubusercontent.com/u/42",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
      }),
    )
    const client = createGitHubUserAuthClient(configuration)

    const profile = await client.identify("one-use-code", "pkce-verifier")

    expect(profile).toEqual({
      subject: "42",
      username: "octocat",
      displayName: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/42",
    })
    const tokenRequest = requests[0]
    const userRequest = requests[1]
    expect(tokenRequest).toBeDefined()
    expect(userRequest).toBeDefined()
    expect(tokenRequest!).toMatchObject({
      input: "https://github.com/login/oauth/access_token",
      init: {
        method: "POST",
        redirect: "error",
      },
    })
    const tokenBody = tokenRequest!.init?.body
    if (typeof tokenBody !== "string") throw new Error("Expected a JSON token request body")
    expect(JSON.parse(tokenBody) as unknown).toMatchObject({
      code: "one-use-code",
      code_verifier: "pkce-verifier",
      redirect_uri: configuration.callbackUrl,
    })
    expect(userRequest!).toMatchObject({
      input: "https://api.github.com/user",
      init: { redirect: "error" },
    })
    expect(new Headers(userRequest!.init?.headers).get("authorization")).toBe(
      `Bearer ${accessToken}`,
    )
    expect(JSON.stringify(profile)).not.toContain(accessToken)
  })

  it("rejects malformed token and profile responses instead of constructing a partial identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 7 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    const client = createGitHubUserAuthClient(configuration)

    await expect(client.identify("code", "verifier")).rejects.toMatchObject({
      status: 401,
      code: "github_denied",
    })

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token", token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "mutable-login", login: "octocat" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )

    await expect(client.identify("code", "verifier")).rejects.toMatchObject({
      status: 503,
      code: "github_invalid_response",
    })
  })

  it("maps network and non-success responses to generic availability failures", async () => {
    const client = createGitHubUserAuthClient(configuration)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("token leaked in transport error")))

    await expect(client.identify("code", "verifier")).rejects.toMatchObject({
      status: 503,
      code: "github_unavailable",
      message: "GitHub is unavailable.",
    })

    vi.mocked(fetch).mockResolvedValue(new Response("private upstream failure", { status: 502 }))
    await expect(client.identify("code", "verifier")).rejects.toMatchObject({
      status: 503,
      code: "github_unavailable",
      message: "GitHub is unavailable.",
    })
  })
})
