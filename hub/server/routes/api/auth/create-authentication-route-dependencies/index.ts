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
import { createEntraAuthenticationContext } from "../../../../domains/authentication/create-entra-authentication-context/index.ts"
import { createGitHubAuthenticationContext } from "../../../../domains/authentication/create-github-authentication-context/index.ts"
import { createOpaqueValue } from "../../../../domains/authentication/create-opaque-value/index.ts"
import { createSharedAuthenticationContext } from "../../../../domains/authentication/create-shared-authentication-context/index.ts"
import { decryptAuthenticationValue } from "../../../../domains/authentication/decrypt-authentication-value/index.ts"
import { encryptAuthenticationValue } from "../../../../domains/authentication/encrypt-authentication-value/index.ts"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { startAuthenticationProof } from "../../../../domains/authentication/start-authentication-proof/index.ts"
import type { AuthenticationProviderAdapter } from "../../../../domains/authentication/types.ts"
import { ProviderConfigurationValidationError } from "../../../../domains/identity/errors.ts"
import { getSelectedProviderRevision } from "../../../../domains/identity/get-selected-provider-revision/index.ts"
import { reconcileAuthenticationProviders } from "../../../../domains/identity/reconcile-authentication-providers/index.ts"
import { resolveOrCreateExternalIdentity } from "../../../../domains/identity/resolve-or-create-external-identity/index.ts"
import { runIdentityCreationTransaction } from "../../../../domains/identity/run-identity-creation-transaction/index.ts"
import { runProviderRevisionTransaction } from "../../../../domains/identity/run-provider-revision-transaction/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { findAuthenticationProvider } from "../../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { consumeAuthorizationAttempt } from "../../../../repositories/authorization-attempts/consume-authorization-attempt/index.ts"
import { createAuthorizationAttempt } from "../../../../repositories/authorization-attempts/create-authorization-attempt/index.ts"
import { deleteExpiredAuthorizationAttempts } from "../../../../repositories/authorization-attempts/delete-expired-authorization-attempts/index.ts"
import { createSecurityAudit } from "../../../../repositories/security-audits/create-security-audit/index.ts"
import type {
  AuthenticationRouteDependencies,
  ProviderAuthenticationRouteDependencies,
} from "../types.ts"

interface AuthenticationContext {
  adapter: AuthenticationProviderAdapter & {
    canonicalPublicConfiguration: string
    validateConfiguration?: () => Promise<void>
  }
  applicationOrigin: string
  bootstrapSecret: string
  callbackIssuer?: string
  callbackUri: string
  configurationDigest: string
  encryptionKey: Buffer
  providerRevision: number
  requiresProviderAssignmentEvidence: boolean
  secureCookie: boolean
}

function githubConfigured(environment: NodeJS.ProcessEnv) {
  return Boolean(
    environment.GITHUB_CLIENT_ID ||
    environment.GITHUB_CLIENT_SECRET ||
    environment.GITHUB_PROVIDER_REVISION,
  )
}

function entraConfigured(environment: NodeJS.ProcessEnv) {
  return Boolean(
    environment.ENTRA_OIDC_CLIENT_AUTHENTICATION ||
    environment.ENTRA_OIDC_CLIENT_ID ||
    environment.ENTRA_OIDC_CLIENT_SECRET ||
    environment.ENTRA_OIDC_ISSUER ||
    environment.ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID ||
    environment.ENTRA_OIDC_PROVIDER_REVISION,
  )
}

function reconcileConfiguredProviders(
  candidates: Parameters<typeof reconcileAuthenticationProviders>[0],
) {
  return reconcileAuthenticationProviders(candidates, {
    createId: randomUUID,
    runTransaction: (operation) => runProviderRevisionTransaction(prisma, operation),
    writeAudit: (event) => createSecurityAudit(prisma, event),
  })
}

export async function disableAuthenticationProviders(): Promise<void> {
  await reconcileConfiguredProviders([])
}

export async function createAuthenticationRouteDependencies(
  environment: NodeJS.ProcessEnv,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<AuthenticationRouteDependencies> {
  const sharedContext = createSharedAuthenticationContext(environment)
  const githubContext = githubConfigured(environment)
    ? createGitHubAuthenticationContext(environment, request)
    : undefined
  const entraContext = entraConfigured(environment)
    ? createEntraAuthenticationContext(environment, request)
    : undefined
  const contexts: AuthenticationContext[] = []
  if (githubContext) contexts.push(githubContext)
  if (entraContext) contexts.push(entraContext)
  await Promise.all(
    contexts.map(async (context) => {
      try {
        await context.adapter.validateConfiguration?.()
      } catch (error) {
        const reported = new ProviderConfigurationValidationError({ cause: error })
        try {
          await createSecurityAudit(prisma, {
            id: randomUUID(),
            type: "provider_revision_validation_failed",
            providerKey: context.adapter.providerKey,
            revision: context.providerRevision,
          })
        } catch (auditError) {
          throw new AggregateError(
            [reported, auditError],
            "The provider validation failure and its audit could not both be recorded.",
            { cause: auditError },
          )
        }
        throw reported
      }
    }),
  )
  if (!contexts.length) {
    throw new Error("Configure at least one GitHub or Entra user sign-in provider.")
  }
  await reconcileConfiguredProviders(
    contexts.map((context) => ({
      canonicalPublicConfiguration: context.adapter.canonicalPublicConfiguration,
      providerKey: context.adapter.providerKey,
      revision: context.providerRevision,
    })),
  )

  function createProviderDependencies(
    context: AuthenticationContext,
  ): ProviderAuthenticationRouteDependencies {
    async function selectedRevision() {
      const provider = await findAuthenticationProvider(prisma, context.adapter.providerKey)
      if (!provider?.enabled) return null
      return getSelectedProviderRevision(context.adapter.providerKey, {
        findAuthenticationProvider: () => Promise.resolve(provider),
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
    function start(purpose: "SIGN_IN" | "ADMIN_ENROLLMENT") {
      return () =>
        startAuthenticationProof(
          { purpose },
          {
            adapter: context.adapter,
            callbackUri: context.callbackUri,
            configurationDigest: context.configurationDigest,
            expectedRevision: context.providerRevision,
            createAttempt: (input) =>
              createAuthorizationAttempt(prisma, {
                ...input,
                bootstrapSecretDigest:
                  input.purpose === "ADMIN_ENROLLMENT"
                    ? hashAuthenticationValue(context.bootstrapSecret)
                    : null,
              }),
            createId: randomUUID,
            createOpaqueValue,
            deleteExpiredArtifacts: () => deleteExpiredAuthorizationAttempts(prisma),
            encryptCodeVerifier: (value) =>
              encryptAuthenticationValue(value, context.encryptionKey),
            encryptNonce: (value) => encryptAuthenticationValue(value, context.encryptionKey),
            getSelectedProviderRevision: selectedRevision,
            writeDenialAudit: writeAuthenticationDenial,
          },
        )
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
        checkRateLimit: (operation, subjectDigest) =>
          checkRateLimit(operation, subjectDigest, true),
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
        callbackIssuer: context.callbackIssuer,
        checkRateLimit,
        secureCookie: context.secureCookie,
        complete: (input) =>
          completeAuthenticationProof(input, {
            adapter: context.adapter,
            callbackUri: context.callbackUri,
            consumeAttempt: (value) => consumeAuthorizationAttempt(prisma, value),
            decryptCodeVerifier: (value) =>
              decryptAuthenticationValue(value, context.encryptionKey),
            decryptNonce: (value) => decryptAuthenticationValue(value, context.encryptionKey),
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
              requiresProviderAssignmentEvidence: context.requiresProviderAssignmentEvidence,
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
    }
  }

  return {
    currentSession: {
      restore: (sessionDigest) =>
        restoreHubSession(sessionDigest, {
          runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
        }),
    },
    entra: entraContext ? createProviderDependencies(entraContext) : undefined,
    github: githubContext ? createProviderDependencies(githubContext) : undefined,
    signOut: {
      applicationOrigin: sharedContext.applicationOrigin,
      secureCookie: sharedContext.secureCookie,
      end: (sessionDigest) =>
        endHubSession(sessionDigest, { createId: randomUUID, database: prisma }),
    },
  }
}
