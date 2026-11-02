import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"

import { createGitHubUserAuthenticationAdapter } from "../../../integrations/github/create-user-authentication-adapter/index.ts"
import { prisma } from "../../../integrations/prisma/index.ts"
import { createAuthorizationAttempt } from "../../../repositories/authorization-attempts/create-authorization-attempt/index.ts"
import { consumeAuthorizationAttempt } from "../../../repositories/authorization-attempts/consume-authorization-attempt/index.ts"
import { deleteExpiredAuthorizationAttempts } from "../../../repositories/authorization-attempts/delete-expired-authorization-attempts/index.ts"
import { checkAuthenticationRateLimit } from "../../../repositories/authentication-rate-limits/check-authentication-rate-limit/index.ts"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { createOpaqueValue } from "../../../utils/authentication/create-opaque-value/index.ts"
import { decryptAuthenticationValue } from "../../../utils/authentication/decrypt-authentication-value/index.ts"
import { encryptAuthenticationValue } from "../../../utils/authentication/encrypt-authentication-value/index.ts"
import { completeAuthenticationProof } from "../../authentication/complete-authentication-proof/index.ts"
import { startAuthenticationProof } from "../../authentication/start-authentication-proof/index.ts"
import { getSelectedProviderRevision } from "../../identity/get-selected-provider-revision/index.ts"
import { resolveOrCreateExternalIdentity } from "../../identity/resolve-or-create-external-identity/index.ts"
import { runIdentityCreationTransaction } from "../../identity/run-identity-creation-transaction/index.ts"
import { runProviderRevisionTransaction } from "../../identity/run-provider-revision-transaction/index.ts"
import { validateAndPersistProviderRevision } from "../../identity/validate-and-persist-provider-revision/index.ts"
import { admitAuthenticationProof } from "../admit-authentication-proof/index.ts"
import { endHubSession } from "../end-hub-session/index.ts"
import { restoreHubSession } from "../restore-hub-session/index.ts"
import { verifyBootstrapSecret } from "../verify-bootstrap-secret/index.ts"

import type { AuthenticationRouteRuntime } from "../../../routes/api/authentication/types.ts"

const environmentSchema = z.looseObject({
  GITHUB_CLIENT_ID: z.string().min(1).max(200),
  GITHUB_CLIENT_SECRET: z.string().min(1).max(2_000),
  GITHUB_PROVIDER_REVISION: z.coerce.number().int().positive(),
  HUB_APPLICATION_ORIGIN: z.url().max(500),
  HUB_AUTHENTICATION_ENCRYPTION_KEY: z.string().min(1),
  HUB_BOOTSTRAP_SECRET: z.string().min(32).max(2_000),
})

export function createGitHubAuthenticationRuntime(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
): AuthenticationRouteRuntime {
  const parsed = environmentSchema.parse(environment)
  const origin = new URL(parsed.HUB_APPLICATION_ORIGIN)
  if (
    origin.origin !== parsed.HUB_APPLICATION_ORIGIN ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "http:" && origin.protocol !== "https:")
  ) {
    throw new Error("HUB_APPLICATION_ORIGIN must be an exact HTTP origin without a trailing slash.")
  }
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"])
  if (origin.protocol !== "https:" && !loopbackHosts.has(origin.hostname)) {
    throw new Error("HUB_APPLICATION_ORIGIN must use HTTPS outside loopback development.")
  }
  const callbackUri = new URL("/api/auth/github/callback", origin).toString()
  const adapter = createGitHubUserAuthenticationAdapter({
    clientSecret: parsed.GITHUB_CLIENT_SECRET,
    fetch: request,
    publicConfiguration: {
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      callbackUri,
      clientId: parsed.GITHUB_CLIENT_ID,
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userEndpoint: "https://api.github.com/user",
    },
  })
  const configurationDigest = createHash("sha256")
    .update(adapter.canonicalPublicConfiguration)
    .digest("hex")
  const encryptionKey = Buffer.from(parsed.HUB_AUTHENTICATION_ENCRYPTION_KEY, "base64")
  if (encryptionKey.length !== 32) {
    throw new Error("HUB_AUTHENTICATION_ENCRYPTION_KEY must decode to exactly 32 bytes.")
  }
  function selectedRevision() {
    return getSelectedProviderRevision(adapter.providerKey, {
      findAuthenticationProvider: (key) => findAuthenticationProvider(prisma, key),
    })
  }
  function writeAuthenticationDenial(
    reason: "configuration_changed" | "invalid_or_expired" | "provider_failed",
  ) {
    return createSecurityAudit(prisma, {
      id: randomUUID(),
      type: "authentication_attempt_denied",
      provider: adapter.providerKey,
      reason,
    })
  }
  function ensureProviderRevision() {
    return validateAndPersistProviderRevision(
      {
        configuration: {},
        providerKey: adapter.providerKey,
        revision: parsed.GITHUB_PROVIDER_REVISION,
      },
      {
        createId: randomUUID,
        runTransaction: (operation) => runProviderRevisionTransaction(prisma, operation),
        validateConfiguration: () =>
          Promise.resolve({
            canonicalPublicConfiguration: adapter.canonicalPublicConfiguration,
          }),
        writeAudit: (event) => createSecurityAudit(prisma, event),
      },
    )
  }

  return {
    applicationOrigin: origin.origin,
    secureCookie: origin.protocol === "https:",
    async start(purpose) {
      await ensureProviderRevision()
      return startAuthenticationProof(
        {},
        {
          adapter,
          callbackUri,
          configurationDigest,
          expectedRevision: parsed.GITHUB_PROVIDER_REVISION,
          createAttempt: (input) =>
            createAuthorizationAttempt(prisma, {
              ...input,
              purpose,
            }),
          createId: randomUUID,
          createOpaqueValue,
          deleteExpiredArtifacts: () => deleteExpiredAuthorizationAttempts(prisma),
          encryptCodeVerifier: (value) => encryptAuthenticationValue(value, encryptionKey),
          getSelectedProviderRevision: selectedRevision,
          writeDenialAudit: writeAuthenticationDenial,
        },
      )
    },
    complete(input) {
      return completeAuthenticationProof(input, {
        adapter,
        callbackUri,
        consumeAttempt: (value) => consumeAuthorizationAttempt(prisma, value),
        decryptCodeVerifier: (value) => decryptAuthenticationValue(value, encryptionKey),
        localConfigurationDigest: configurationDigest,
        localRevision: parsed.GITHUB_PROVIDER_REVISION,
        getSelectedProviderRevision: selectedRevision,
        resolveOrCreateIdentity: (value) =>
          resolveOrCreateExternalIdentity(value, {
            createId: randomUUID,
            runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
            writeAudit: (event) => createSecurityAudit(prisma, event),
          }),
        writeDenialAudit: writeAuthenticationDenial,
      })
    },
    admit(input) {
      return admitAuthenticationProof(
        {
          ...input,
          providerKey: adapter.providerKey,
          sessionLifetimeSeconds: 12 * 60 * 60,
        },
        { createId: randomUUID, database: prisma },
      )
    },
    restore(sessionDigest) {
      return restoreHubSession(sessionDigest, { createId: randomUUID, database: prisma })
    },
    end(sessionDigest) {
      return endHubSession(sessionDigest, { createId: randomUUID, database: prisma })
    },
    checkRateLimit(operation, subjectDigest) {
      return checkAuthenticationRateLimit(
        {
          limit: operation === "start" ? 10 : 30,
          operation,
          subjectDigest,
          windowSeconds: 60,
        },
        prisma,
      )
    },
    verifyBootstrapSecret(submittedSecret) {
      return verifyBootstrapSecret(parsed.HUB_BOOTSTRAP_SECRET, submittedSecret)
    },
    writeBootstrapDenial(reason) {
      return createSecurityAudit(prisma, {
        id: randomUUID(),
        type: "bootstrap_attempt_denied",
        reason,
      })
    },
  }
}
