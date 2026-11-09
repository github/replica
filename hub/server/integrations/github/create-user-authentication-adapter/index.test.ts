import { describe, expect, it, vi } from "vitest"

import { createGitHubUserAuthenticationAdapter } from "."
import { GitHubProviderRequestError } from "../errors"

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

    expect(adapter.canonicalPublicConfiguration).toBe(
      '{"authorizationEndpoint":"https://github.com/login/oauth/authorize","callbackUri":"https://hub.example.test/api/auth/github/callback","clientId":"client-id","tokenEndpoint":"https://github.com/login/oauth/access_token","userEndpoint":"https://api.github.com/user"}',
    )
    const authorizationUrl = adapter.createAuthorizationUrl({
      callbackUri: publicConfiguration.callbackUri,
      codeChallenge: "c".repeat(43),
      freshAuthentication: false,
      nonce: "unused-by-github",
      state: "state-value",
    })
    const freshAuthorizationUrl = adapter.createAuthorizationUrl({
      callbackUri: publicConfiguration.callbackUri,
      codeChallenge: "c".repeat(43),
      freshAuthentication: true,
      nonce: "unused-by-github",
      state: "state-value",
    })
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: publicConfiguration.callbackUri,
      state: "state-value",
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
    })
    expect(Object.fromEntries(freshAuthorizationUrl.searchParams)).toEqual(
      Object.fromEntries(authorizationUrl.searchParams),
    )

    const evidence = await adapter.completeAuthenticationProof({
      callbackUri: publicConfiguration.callbackUri,
      code: "authorization-code",
      codeVerifier: "verifier-value",
      nonce: "unused-by-github",
    })

    expect(evidence).toEqual({
      identity: {
        provider: "github",
        issuer: "https://github.com",
        subject: "123456",
      },
      profile: {
        login: "octocat",
        name: "The Octocat",
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
        freshAuthentication: false,
        nonce: "unused-by-github",
        state: "state",
      }),
    ).toThrow("callback URI")
  })

  it.each([
    { length: 0, accepted: false },
    { length: 1, accepted: true },
    { length: 2_000, accepted: true },
    { length: 2_001, accepted: false },
  ])("enforces the client secret boundary at $length characters", ({ length, accepted }) => {
    const clientSecret = "s".repeat(length)
    if (accepted) {
      expect(() =>
        createGitHubUserAuthenticationAdapter({
          clientSecret,
          publicConfiguration,
        }),
      ).not.toThrow()
      return
    }

    let error: unknown
    try {
      createGitHubUserAuthenticationAdapter({ clientSecret, publicConfiguration })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      "GitHub client secret must be between 1 and 2000 characters.",
    )
    if (clientSecret) expect((error as Error).message).not.toContain(clientSecret)
  })

  it.each(["authorizationEndpoint", "tokenEndpoint", "userEndpoint"] as const)(
    "rejects a schema-valid unapproved %s",
    (endpoint) => {
      expect(() =>
        createGitHubUserAuthenticationAdapter({
          clientSecret: "secret",
          publicConfiguration: {
            ...publicConfiguration,
            [endpoint]: `https://github.example.test/${endpoint}`,
          },
        }),
      ).toThrow("GitHub authentication endpoints must use the approved github.com instance.")
    },
  )

  it.each(["token exchange", "current user"] as const)(
    "bounds a stalled %s request with a typed provider failure",
    async (stage) => {
      const aborted = AbortSignal.abort(new DOMException("timed out", "TimeoutError"))
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(aborted)
      const request = vi.fn<typeof fetch>()
      if (stage === "current user") {
        request.mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "provider-token", token_type: "bearer" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }
      request.mockImplementationOnce((_url, init) => {
        expect(init?.signal).toBe(aborted)
        return Promise.reject(new Error("request aborted", { cause: init?.signal?.reason }))
      })
      const adapter = createGitHubUserAuthenticationAdapter({
        clientSecret: "client-secret",
        publicConfiguration,
        fetch: request,
      })

      await expect(
        adapter.completeAuthenticationProof({
          callbackUri: publicConfiguration.callbackUri,
          code: "authorization-code",
          codeVerifier: "verifier-value",
          nonce: "unused-by-github",
        }),
      ).rejects.toBeInstanceOf(GitHubProviderRequestError)
      expect(request).toHaveBeenCalledTimes(stage === "token exchange" ? 1 : 2)
    },
  )
})
