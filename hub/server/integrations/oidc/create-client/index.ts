import { createHash } from "node:crypto"
import { isIP } from "node:net"

import { createRemoteJWKSet, customFetch, jwtVerify } from "jose"
import { z } from "zod"

import type {
  OidcClient,
  OidcClientOptions,
  OidcConfiguration,
  OidcProfile,
} from "#server/integrations/oidc/create-client/types"

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  jwks_uri: z.string(),
  id_token_signing_alg_values_supported: z.array(z.string()).min(1),
})

const tokenSchema = z.object({
  id_token: z.string().min(1),
})

const allowedSigningAlgorithms = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
])

function publicHttpsUrl(value: string, expectedOrigin?: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (expectedOrigin && url.origin !== expectedOrigin) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isIP(hostname) !== 0
  ) {
    throw new Error("OIDC URLs must use a public HTTPS origin.")
  }
  return url
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function createOidcClient(
  configuration: OidcConfiguration,
  options: OidcClientOptions = {},
): OidcClient {
  const request = options.fetch ?? fetch
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000
  const discoveryCacheMilliseconds = options.discoveryCacheMilliseconds ?? 5 * 60_000
  const configuredIssuer = publicHttpsUrl(configuration.issuer).href.replace(/\/$/, "")
  let cachedDiscovery:
    | {
        expiresAt: number
        issuer: string
        authorizationEndpoint: URL
        tokenEndpoint: URL
        signingAlgorithms: string[]
        jwks: ReturnType<typeof createRemoteJWKSet>
      }
    | undefined

  async function fetchJson(url: URL, init?: RequestInit): Promise<unknown> {
    const response = await request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMilliseconds),
    })
    if (!response.ok) throw new Error(`OIDC request failed with status ${response.status}.`)
    return response.json()
  }

  async function discovery() {
    if (cachedDiscovery && cachedDiscovery.expiresAt > Date.now()) return cachedDiscovery
    const discoveryUrl = new URL(`${configuredIssuer}/.well-known/openid-configuration`)
    const metadata = discoverySchema.parse(await fetchJson(discoveryUrl))
    if (metadata.issuer !== configuredIssuer) {
      throw new Error("OIDC discovery returned a different issuer.")
    }
    const issuerOrigin = new URL(configuredIssuer).origin
    const authorizationEndpoint = publicHttpsUrl(metadata.authorization_endpoint, issuerOrigin)
    const tokenEndpoint = publicHttpsUrl(metadata.token_endpoint, issuerOrigin)
    const jwksUrl = publicHttpsUrl(metadata.jwks_uri, issuerOrigin)
    const signingAlgorithms = metadata.id_token_signing_alg_values_supported.filter((algorithm) =>
      allowedSigningAlgorithms.has(algorithm),
    )
    if (signingAlgorithms.length === 0) {
      throw new Error("OIDC discovery did not advertise a supported signing algorithm.")
    }
    cachedDiscovery = {
      expiresAt: Date.now() + discoveryCacheMilliseconds,
      issuer: configuredIssuer,
      authorizationEndpoint,
      tokenEndpoint,
      signingAlgorithms,
      jwks: createRemoteJWKSet(jwksUrl, {
        cacheMaxAge: 10 * 60_000,
        cooldownDuration: 5_000,
        timeoutDuration: timeoutMilliseconds,
        [customFetch]: request,
      }),
    }
    return cachedDiscovery
  }

  return {
    async authorizationUrl(state, pkceVerifier, nonce) {
      const metadata = await discovery()
      const url = new URL(metadata.authorizationEndpoint)
      url.search = new URLSearchParams({
        client_id: configuration.clientId,
        redirect_uri: configuration.callbackUrl,
        response_type: "code",
        response_mode: "query",
        scope: configuration.scopes.join(" "),
        state,
        nonce,
        code_challenge: codeChallenge(pkceVerifier),
        code_challenge_method: "S256",
      }).toString()
      return url.href
    },
    async identify(code, pkceVerifier, nonce): Promise<OidcProfile> {
      const metadata = await discovery()
      const token = tokenSchema.parse(
        await fetchJson(metadata.tokenEndpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: configuration.callbackUrl,
            client_id: configuration.clientId,
            client_secret: configuration.clientSecret,
            code_verifier: pkceVerifier,
          }),
        }),
      )
      const verified = await jwtVerify(token.id_token, metadata.jwks, {
        issuer: metadata.issuer,
        audience: configuration.clientId,
        algorithms: metadata.signingAlgorithms,
        clockTolerance: 5,
        maxTokenAge: "10m",
      })
      const claims = verified.payload
      if (!claims.sub || claims.nonce !== nonce) {
        throw new Error("OIDC token subject or nonce is invalid.")
      }
      if (
        (claims.azp !== undefined && claims.azp !== configuration.clientId) ||
        (Array.isArray(claims.aud) &&
          claims.aud.length > 1 &&
          claims.azp !== configuration.clientId)
      ) {
        throw new Error("OIDC token authorized party is invalid.")
      }
      const roles = Array.isArray(claims.roles)
        ? claims.roles.filter((role): role is string => typeof role === "string")
        : []
      const role = roles.includes(configuration.administratorRole)
        ? "administrator"
        : roles.includes(configuration.memberRole)
          ? "member"
          : null
      return {
        subject: claims.sub,
        username:
          optionalString(claims.preferred_username) ??
          optionalString(claims.email) ??
          optionalString(claims.upn),
        email: optionalString(claims.email) ?? optionalString(claims.preferred_username),
        displayName: optionalString(claims.name),
        avatarUrl: optionalString(claims.picture),
        role,
      }
    },
  }
}
