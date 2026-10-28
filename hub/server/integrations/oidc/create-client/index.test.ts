import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"

import { createOidcClient } from "#server/integrations/oidc/create-client"

const issuer = "https://login.example.test/tenant/v2.0"
const configuration = {
  issuer,
  clientId: "hub-client",
  clientSecret: "client-secret-fixture",
  clientCredentialReference: "HUB_OIDC_CLIENT_SECRET",
  callbackUrl: "https://hub.example.test/api/auth/oidc/callback",
  scopes: ["openid", "profile", "email"],
  memberRole: "Hub.User",
  administratorRole: "Hub.Administrator",
  membershipPolicy: "jit-assignment" as const,
  enabled: true,
  providerRevision: 1,
}

async function signingKey() {
  const pair = await generateKeyPair("RS256")
  const jwk = await exportJWK(pair.publicKey)
  const kid = await calculateJwkThumbprint(jwk)
  return { ...pair, jwk: { ...jwk, kid, alg: "RS256", use: "sig" }, kid }
}

async function idToken(
  key: Awaited<ReturnType<typeof signingKey>>,
  overrides: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1_000)
  const claims = {
    sub: "immutable-subject",
    nonce: "expected-nonce",
    iss: issuer,
    aud: configuration.clientId,
    roles: ["Hub.User"],
    preferred_username: "member@example.test",
    email: "member@example.test",
    name: "Member Name",
    picture: "https://images.example.test/member.png",
    iat: now,
    exp: now + 300,
    ...overrides,
  }
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: key.kid }).sign(key.privateKey)
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function providerFetch(options: {
  token?: string
  keys?: unknown[]
  discovery?: Record<string, unknown>
}): Mock<typeof fetch> {
  return vi.fn<typeof fetch>((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return Promise.resolve(
        json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
          id_token_signing_alg_values_supported: ["RS256"],
          ...options.discovery,
        }),
      )
    }
    if (url.pathname.endsWith("/token")) return Promise.resolve(json({ id_token: options.token }))
    if (url.pathname.endsWith("/keys")) {
      return Promise.resolve(json({ keys: options.keys ?? [] }))
    }
    return Promise.resolve(json({}, 404))
  })
}

describe("createOidcClient()", () => {
  it("rejects discovery metadata whose issuer is not the exact configured issuer", async () => {
    const request = providerFetch({
      discovery: { issuer: `${issuer}/different` },
    })
    const client = createOidcClient(configuration, { fetch: request })

    await expect(client.authorizationUrl("state", "pkce-verifier", "nonce")).rejects.toThrow(
      "OIDC discovery returned a different issuer.",
    )
  })

  it.each([
    ["configured HTTP issuer", { ...configuration, issuer: "http://login.example.test/tenant" }],
    ["configured loopback issuer", { ...configuration, issuer: "https://127.0.0.1/tenant" }],
  ])("rejects a %s before making a provider request", (_name, unsafeConfiguration) => {
    const request = vi.fn()

    expect(() => createOidcClient(unsafeConfiguration, { fetch: request })).toThrow(
      "OIDC URLs must use a public HTTPS origin.",
    )
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    ["HTTP authorization endpoint", { authorization_endpoint: "http://login.example.test/auth" }],
    ["cross-origin token endpoint", { token_endpoint: "https://tokens.example.test/tenant/token" }],
    ["IP-address JWKS endpoint", { jwks_uri: "https://192.0.2.1/keys" }],
  ])("rejects discovery with a %s", async (_name, discovery) => {
    const client = createOidcClient(configuration, {
      fetch: providerFetch({ discovery }),
    })

    await expect(client.authorizationUrl("state", "pkce-verifier", "nonce")).rejects.toThrow(
      "OIDC URLs must use a public HTTPS origin.",
    )
  })

  it.each([
    ["no advertised signing algorithms", { id_token_signing_alg_values_supported: [] }],
    [
      "only symmetric signing algorithms",
      { id_token_signing_alg_values_supported: ["HS256", "HS512"] },
    ],
  ])("rejects discovery with %s", async (_name, discovery) => {
    const client = createOidcClient(configuration, {
      fetch: providerFetch({ discovery }),
    })

    await expect(client.authorizationUrl("state", "pkce-verifier", "nonce")).rejects.toThrow()
  })

  it("creates an authorization URL with the exact callback, scopes, state, nonce, and S256 PKCE", async () => {
    const client = createOidcClient(configuration, { fetch: providerFetch({}) })

    const url = new URL(
      await client.authorizationUrl("opaque-state", "pkce-verifier", "one-use-nonce"),
    )

    expect(url.origin + url.pathname).toBe(`${issuer}/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: configuration.clientId,
      redirect_uri: configuration.callbackUrl,
      response_type: "code",
      response_mode: "query",
      scope: "openid profile email",
      state: "opaque-state",
      nonce: "one-use-nonce",
      code_challenge: "S-YYjGPeiHjsbIXpqrbVjcGUQn7X-4T468hBrBqm8pA",
      code_challenge_method: "S256",
    })
  })

  it("exchanges the code with the verifier and maps administrator claims without returning tokens", async () => {
    const key = await signingKey()
    const token = await idToken(key, {
      roles: ["Hub.User", "Hub.Administrator", 42],
      oid: "A0E1D2C3-B4A5-4678-9ABC-DEF012345678",
    })
    const request = providerFetch({ token, keys: [key.jwk] })
    const client = createOidcClient(configuration, { fetch: request })

    const profile = await client.identify("one-use-code", "pkce-verifier", "expected-nonce")

    expect(profile).toEqual({
      subject: "immutable-subject",
      directoryObjectId: "a0e1d2c3-b4a5-4678-9abc-def012345678",
      username: "member@example.test",
      email: "member@example.test",
      displayName: "Member Name",
      avatarUrl: "https://images.example.test/member.png",
      role: "administrator",
    })
    const tokenRequest = request.mock.calls.find(([input]) =>
      new URL(input instanceof Request ? input.url : input).pathname.endsWith("/token"),
    )
    expect(tokenRequest).toBeDefined()
    const init = tokenRequest?.[1]
    expect(init?.method).toBe("POST")
    if (!(init?.body instanceof URLSearchParams)) {
      throw new Error("Expected the token request to use URL-encoded parameters.")
    }
    expect(init.body.toString()).toBe(
      new URLSearchParams({
        grant_type: "authorization_code",
        code: "one-use-code",
        redirect_uri: configuration.callbackUrl,
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code_verifier: "pkce-verifier",
      }).toString(),
    )
    expect(JSON.stringify(profile)).not.toContain(token)
  })

  it.each([
    ["nonce", { nonce: "different-nonce" }],
    ["audience", { aud: "different-client" }],
    ["issuer", { iss: "https://different.example.test/tenant" }],
    ["authorized party", { azp: "different-client" }],
    ["multi-audience authorized party", { aud: ["hub-client", "other-client"] }],
    ["issued-at", { iat: Math.floor(Date.now() / 1_000) + 60 }],
    ["expiration", { exp: undefined }],
    [
      "lifetime",
      {
        iat: Math.floor(Date.now() / 1_000) - 700,
        exp: Math.floor(Date.now() / 1_000) + 300,
      },
    ],
  ])("rejects an ID token with an invalid %s claim", async (_name, claims) => {
    const key = await signingKey()
    const token = await idToken(key, claims)
    const client = createOidcClient(configuration, {
      fetch: providerFetch({ token, keys: [key.jwk] }),
    })

    await expect(client.identify("code", "verifier", "expected-nonce")).rejects.toThrow()
  })

  it("rejects a malformed directory object ID instead of treating it as an assignment identifier", async () => {
    const key = await signingKey()
    const token = await idToken(key, { oid: "not-a-directory-object-id" })
    const client = createOidcClient(configuration, {
      fetch: providerFetch({ token, keys: [key.jwk] }),
    })

    await expect(client.identify("code", "verifier", "expected-nonce")).rejects.toThrow(
      "OIDC directory object ID is invalid.",
    )
  })

  it("rejects an ID token signed by a key outside the provider JWKS", async () => {
    const trusted = await signingKey()
    const untrusted = await signingKey()
    const token = await idToken(untrusted)
    const client = createOidcClient(configuration, {
      fetch: providerFetch({ token, keys: [trusted.jwk] }),
    })

    await expect(client.identify("code", "verifier", "expected-nonce")).rejects.toThrow()
  })

  it("reuses cached discovery and JWKS for known signing keys", async () => {
    const key = await signingKey()
    const token = await idToken(key)
    const request = providerFetch({ token, keys: [key.jwk] })
    const client = createOidcClient(configuration, { fetch: request })

    await client.identify("first-code", "first-verifier", "expected-nonce")
    await client.identify("second-code", "second-verifier", "expected-nonce")

    const paths = request.mock.calls.map(
      ([input]) => new URL(input instanceof Request ? input.url : input).pathname,
    )
    expect(paths.filter((path) => path.endsWith("/.well-known/openid-configuration"))).toHaveLength(
      1,
    )
    expect(paths.filter((path) => path.endsWith("/keys"))).toHaveLength(1)
    expect(paths.filter((path) => path.endsWith("/token"))).toHaveLength(2)
  })

  it("refreshes JWKS once when a rotated token uses an unknown key id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-27T18:00:00.000Z"))
    const oldKey = await signingKey()
    const rotatedKey = await signingKey()
    const tokens = [await idToken(oldKey), await idToken(rotatedKey)]
    let jwksRequests = 0
    const request = vi.fn((input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.endsWith("/.well-known/openid-configuration")) {
        return Promise.resolve(
          json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/keys`,
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        )
      }
      if (url.pathname.endsWith("/token")) {
        return Promise.resolve(json({ id_token: tokens.shift() }))
      }
      if (url.pathname.endsWith("/keys")) {
        jwksRequests += 1
        return Promise.resolve(
          json({ keys: jwksRequests === 1 ? [oldKey.jwk] : [oldKey.jwk, rotatedKey.jwk] }),
        )
      }
      return Promise.resolve(json({}, 404))
    })
    const client = createOidcClient(configuration, { fetch: request })

    await client.identify("first-code", "first-verifier", "expected-nonce")
    vi.advanceTimersByTime(5_001)
    await client.identify("rotated-code", "rotated-verifier", "expected-nonce")

    expect(jwksRequests).toBe(2)
  })

  it.each(["discovery", "token", "jwks"] as const)(
    "fails closed during a provider %s outage",
    async (failedSurface) => {
      const key = await signingKey()
      const token = await idToken(key)
      const request = vi.fn((input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (
          (failedSurface === "discovery" &&
            url.pathname.endsWith("/.well-known/openid-configuration")) ||
          (failedSurface === "token" && url.pathname.endsWith("/token")) ||
          (failedSurface === "jwks" && url.pathname.endsWith("/keys"))
        ) {
          return Promise.resolve(json({ error: "provider unavailable" }, 503))
        }
        if (url.pathname.endsWith("/.well-known/openid-configuration")) {
          return Promise.resolve(
            json({
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/keys`,
              id_token_signing_alg_values_supported: ["RS256"],
            }),
          )
        }
        if (url.pathname.endsWith("/token")) return Promise.resolve(json({ id_token: token }))
        if (url.pathname.endsWith("/keys")) return Promise.resolve(json({ keys: [key.jwk] }))
        return Promise.resolve(json({}, 404))
      })
      const client = createOidcClient(configuration, { fetch: request })

      const operation =
        failedSurface === "discovery"
          ? client.authorizationUrl("state", "verifier", "nonce")
          : client.identify("code", "verifier", "expected-nonce")
      await expect(operation).rejects.toThrow()
    },
  )
})
