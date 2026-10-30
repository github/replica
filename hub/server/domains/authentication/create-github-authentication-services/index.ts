import { createHash, randomUUID } from "node:crypto"

import { createGitHubUserAuthenticationAdapter } from "../../../integrations/github/create-user-authentication-adapter/index.ts"
import { prisma } from "../../../integrations/prisma/index.ts"
import { createAuthorizationAttempt } from "../../../repositories/authorization-attempts/create-authorization-attempt/index.ts"
import { consumeAuthorizationAttempt } from "../../../repositories/authorization-attempts/consume-authorization-attempt/index.ts"
import { countRecentAuthorizationAttempts } from "../../../repositories/authorization-attempts/count-recent-authorization-attempts/index.ts"
import { deleteExpiredAuthorizationAttempts } from "../../../repositories/authorization-attempts/delete-expired-authorization-attempts/index.ts"
import { deleteExpiredAdmissionHandoffs } from "../../../repositories/admission-handoffs/delete-expired-admission-handoffs/index.ts"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import type { GitHubAuthenticationRoutesDependencies } from "../../../routes/api/auth/github/types.ts"
import { createBoundedRateLimiter } from "../../../utils/authentication/create-bounded-rate-limiter/index.ts"
import { createOpaqueValue } from "../../../utils/authentication/create-opaque-value/index.ts"
import { decryptAuthenticationValue } from "../../../utils/authentication/decrypt-authentication-value/index.ts"
import { encryptAuthenticationValue } from "../../../utils/authentication/encrypt-authentication-value/index.ts"
import { getSelectedProviderRevision } from "../../identity/get-selected-provider-revision/index.ts"
import { resolveOrCreateExternalIdentity } from "../../identity/resolve-or-create-external-identity/index.ts"
import { runIdentityCreationTransaction } from "../../identity/run-identity-creation-transaction/index.ts"
import { runProviderRevisionTransaction } from "../../identity/run-provider-revision-transaction/index.ts"
import { validateAndPersistProviderRevision } from "../../identity/validate-and-persist-provider-revision/index.ts"
import { completeAuthenticationProof } from "../complete-authentication-proof/index.ts"
import { createAuthenticationAdmissionHandoff } from "../create-admission-handoff/index.ts"
import { startAuthenticationProof } from "../start-authentication-proof/index.ts"
import type { GitHubAuthenticationConfiguration } from "./types.ts"

export async function createGitHubAuthenticationServices(
  configuration: GitHubAuthenticationConfiguration,
): Promise<GitHubAuthenticationRoutesDependencies> {
  const adapter = createGitHubUserAuthenticationAdapter({
    clientSecret: configuration.clientSecret,
    publicConfiguration: configuration.publicConfiguration,
  })
  await validateAndPersistProviderRevision(
    {
      providerKey: adapter.providerKey,
      revision: configuration.revision,
      configuration: configuration.publicConfiguration,
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
  const configurationDigest = createHash("sha256")
    .update(adapter.canonicalPublicConfiguration)
    .digest("hex")
  function getRevision() {
    return getSelectedProviderRevision(adapter.providerKey, {
      findAuthenticationProvider: (key) => findAuthenticationProvider(prisma, key),
    })
  }
  function now() {
    return new Date()
  }

  return {
    appOrigin: configuration.appOrigin,
    secureCookies: configuration.secureCookies,
    now,
    callbackRateLimiter: createBoundedRateLimiter({
      limit: 20,
      maxKeys: 10_000,
      windowMs: 10 * 60 * 1_000,
    }),
    start: (input) =>
      startAuthenticationProof(input, {
        adapter,
        callbackUri: adapter.callbackUri,
        configurationDigest,
        expectedRevision: configuration.revision,
        createAttempt: (attempt) => createAuthorizationAttempt(prisma, attempt),
        createId: randomUUID,
        createOpaqueValue,
        deleteExpiredArtifacts: async (date) => {
          await deleteExpiredAuthorizationAttempts(prisma, date)
          await deleteExpiredAdmissionHandoffs(prisma, date)
        },
        encryptCodeVerifier: (value) =>
          encryptAuthenticationValue(value, configuration.encryptionKey),
        getSelectedProviderRevision: getRevision,
        now,
        recentAttemptCount: (attempt) => countRecentAuthorizationAttempts(prisma, attempt),
        writeDenialAudit: (reason) =>
          createSecurityAudit(prisma, {
            id: randomUUID(),
            type: "authentication_attempt_denied",
            provider: adapter.providerKey,
            reason,
          }),
      }),
    complete: (input) =>
      completeAuthenticationProof(input, {
        adapter,
        callbackUri: adapter.callbackUri,
        consumeAttempt: (attempt) => consumeAuthorizationAttempt(prisma, attempt),
        createHandoff: (handoff) =>
          createAuthenticationAdmissionHandoff(prisma, {
            ...handoff,
            providerKey: adapter.providerKey,
          }),
        createOpaqueValue,
        decryptCodeVerifier: (value) =>
          decryptAuthenticationValue(value, configuration.encryptionKey),
        getSelectedProviderRevision: getRevision,
        now,
        resolveOrCreateIdentity: (identity) =>
          resolveOrCreateExternalIdentity(identity, {
            createId: randomUUID,
            runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
            writeAudit: (event) => createSecurityAudit(prisma, event),
          }),
        writeDenialAudit: (reason) =>
          createSecurityAudit(prisma, {
            id: randomUUID(),
            type: "authentication_attempt_denied",
            provider: adapter.providerKey,
            reason,
          }),
      }),
  }
}
