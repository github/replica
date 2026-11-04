import { createRemoteJWKSet, customFetch, jwtVerify } from "jose"
import { z } from "zod"

import type {
  CreateEntraOidcUserAuthenticationAdapterInput,
  EntraOidcUserAuthenticationAdapter,
} from "./types.ts"

const publicConfigurationSchema = z
  .object({
    callbackUri: z.url().max(500),
    clientId: z.uuid(),
    issuer: z.url().max(500),
    scopes: z.array(z.string().min(1).max(200)).min(2).max(10),
  })
  .strict()
const discoverySchema = z.looseObject({
  authorization_endpoint: z.url().max(500),
  id_token_signing_alg_values_supported: z.array(z.string()).min(1).max(20),
  issuer: z.url().max(500),
  jwks_uri: z.url().max(500),
  token_endpoint: z.url().max(500),
})
const tokenResponseSchema = z.looseObject({
  id_token: z.string().min(1).max(20_000),
})
const tenantIssuerPattern =
  /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/v2\.0$/i
const providerRequestTimeoutMs = 10_000
const maximumResponseBytes = 1_000_000
const discoveryCacheMs = 5 * 60_000
const acceptedSigningAlgorithms = new Set(["RS256"])
const assignmentSubjectSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

function validateProviderUrl(value: string, expectedOrigin: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.origin !== expectedOrigin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Entra OIDC endpoints must use the configured public HTTPS origin.")
  }
  return url
}

interface DiscoveredMetadata {
  authorizationEndpoint: URL
  expiresAt: number
  jwks: ReturnType<typeof createRemoteJWKSet>
  signingAlgorithms: string[]
  tokenEndpoint: URL
}

export function createEntraOidcUserAuthenticationAdapter(
  input: CreateEntraOidcUserAuthenticationAdapterInput,
): EntraOidcUserAuthenticationAdapter {
  const configuration = publicConfigurationSchema.parse(input.publicConfiguration)
  const issuerMatch = tenantIssuerPattern.exec(configuration.issuer)
  if (!issuerMatch || configuration.issuer.endsWith("/")) {
    throw new Error(
      "Entra OIDC issuer must use the tenant UUID at login.microsoftonline.com with /v2.0.",
    )
  }
  if (
    !configuration.scopes.includes("openid") ||
    !configuration.scopes.includes("profile") ||
    configuration.scopes.includes("offline_access") ||
    new Set(configuration.scopes).size !== configuration.scopes.length
  ) {
    throw new Error(
      "Entra OIDC scopes must be unique, include openid and profile, and omit offline_access.",
    )
  }
  const issuer = configuration.issuer.toLowerCase()
  const issuerOrigin = new URL(issuer).origin
  const request = input.fetch ?? globalThis.fetch
  let metadata: DiscoveredMetadata | undefined
  let discoveryRequest: Promise<DiscoveredMetadata> | undefined

  async function boundedRequest(url: URL, init?: RequestInit) {
    const response = await request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(providerRequestTimeoutMs),
    })
    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
      await response.body?.cancel()
      throw new Error("Entra OIDC response exceeded the maximum size.")
    }
    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    const reader = response.body?.getReader()
    if (reader) {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        receivedBytes += chunk.value.byteLength
        if (receivedBytes > maximumResponseBytes) {
          await reader.cancel()
          throw new Error("Entra OIDC response exceeded the maximum size.")
        }
        chunks.push(chunk.value)
      }
    }
    const body = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  }

  async function discover() {
    if (metadata && metadata.expiresAt > Date.now()) return metadata
    if (discoveryRequest) return discoveryRequest
    discoveryRequest = (async () => {
      const discoveryUrl = new URL(`${issuer}/.well-known/openid-configuration`)
      const response = await boundedRequest(discoveryUrl)
      if (!response.ok) throw new Error("Entra OIDC discovery failed.")
      const discovered = discoverySchema.parse(await response.json())
      if (discovered.issuer.toLowerCase() !== issuer) {
        throw new Error("Entra OIDC discovery returned a different issuer.")
      }
      const signingAlgorithms = discovered.id_token_signing_alg_values_supported.filter(
        (algorithm) => acceptedSigningAlgorithms.has(algorithm),
      )
      if (!signingAlgorithms.length) {
        throw new Error("Entra OIDC discovery did not advertise an approved signing algorithm.")
      }
      const jwksUrl = validateProviderUrl(discovered.jwks_uri, issuerOrigin)
      return {
        authorizationEndpoint: validateProviderUrl(discovered.authorization_endpoint, issuerOrigin),
        expiresAt: Date.now() + discoveryCacheMs,
        tokenEndpoint: validateProviderUrl(discovered.token_endpoint, issuerOrigin),
        signingAlgorithms,
        jwks: createRemoteJWKSet(jwksUrl, {
          cacheMaxAge: 10 * 60_000,
          cooldownDuration: 5_000,
          timeoutDuration: providerRequestTimeoutMs,
          [customFetch]: (url, init) => boundedRequest(new URL(url), init),
        }),
      }
    })()
    try {
      metadata = await discoveryRequest
      return metadata
    } finally {
      discoveryRequest = undefined
    }
  }

  return {
    providerKey: "entra",
    callbackUri: configuration.callbackUri,
    canonicalPublicConfiguration: JSON.stringify({
      callbackUri: configuration.callbackUri,
      clientAuthentication: input.clientAuthentication.canonicalPublicConfiguration,
      clientId: configuration.clientId,
      issuer,
      scopes: configuration.scopes,
    }),
    async validateConfiguration() {
      await discover()
    },
    async createAuthorizationUrl({
      callbackUri,
      codeChallenge,
      freshAuthentication,
      nonce,
      state,
    }) {
      if (callbackUri !== configuration.callbackUri) {
        throw new Error("Entra callback URI does not match the configured callback URI.")
      }
      const discovered = await discover()
      const url = new URL(discovered.authorizationEndpoint)
      url.search = new URLSearchParams({
        client_id: configuration.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        nonce,
        redirect_uri: callbackUri,
        response_mode: "query",
        response_type: "code",
        scope: configuration.scopes.join(" "),
        state,
      }).toString()
      if (freshAuthentication) {
        url.searchParams.set("max_age", "0")
        url.searchParams.set("prompt", "login")
      }
      return url
    },
    async completeAuthenticationProof({
      authenticatedAfter,
      callbackUri,
      code,
      codeVerifier,
      nonce,
    }) {
      if (callbackUri !== configuration.callbackUri) {
        throw new Error("Entra callback URI does not match the configured callback URI.")
      }
      const discovered = await discover()
      const clientAuthentication = await input.clientAuthentication.createTokenRequestFields()
      const tokenResponse = await boundedRequest(discovered.tokenEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: configuration.clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: callbackUri,
          ...clientAuthentication,
        }),
      })
      if (!tokenResponse.ok) throw new Error("Entra OIDC token exchange failed.")
      const token = tokenResponseSchema.parse(await tokenResponse.json())
      const verified = await jwtVerify(token.id_token, discovered.jwks, {
        algorithms: discovered.signingAlgorithms,
        audience: configuration.clientId,
        clockTolerance: 5,
        issuer,
        maxTokenAge: "10m",
      })
      const claims = verified.payload
      if (
        !claims.sub ||
        typeof claims.exp !== "number" ||
        claims.nonce !== nonce ||
        (claims.azp !== undefined && claims.azp !== configuration.clientId) ||
        (Array.isArray(claims.aud) &&
          claims.aud.length > 1 &&
          claims.azp !== configuration.clientId)
      ) {
        throw new Error("Entra OIDC token claims are invalid.")
      }
      if (authenticatedAfter) {
        const authenticationTime =
          typeof claims.auth_time === "number" ? claims.auth_time * 1_000 : null
        if (
          authenticationTime === null ||
          authenticationTime < authenticatedAfter.getTime() - 5_000 ||
          authenticationTime > Date.now() + 5_000
        ) {
          throw new Error("Entra OIDC authentication is not fresh.")
        }
      }
      const roles = Array.isArray(claims.roles)
        ? claims.roles.filter((role): role is string => typeof role === "string")
        : []
      const role = roles.includes("Hub.Administrator")
        ? "ADMINISTRATOR"
        : roles.includes("Hub.User")
          ? "MEMBER"
          : null
      const assignmentSubject =
        role === null ? null : assignmentSubjectSchema.parse(claims.oid).toLowerCase()
      return {
        identity: {
          issuer,
          provider: "entra",
          subject: claims.sub,
        },
        providerAssignment: {
          assignmentSubject,
          role,
        },
      }
    },
  }
}
