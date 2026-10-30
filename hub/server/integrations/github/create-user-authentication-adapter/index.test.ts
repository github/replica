import { describe, expect, it, vi } from "vitest"

import { createGitHubUserAuthenticationAdapter } from "."

const publicConfiguration = {
  authorizationEndpoint: "https://github.com/login/oauth/authorize",
  callbackUri: "https://hub.example.test/api/auth/github/callback",
  clientId: "client-id",
  tokenEndpoint: "https://github.com/login/oauth/access_token",
  userEndpoint: "https://api.github.com/user",
}

describe("createGitHubUserAuthenticationAdapter()", () => {
  it("uses exact OAuth arguments and binds immutable identity to the numeric GitHub user ID", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "provider-token", token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123456,
            login: "octocat",
            name: "The Octocat",
            avatar_url: "https://avatars.example.test/octocat",
            email: "octocat@example.test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
    const adapter = createGitHubUserAuthenticationAdapter({
      clientSecret: "client-secret",
      publicConfiguration,
      fetch: request,
    })

    const authorizationUrl = adapter.createAuthorizationUrl({
      callbackUri: publicConfiguration.callbackUri,
      codeChallenge: "c".repeat(43),
      state: "state-value",
    })
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: publicConfiguration.callbackUri,
      state: "state-value",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    })

    const evidence = await adapter.completeAuthenticationProof({
      callbackUri: publicConfiguration.callbackUri,
      code: "authorization-code",
      codeVerifier: "verifier-value",
    })

    expect(evidence).toEqual({
      provider: "github",
      issuer: "https://github.com",
      subject: "123456",
      attributes: {
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://avatars.example.test/octocat",
        email: "octocat@example.test",
      },
    })
    const tokenRequest = request.mock.calls[0]!
    expect(tokenRequest[0]).toBe(publicConfiguration.tokenEndpoint)
    expect(tokenRequest[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
    })
    expect(Object.fromEntries(tokenRequest[1]!.body as URLSearchParams)).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "authorization-code",
      code_verifier: "verifier-value",
      redirect_uri: publicConfiguration.callbackUri,
    })
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      redirect: "error",
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer provider-token",
        "x-github-api-version": "2022-11-28",
      },
    })
    expect(JSON.stringify(evidence)).not.toMatch(
      /provider-token|client-secret|authorization-code|verifier-value/,
    )
  })

  it("rejects unknown public configuration and callback drift", () => {
    expect(() =>
      createGitHubUserAuthenticationAdapter({
        clientSecret: "secret",
        publicConfiguration: { ...publicConfiguration, scope: "user:email" },
      }),
    ).toThrow()
    const adapter = createGitHubUserAuthenticationAdapter({
      clientSecret: "secret",
      publicConfiguration,
    })
    expect(() =>
      adapter.createAuthorizationUrl({
        callbackUri: "https://attacker.example.test/callback",
        codeChallenge: "c".repeat(43),
        state: "state",
      }),
    ).toThrow("callback URI")
  })
})
