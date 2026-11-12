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
import { createLocalAuthenticationContext } from "../../../../domains/authentication/create-local-authentication-context/index.ts"
import { createOpaqueValue } from "../../../../domains/authentication/create-opaque-value/index.ts"
import { readAuthenticationConfigurationState } from "../../../../domains/authentication/read-authentication-configuration-state/index.ts"
import { createSharedAuthenticationContext } from "../../../../domains/authentication/create-shared-authentication-context/index.ts"
import { decryptAuthenticationValue } from "../../../../domains/authentication/decrypt-authentication-value/index.ts"
import { encryptAuthenticationValue } from "../../../../domains/authentication/encrypt-authentication-value/index.ts"
import { AuthenticationProofError } from "../../../../domains/authentication/errors.ts"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value/index.ts"
import { startAuthenticationProof } from "../../../../domains/authentication/start-authentication-proof/index.ts"
import type { AuthenticationProviderAdapter } from "../../../../domains/authentication/types.ts"
import { ProviderConfigurationValidationError } from "../../../../domains/identity/errors.ts"
import { reconcileAuthenticationProviders } from "../../../../domains/identity/reconcile-authentication-providers/index.ts"
import { resolveOrCreateExternalIdentity } from "../../../../domains/identity/resolve-or-create-external-identity/index.ts"
import { runIdentityCreationTransaction } from "../../../../domains/identity/run-identity-creation-transaction/index.ts"
import { runProviderRevisionTransaction } from "../../../../domains/identity/run-provider-revision-transaction/index.ts"
import { continueAdministratorAuthorization } from "../../../../domains/administrator-authorization/continue-administrator-authorization/index.ts"
import { AdministratorAuthorizationDeniedError } from "../../../../domains/administrator-authorization/errors.ts"
import { verifyAdministratorAuthorization } from "../../../../domains/administrator-authorization/verify-administrator-authorization/index.ts"
import { runAdministratorAuthorizationVerificationTransaction } from "../../../../domains/administrator-authorization/run-administrator-authorization-verification-transaction/index.ts"
import { listEffectiveAdministrators } from "../../../../domains/administrator-management/list-effective-administrators/index.ts"
import { prisma } from "../../../../integrations/prisma/index.ts"
import { findLatestAuthenticationProviderRevision } from "../../../../repositories/authentication-providers/find-latest-authentication-provider-revision/index.ts"
import { getAuthenticationProofState } from "../../../../repositories/authentication-providers/get-authentication-proof-state/index.ts"
import { findCurrentSessionProfile } from "../../../../repositories/user-profiles/find-current-session-profile/index.ts"
import { consumeAuthorizationAttempt } from "../../../../repositories/authorization-attempts/consume-authorization-attempt/index.ts"
import { createAuthorizationAttempt } from "../../../../repositories/authorization-attempts/create-authorization-attempt/index.ts"
import { deleteExpiredAuthorizationAttempts } from "../../../../repositories/authorization-attempts/delete-expired-authorization-attempts/index.ts"
import { createSecurityAudit } from "../../../../repositories/security-audits/create-security-audit/index.ts"
import { listSecurityAudits } from "../../../../repositories/security-audits/list-security-audits/index.ts"
import { upsertUserProfile } from "../../../../repositories/user-profiles/upsert-user-profile/index.ts"
import { findAdministratorHubSession } from "../../../../repositories/hub-sessions/find-administrator-hub-session/index.ts"
import { searchAdministratorCandidates } from "../../../../repositories/memberships/search-administrator-candidates/index.ts"
import { cancelSensitiveAuthorization } from "../../../../repositories/sensitive-authorizations/cancel-sensitive-authorization/index.ts"
import { createSensitiveAuthorization } from "../../../../repositories/sensitive-authorizations/create-sensitive-authorization/index.ts"
import { getSensitiveAuthorizationAuditData } from "../../../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data/index.ts"
import { getSensitiveAuthorization } from "../../../../repositories/sensitive-authorizations/get-sensitive-authorization/index.ts"
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
  const configuration = readAuthenticationConfigurationState(environment)
  const githubContext = configuration.githubConfigured
    ? createGitHubAuthenticationContext(environment, request)
    : undefined
  const entraContext = configuration.entraConfigured
    ? createEntraAuthenticationContext(environment, request)
    : undefined
  const localContext = configuration.localConfigured
    ? createLocalAuthenticationContext(
        environment,
        await findLatestAuthenticationProviderRevision(prisma, "local"),
      )
    : undefined
  const contexts: AuthenticationContext[] = []
  if (githubContext) contexts.push(githubContext)
  if (entraContext) contexts.push(entraContext)
  if (localContext) contexts.push(localContext)
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
            getAuthenticationProofState: () =>
              getAuthenticationProofState(prisma, context.adapter.providerKey),
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
      administratorAuthorization: {
        ...sharedStart,
        start: async (input) => {
          const authorizationId = randomUUID()
          await prisma.$transaction(async (transaction) => {
            const authorization = await createSensitiveAuthorization(transaction, {
              ...input,
              id: authorizationId,
              lifetimeSeconds: 5 * 60,
            })
            if (!authorization) {
              throw new AdministratorAuthorizationDeniedError("not_authorized")
            }
            await createSecurityAudit(transaction, {
              actorMembershipId: input.actorMembershipId,
              authorizationId,
              id: randomUUID(),
              operation: input.operation,
              phase: "requested",
              targetCount: input.targetMembershipIds.length,
              type: "administrator_authorization",
            })
          })
          const started = await startAuthenticationProof(
            {
              purpose: "ADMINISTRATOR_MANAGEMENT",
              sensitiveAuthorizationId: authorizationId,
            },
            {
              adapter: context.adapter,
              callbackUri: context.callbackUri,
              configurationDigest: context.configurationDigest,
              expectedRevision: context.providerRevision,
              createAttempt: (attempt) =>
                createAuthorizationAttempt(prisma, {
                  ...attempt,
                  bootstrapSecretDigest: null,
                }),
              createId: randomUUID,
              createOpaqueValue,
              deleteExpiredArtifacts: () => deleteExpiredAuthorizationAttempts(prisma),
              encryptCodeVerifier: (value) =>
                encryptAuthenticationValue(value, context.encryptionKey),
              encryptNonce: (value) => encryptAuthenticationValue(value, context.encryptionKey),
              getAuthenticationProofState: () =>
                getAuthenticationProofState(prisma, context.adapter.providerKey),
              writeDenialAudit: writeAuthenticationDenial,
            },
          )
          return {
            authorizationId,
            authorizationUrl: started.authorizationUrl,
            browserBinding: started.browserBinding,
            expiresAt: started.expiresAt,
          }
        },
      },
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
            getAuthenticationProofState: () =>
              getAuthenticationProofState(prisma, context.adapter.providerKey),
            resolveOrCreateIdentity: (value) =>
              resolveOrCreateExternalIdentity(
                {
                  issuer: value.issuer,
                  provider: value.provider,
                  subject: value.subject,
                },
                {
                  createId: randomUUID,
                  isExpectedTransactionDenial: (error) => error instanceof AuthenticationProofError,
                  runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
                  validateTransaction: async (repositories) => {
                    const provider = await repositories.lockProvider(context.adapter.providerKey)
                    const revocation = await repositories.lockRevocation()
                    const attempt = await repositories.lockAttempt(value.authorizationAttemptId)
                    if (
                      !provider?.enabled ||
                      !revocation ||
                      !attempt?.consumedAt ||
                      provider.selectedRevisionId !== value.providerRevisionId ||
                      attempt.providerRevisionId !== value.providerRevisionId ||
                      revocation.revision !== value.sessionRevocationRevision ||
                      attempt.sessionRevocationRevision !== value.sessionRevocationRevision
                    ) {
                      throw new AuthenticationProofError(
                        "configuration_changed",
                        "The authentication provider configuration changed during this attempt.",
                      )
                    }
                  },
                  writeAudit: (event) => createSecurityAudit(prisma, event),
                },
              ),
            updateIdentityProfile: (value) => upsertUserProfile(prisma, value),
            writeDenialAudit: writeAuthenticationDenial,
          }),
        verifyAdministratorAuthorization: async (input) => {
          return verifyAdministratorAuthorization(
            {
              ...input,
              providerKey: context.adapter.providerKey,
              requiresProviderAssignmentEvidence: context.requiresProviderAssignmentEvidence,
            },
            {
              createId: randomUUID,
              getAuthorizationAuditData: (id) => getSensitiveAuthorizationAuditData(prisma, id),
              runTransaction: (operation) =>
                runAdministratorAuthorizationVerificationTransaction(prisma, operation),
              writeAudit: (event) => createSecurityAudit(prisma, event),
            },
          )
        },
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

  const github = githubContext ? createProviderDependencies(githubContext) : undefined
  const entra = entraContext ? createProviderDependencies(entraContext) : undefined
  const local = localContext ? createProviderDependencies(localContext) : undefined
  return {
    administrators: {
      applicationOrigin: sharedContext.applicationOrigin,
      cancel: async (input) => {
        return prisma.$transaction(async (transaction) => {
          const cancelled = await cancelSensitiveAuthorization(transaction, {
            id: input.authorizationId,
            hubSessionId: input.hubSessionId,
          })
          if (!cancelled) return false
          await createSecurityAudit(transaction, {
            actorMembershipId: cancelled.actorMembershipId,
            authorizationId: cancelled.id,
            id: randomUUID(),
            operation: cancelled.operation,
            phase: "cancelled",
            targetCount: cancelled.targetCount,
            type: "administrator_authorization",
          })
          return true
        })
      },
      continue: (input) =>
        continueAdministratorAuthorization(prisma, {
          hubSessionId: input.hubSessionId,
          id: input.authorizationId,
          operation: input.operation,
          targetMembershipIds: input.targetMembershipIds,
        }),
      findSession: (sessionDigest) => findAdministratorHubSession(prisma, sessionDigest),
      getAuthorization: (input) =>
        getSensitiveAuthorization(prisma, {
          hubSessionId: input.hubSessionId,
          id: input.authorizationId,
        }),
      list: (input) => listEffectiveAdministrators(prisma, input),
      listSecurityAudits: (input) => listSecurityAudits(prisma, input),
      search: (input) => searchAdministratorCandidates(prisma, input),
      start: {
        entra: entra?.administratorAuthorization,
        github: github?.administratorAuthorization,
        local: local?.administratorAuthorization,
      },
    },
    currentSession: {
      restore: async (sessionDigest) => {
        const session = await restoreHubSession(sessionDigest, {
          runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
        })
        if (!session) return null
        const profile = await findCurrentSessionProfile(prisma, session)
        if (!profile) return null
        return {
          membershipId: session.membershipId,
          userId: session.userId,
          role: session.role,
          ...profile,
        }
      },
    },
    entra,
    github,
    local,
    signOut: {
      applicationOrigin: sharedContext.applicationOrigin,
      secureCookie: sharedContext.secureCookie,
      end: (sessionDigest) =>
        endHubSession(sessionDigest, { createId: randomUUID, database: prisma }),
    },
  }
}
