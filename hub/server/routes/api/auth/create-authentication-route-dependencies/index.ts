import { randomUUID } from "node:crypto"

import { admitAuthenticationProof } from "../../../../domains/admission/admit-authentication-proof/index.ts"
import { checkAuthenticationRateLimit } from "../../../../domains/admission/check-authentication-rate-limit/index.ts"
import { endHubSession } from "../../../../domains/admission/end-hub-session/index.ts"
import { restoreHubSession } from "../../../../domains/admission/restore-hub-session/index.ts"
import { runAdmissionTransaction } from "../../../../domains/admission/run-admission-transaction/index.ts"
import { runSessionRestoreTransaction } from "../../../../domains/admission/run-session-restore-transaction/index.ts"
import { verifyBootstrapSecret } from "../../../../domains/admission/verify-bootstrap-secret/index.ts"
import { completeAuthenticationProof } from "../../../../domains/authentication/complete-authentication-proof/index.ts"
import type { CompleteAuthenticationProofDependencies } from "../../../../domains/authentication/complete-authentication-proof/types.ts"
import { createOpaqueValue } from "../../../../domains/authentication/create-opaque-value/index.ts"
import { createGitHubAuthenticationContext } from "../../../../domains/authentication/create-github-authentication-context/index.ts"
import { decryptAuthenticationValue } from "../../../../domains/authentication/decrypt-authentication-value/index.ts"
import { encryptAuthenticationValue } from "../../../../domains/authentication/encrypt-authentication-value/index.ts"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { startAuthenticationProof } from "../../../../domains/authentication/start-authentication-proof/index.ts"
import { getSelectedProviderRevision } from "../../../../domains/identity/get-selected-provider-revision/index.ts"
import { resolveOrCreateExternalIdentity } from "../../../../domains/identity/resolve-or-create-external-identity/index.ts"
import { runIdentityCreationTransaction } from "../../../../domains/identity/run-identity-creation-transaction/index.ts"
import { runProviderRevisionTransaction } from "../../../../domains/identity/run-provider-revision-transaction/index.ts"
import { validateAndPersistProviderRevision } from "../../../../domains/identity/validate-and-persist-provider-revision/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { findAuthenticationProvider } from "../../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { consumeAuthorizationAttempt } from "../../../../repositories/authorization-attempts/consume-authorization-attempt/index.ts"
import { createAuthorizationAttempt } from "../../../../repositories/authorization-attempts/create-authorization-attempt/index.ts"
import { deleteExpiredAuthorizationAttempts } from "../../../../repositories/authorization-attempts/delete-expired-authorization-attempts/index.ts"
import { createSecurityAudit } from "../../../../repositories/security-audits/create-security-audit/index.ts"
import type { AuthenticationRouteDependencies } from "../types.ts"

export function createAuthenticationRouteDependencies(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
): AuthenticationRouteDependencies {
  const context = createGitHubAuthenticationContext(environment, request)
  function selectedRevision() {
    return getSelectedProviderRevision(context.adapter.providerKey, {
      findAuthenticationProvider: (key) => findAuthenticationProvider(prisma, key),
    })
  }
  function writeAuthenticationDenial(
    reason: Parameters<CompleteAuthenticationProofDependencies["writeDenialAudit"]>[0],
  ) {
    return createSecurityAudit(prisma, {
      id: randomUUID(),
      type: "authentication_attempt_denied",
      provider: context.adapter.providerKey,
      reason,
    })
  }
  function ensureProviderRevision() {
    return validateAndPersistProviderRevision(
      {
        configuration: {},
        providerKey: context.adapter.providerKey,
        revision: context.providerRevision,
      },
      {
        createId: randomUUID,
        runTransaction: (operation) => runProviderRevisionTransaction(prisma, operation),
        validateConfiguration: () =>
          Promise.resolve({
            canonicalPublicConfiguration: context.adapter.canonicalPublicConfiguration,
          }),
        writeAudit: (event) => createSecurityAudit(prisma, event),
      },
    )
  }
  function start(purpose: "SIGN_IN" | "ADMIN_ENROLLMENT") {
    return async () => {
      await ensureProviderRevision()
      return startAuthenticationProof(
        {},
        {
          adapter: context.adapter,
          callbackUri: context.callbackUri,
          configurationDigest: context.configurationDigest,
          expectedRevision: context.providerRevision,
          createAttempt: (input) =>
            createAuthorizationAttempt(prisma, {
              ...input,
              bootstrapSecretDigest:
                purpose === "ADMIN_ENROLLMENT"
                  ? hashAuthenticationValue(context.bootstrapSecret)
                  : null,
              purpose,
            }),
          createId: randomUUID,
          createOpaqueValue,
          deleteExpiredArtifacts: () => deleteExpiredAuthorizationAttempts(prisma),
          encryptCodeVerifier: (value) => encryptAuthenticationValue(value, context.encryptionKey),
          getSelectedProviderRevision: selectedRevision,
          writeDenialAudit: writeAuthenticationDenial,
        },
      )
    }
  }
  function checkRateLimit(
    operation: "start" | "callback",
    subjectDigest: string,
    auditFirstDenial = false,
  ) {
    return checkAuthenticationRateLimit(
      {
        auditFirstDenial,
        createId: randomUUID,
        limit: operation === "start" ? 10 : 30,
        operation,
        subjectDigest,
        windowSeconds: 60,
      },
      prisma,
    )
  }
  const sharedStart = {
    applicationOrigin: context.applicationOrigin,
    checkRateLimit,
    secureCookie: context.secureCookie,
  }
  return {
    signIn: { ...sharedStart, start: start("SIGN_IN") },
    administratorEnrollment: {
      ...sharedStart,
      checkRateLimit: (operation, subjectDigest) => checkRateLimit(operation, subjectDigest, true),
      start: start("ADMIN_ENROLLMENT"),
      verifyBootstrapSecret: (submittedSecret) =>
        verifyBootstrapSecret(context.bootstrapSecret, submittedSecret),
      writeBootstrapDenial: (reason) =>
        createSecurityAudit(prisma, {
          id: randomUUID(),
          type: "bootstrap_attempt_denied",
          reason,
        }),
    },
    callback: {
      checkRateLimit,
      secureCookie: context.secureCookie,
      complete: (input) =>
        completeAuthenticationProof(input, {
          adapter: context.adapter,
          callbackUri: context.callbackUri,
          consumeAttempt: (value) => consumeAuthorizationAttempt(prisma, value),
          decryptCodeVerifier: (value) => decryptAuthenticationValue(value, context.encryptionKey),
          localConfigurationDigest: context.configurationDigest,
          localRevision: context.providerRevision,
          getSelectedProviderRevision: selectedRevision,
          resolveOrCreateIdentity: (value) =>
            resolveOrCreateExternalIdentity(value, {
              createId: randomUUID,
              runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
              writeAudit: (event) => createSecurityAudit(prisma, event),
            }),
          writeDenialAudit: writeAuthenticationDenial,
        }),
      admit: (input) =>
        admitAuthenticationProof(
          {
            ...input,
            providerKey: context.adapter.providerKey,
            sessionLifetimeSeconds: 12 * 60 * 60,
          },
          {
            createId: randomUUID,
            getBootstrapSecretDigest: () => hashAuthenticationValue(context.bootstrapSecret),
            runTransaction: (operation) => runAdmissionTransaction(prisma, operation),
            writeAudit: (event) => createSecurityAudit(prisma, event),
          },
        ),
    },
    currentSession: {
      restore: (sessionDigest) =>
        restoreHubSession(sessionDigest, {
          runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
        }),
    },
    signOut: {
      applicationOrigin: context.applicationOrigin,
      secureCookie: context.secureCookie,
      end: (sessionDigest) =>
        endHubSession(sessionDigest, { createId: randomUUID, database: prisma }),
    },
  }
}
