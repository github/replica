import { generateKeyPair, exportJWK, SignJWT } from "jose"
import { describe, expect, it, vi } from "vitest"

import type { OidcClientAuthenticationProvider } from "../types"
import { createEntraOidcUserAuthenticationAdapter } from "."

const tenantId = "11111111-1111-4111-8111-111111111111"
const clientId = "22222222-2222-4222-8222-222222222222"
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
const callbackUri = "https://hub.example.test/api/auth/entra/callback"

const clientAuthentication: OidcClientAuthenticationProvider = {
  canonicalPublicConfiguration: {
    mode: "client_secret",
    reference: "ENTRA_OIDC_CLIENT_SECRET",
  },
  createTokenRequestFields: () => Promise.resolve({ client_secret: "secret-value" }),
}

async function protocolFixture(
  claims: Record<string, unknown> | ((now: number) => Record<string, unknown>) = {},
  options: { invalidSignature?: boolean; issuer?: string } = {},
) {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const verificationKey = options.invalidSignature
    ? (await generateKeyPair("RS256")).publicKey
    : publicKey
  const jwk = await exportJWK(verificationKey)
  const now = Math.floor(Date.now() / 1_000)
  const claimOverrides = typeof claims === "function" ? claims(now) : claims
  const token = await new SignJWT({
    aud: clientId,
    exp: now + 300,
    iat: now,
    iss: options.issuer ?? issuer,
    nonce: "attempt-nonce",
    oid: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    roles: ["Hub.User"],
    sub: "immutable-subject",
    ...claimOverrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(privateKey)
  const request = vi.fn<typeof fetch>((input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Promise.resolve(
        Response.json({
          authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
          id_token_signing_alg_values_supported: ["RS256"],
          issuer,
          jwks_uri: `${issuer}/discovery/v2.0/keys`,
          token_endpoint: `${issuer}/oauth2/v2.0/token`,
        }),
      )
    }
    if (url === `${issuer}/oauth2/v2.0/token`) {
      expect(init).toMatchObject({ method: "POST", redirect: "error" })
      return Promise.resolve(Response.json({ id_token: token }))
    }
    if (url === `${issuer}/discovery/v2.0/keys`) {
      return Promise.resolve(
        Response.json({ keys: [{ ...jwk, alg: "RS256", kid: "test-key", use: "sig" }] }),
      )
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  return {
    adapter: createEntraOidcUserAuthenticationAdapter({
      clientAuthentication,
      fetch: request,
      publicConfiguration: {
        callbackUri,
        clientId,
        issuer,
      },
    }),
    request,
  }
}

describe("createEntraOidcUserAuthenticationAdapter()", () => {
  it("uses the fixed openid profile scope without fresh-login controls for normal sign-in", async () => {
    const { adapter } = await protocolFixture()

    const normal = await adapter.createAuthorizationUrl({
      callbackUri,
      codeChallenge: "c".repeat(43),
      freshAuthentication: false,
      nonce: "attempt-nonce",
      state: "attempt-state",
    })

    expect(adapter.canonicalPublicConfiguration).toBe(
      `{"callbackUri":"${callbackUri}","clientAuthentication":{"mode":"client_secret","reference":"ENTRA_OIDC_CLIENT_SECRET"},"clientId":"${clientId}","issuer":"${issuer}","scope":"openid profile"}`,
    )
    expect(Object.fromEntries(normal.searchParams)).toEqual({
      client_id: clientId,
      code_challenge: "c".repeat(43),
      code_challenge_method: "S256",
      nonce: "attempt-nonce",
      redirect_uri: callbackUri,
      response_mode: "query",
      response_type: "code",
      scope: "openid profile",
      state: "attempt-state",
    })
  })

  it("adds prompt=login and max_age=0 for fresh administrator enrollment", async () => {
    const { adapter } = await protocolFixture()

    const fresh = await adapter.createAuthorizationUrl({
      callbackUri,
      codeChallenge: "c".repeat(43),
      freshAuthentication: true,
      nonce: "attempt-nonce",
      state: "attempt-state",
    })

    expect(fresh.searchParams.get("prompt")).toBe("login")
    expect(fresh.searchParams.get("max_age")).toBe("0")
    expect(fresh.searchParams.get("scope")).toBe("openid profile")
  })

  it("verifies the signed token and separates immutable identity from assignment provenance", async () => {
    const { adapter, request } = await protocolFixture({
      roles: ["Hub.User", "Hub.Administrator"],
    })

    const evidence = await adapter.completeAuthenticationProof({
      callbackUri,
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      nonce: "attempt-nonce",
    })

    expect(evidence).toMatchObject({
      identity: {
        issuer,
        provider: "entra",
        subject: "immutable-subject",
      },
      providerAssignment: {
        assignmentSubject: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "ADMINISTRATOR",
      },
    })
    expect(evidence.providerAssignment?.issuedAt).toBeInstanceOf(Date)
    const tokenRequest = request.mock.calls.find(
      ([input]) =>
        (input instanceof Request ? input.url : input.toString()) === `${issuer}/oauth2/v2.0/token`,
    )!
    expect(Object.fromEntries(tokenRequest[1]!.body as URLSearchParams)).toEqual({
      client_id: clientId,
      client_secret: "secret-value",
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      grant_type: "authorization_code",
      redirect_uri: callbackUri,
    })
  })

  it.each([
    [["hub.user", "Hub.Owner"], null],
    [["Hub.User"], "MEMBER"],
    [["Hub.Administrator", "Hub.User"], "ADMINISTRATOR"],
  ] as const)("maps only exact case-sensitive roles %j to %s", async (roles, expectedRole) => {
    const { adapter } = await protocolFixture({ roles: [...roles] })

    const evidence = await adapter.completeAuthenticationProof({
      callbackUri,
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      nonce: "attempt-nonce",
    })

    expect(evidence.providerAssignment?.role).toBe(expectedRole)
  })

  it("authenticates a signed role-free token as explicit authority-loss evidence", async () => {
    const { adapter } = await protocolFixture({
      roles: [],
    })

    const evidence = await adapter.completeAuthenticationProof({
      callbackUri,
      code: "authorization-code",
      codeVerifier: "pkce-verifier",
      nonce: "attempt-nonce",
    })

    expect(evidence).toMatchObject({
      identity: {
        issuer,
        provider: "entra",
        subject: "immutable-subject",
      },
      providerAssignment: {
        assignmentSubject: null,
        role: null,
      },
    })
    expect(evidence.providerAssignment?.issuedAt).toBeInstanceOf(Date)
  })

  it("accepts role-loss evidence without an oid but requires oid for role-bearing evidence", async () => {
    const withoutAuthority = await protocolFixture({
      oid: undefined,
      roles: ["hub.user", "Hub.Owner"],
    })

    await expect(
      withoutAuthority.adapter.completeAuthenticationProof({
        callbackUri,
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        nonce: "attempt-nonce",
      }),
    ).resolves.toMatchObject({
      providerAssignment: {
        assignmentSubject: null,
        role: null,
      },
    })

    const withAuthority = await protocolFixture({
      oid: undefined,
      roles: ["Hub.User"],
    })
    await expect(
      withAuthority.adapter.completeAuthenticationProof({
        callbackUri,
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        nonce: "attempt-nonce",
      }),
    ).rejects.toThrow()
  })

  it("ignores malformed oid when no accepted app role remains", async () => {
    const { adapter } = await protocolFixture({
      oid: "not-a-directory-object-id",
      roles: ["hub.user", "Hub.Owner"],
    })

    await expect(
      adapter.completeAuthenticationProof({
        callbackUri,
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        nonce: "attempt-nonce",
      }),
    ).resolves.toMatchObject({
      providerAssignment: {
        assignmentSubject: null,
        role: null,
      },
    })
  })

  it("rejects malformed oid when an accepted app role is present", async () => {
    const { adapter } = await protocolFixture({
      oid: "not-a-directory-object-id",
      roles: ["Hub.Administrator"],
    })

    await expect(
      adapter.completeAuthenticationProof({
        callbackUri,
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        nonce: "attempt-nonce",
      }),
    ).rejects.toThrow()
  })

  it("shares in-flight discovery and refreshes it only after the bounded TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-04T18:00:00Z"))
    const pending: Array<(response: Response) => void> = []
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve)
        }),
    )
    const adapter = createEntraOidcUserAuthenticationAdapter({
      clientAuthentication,
      fetch: request,
      publicConfiguration: {
        callbackUri,
        clientId,
        issuer,
      },
    })
    const input = {
      callbackUri,
      codeChallenge: "c".repeat(43),
      freshAuthentication: false,
      nonce: "attempt-nonce",
      state: "attempt-state",
    }

    const first = adapter.createAuthorizationUrl(input)
    const concurrent = adapter.createAuthorizationUrl(input)
    expect(request).toHaveBeenCalledOnce()
    pending.shift()!(
      Response.json({
        authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
        id_token_signing_alg_values_supported: ["RS256"],
        issuer,
        jwks_uri: `${issuer}/discovery/v2.0/keys`,
        token_endpoint: `${issuer}/oauth2/v2.0/token`,
      }),
    )
    await expect(Promise.all([first, concurrent])).resolves.toHaveLength(2)

    await adapter.createAuthorizationUrl(input)
    expect(request).toHaveBeenCalledOnce()

    vi.setSystemTime(new Date("2026-11-04T18:05:00.001Z"))
    const refreshed = adapter.createAuthorizationUrl(input)
    expect(request).toHaveBeenCalledTimes(2)
    pending.shift()!(
      Response.json({
        authorization_endpoint: `${issuer}/oauth2/v2.0/authorize`,
        id_token_signing_alg_values_supported: ["RS256"],
        issuer,
        jwks_uri: `${issuer}/discovery/v2.0/keys`,
        token_endpoint: `${issuer}/oauth2/v2.0/token`,
      }),
    )
    await expect(refreshed).resolves.toBeInstanceOf(URL)
  })

  it.each([
    ["nonce", { nonce: "different-nonce" }, { message: "Entra OIDC token claims are invalid." }],
    [
      "authorized party",
      { azp: "other-client" },
      { message: "Entra OIDC token claims are invalid." },
    ],
    [
      "wrong audience",
      { aud: "different-client" },
      { claim: "aud", code: "ERR_JWT_CLAIM_VALIDATION_FAILED", reason: "check_failed" },
    ],
    [
      "expired",
      (now: number) => ({ exp: now - 60 }),
      { claim: "exp", code: "ERR_JWT_EXPIRED", reason: "check_failed" },
    ],
    [
      "not active yet",
      (now: number) => ({ nbf: now + 60 }),
      { claim: "nbf", code: "ERR_JWT_CLAIM_VALIDATION_FAILED", reason: "check_failed" },
    ],
    [
      "older than the maximum token age",
      (now: number) => ({ iat: now - 660 }),
      { claim: "iat", code: "ERR_JWT_EXPIRED", reason: "check_failed" },
    ],
  ] as const)(
    "rejects a signed token with invalid %s evidence",
    async (_name, claims, expectedError) => {
      const { adapter } = await protocolFixture(claims)

      await expect(
        adapter.completeAuthenticationProof({
          callbackUri,
          code: "authorization-code",
          codeVerifier: "pkce-verifier",
          nonce: "attempt-nonce",
        }),
      ).rejects.toMatchObject(expectedError)
    },
  )

  it("requires auth_time within the saved attempt boundary for fresh enrollment", async () => {
    const now = Math.floor(Date.now() / 1_000)
    const { adapter } = await protocolFixture({ auth_time: now - 60 })

    await expect(
      adapter.completeAuthenticationProof({
        authenticatedAfter: new Date((now - 10) * 1_000),
        callbackUri,
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        nonce: "attempt-nonce",
      }),
    ).rejects.toThrow("authentication is not fresh")
  })

  it.each([
    ["exact issuer", { issuer: `${issuer}/different` }],
    ["JWKS signature", { invalidSignature: true }],
  ])("rejects a token without the configured %s", async (_name, options) => {
    const { adapter } = await protocolFixture({}, options)

    await expect(
      adapter.completeAuthenticationProof({
        callbackUri,
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
        nonce: "attempt-nonce",
      }),
    ).rejects.toThrow()
  })

  it("rejects discovery endpoints that leave the configured tenant origin", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        authorization_endpoint: "https://attacker.example.test/authorize",
        id_token_signing_alg_values_supported: ["RS256"],
        issuer,
        jwks_uri: `${issuer}/keys`,
        token_endpoint: `${issuer}/token`,
      }),
    )
    const adapter = createEntraOidcUserAuthenticationAdapter({
      clientAuthentication,
      fetch: request,
      publicConfiguration: {
        callbackUri,
        clientId,
        issuer,
      },
    })

    await expect(adapter.validateConfiguration()).rejects.toThrow("configured public HTTPS origin")
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" })
    expect(request.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
