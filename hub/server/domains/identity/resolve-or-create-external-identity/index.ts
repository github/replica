import { ExternalIdentityCollisionError, IdentityTransactionConflictError } from "../errors.ts"
import { parseExternalIdentityTuple } from "../parse-external-identity-tuple/index.ts"
import { runWithBoundedRetries } from "../run-with-bounded-retries/index.ts"
import type {
  ResolveOrCreateExternalIdentityDependencies,
  ResolveOrCreateExternalIdentityInput,
  ResolveOrCreateExternalIdentityResult,
} from "./types.ts"

export async function resolveOrCreateExternalIdentity(
  input: ResolveOrCreateExternalIdentityInput,
  dependencies: ResolveOrCreateExternalIdentityDependencies,
): Promise<ResolveOrCreateExternalIdentityResult> {
  const tuple = parseExternalIdentityTuple(input)

  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction(async (repositories) => {
          const existing = await repositories.findExternalIdentity(tuple)
          if (existing) {
            return {
              status: "found",
              externalIdentityId: existing.id,
              userId: existing.userId,
            }
          }

          const userId = dependencies.createId()
          const externalIdentityId = dependencies.createId()
          await repositories.createUser({ id: userId })
          await repositories.createExternalIdentity({
            id: externalIdentityId,
            userId,
            provider: tuple.provider,
            issuer: tuple.issuer,
            subject: tuple.subject,
          })
          await repositories.createSecurityAudit({
            id: dependencies.createId(),
            type: "external_identity_created",
            externalIdentityId,
            provider: tuple.provider,
            issuer: tuple.issuer,
          })

          return { status: "created", externalIdentityId, userId }
        }),
      {
        ...dependencies.retry,
        shouldRetry: (error) => error instanceof IdentityTransactionConflictError,
      },
    )
  } catch (error) {
    const failure =
      error instanceof IdentityTransactionConflictError
        ? new ExternalIdentityCollisionError({ cause: error })
        : error
    try {
      await dependencies.writeAudit({
        id: dependencies.createId(),
        type: "external_identity_create_failed",
        provider: tuple.provider,
        issuer: tuple.issuer,
        reason:
          error instanceof IdentityTransactionConflictError
            ? "retry_exhausted"
            : "transaction_error",
      })
    } catch (auditError) {
      throw new AggregateError(
        [failure, auditError],
        "The external identity failure and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw failure
  }
}
