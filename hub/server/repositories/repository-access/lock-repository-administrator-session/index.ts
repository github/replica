import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Rereads and locks a live Hub session together with its current repository
 * administrator evidence so a mutation has one fail-closed authorization point.
 */
export async function lockRepositoryAdministratorSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: {
    membershipId: string
    repositoryId: string
    sessionDigest: string
  },
): Promise<boolean> {
  const [candidate] = await database.$queryRaw<
    Array<{
      membershipId: string
      providerKey: string
      providerRevisionId: string
      revocationRevision: number
      sessionId: string
    }>
  >`
    SELECT
      session."id" AS "sessionId",
      session."membership_id" AS "membershipId",
      session."provider_revision_id" AS "providerRevisionId",
      session."revocation_revision" AS "revocationRevision",
      provider."key" AS "providerKey"
    FROM "hub_sessions" AS session
    INNER JOIN "authentication_provider_revisions" AS revision
      ON revision."id" = session."provider_revision_id"
    INNER JOIN "authentication_providers" AS provider
      ON provider."id" = revision."provider_id"
    WHERE session."digest" = ${input.sessionDigest}
  `
  if (!candidate || candidate.membershipId !== input.membershipId) return false

  const providers = await database.$queryRaw<
    Array<{ enabled: boolean; key: string; selectedRevisionId: string | null }>
  >`
    SELECT
      "enabled",
      "key",
      "selected_revision_id" AS "selectedRevisionId"
    FROM "authentication_providers"
    WHERE "key" IN ('github', ${candidate.providerKey})
    ORDER BY "key"
    FOR SHARE
  `
  const githubProvider = providers.find(({ key }) => key === "github")
  const sessionProvider = providers.find(({ key }) => key === candidate.providerKey)
  if (
    !githubProvider?.enabled ||
    !githubProvider.selectedRevisionId ||
    !sessionProvider?.enabled ||
    sessionProvider.selectedRevisionId !== candidate.providerRevisionId
  ) {
    return false
  }

  const [revocation] = await database.$queryRaw<Array<{ revision: number }>>`
    SELECT "revision"
    FROM "session_revocation_states"
    WHERE "key" = 'global'
    FOR SHARE
  `
  if (revocation?.revision !== candidate.revocationRevision) return false

  const [membership] = await database.$queryRaw<Array<{ lifecycle: string }>>`
    SELECT "lifecycle"::text
    FROM "memberships"
    WHERE "id" = ${input.membershipId}::uuid
    FOR SHARE
  `
  if (membership?.lifecycle !== "ACTIVE") return false

  const [session] = await database.$queryRaw<
    Array<{
      id: string
      membershipId: string
      providerRevisionId: string
      revocationRevision: number
    }>
  >`
    SELECT
      "id",
      "membership_id" AS "membershipId",
      "provider_revision_id" AS "providerRevisionId",
      "revocation_revision" AS "revocationRevision"
    FROM "hub_sessions"
    WHERE "digest" = ${input.sessionDigest}
      AND "ended_at" IS NULL
      AND "expires_at" > clock_timestamp()
    FOR UPDATE
  `
  if (
    session?.id !== candidate.sessionId ||
    session.membershipId !== input.membershipId ||
    session.providerRevisionId !== candidate.providerRevisionId ||
    session.revocationRevision !== revocation.revision
  ) {
    return false
  }

  const [repository] = await database.$queryRaw<
    Array<{ githubRepositoryId: bigint | null; removedAt: Date | null }>
  >`
    SELECT
      "github_repository_id" AS "githubRepositoryId",
      "removed_at" AS "removedAt"
    FROM "repositories"
    WHERE "id" = ${input.repositoryId}::uuid
    FOR SHARE
  `
  if (repository?.removedAt !== null || repository.githubRepositoryId === null) return false

  const [grant] = await database.$queryRaw<Array<{ accessLevel: string }>>`
    SELECT "access_level"::text AS "accessLevel"
    FROM "repository_access_grants"
    WHERE "membership_id" = ${input.membershipId}::uuid
      AND "repository_id" = ${input.repositoryId}::uuid
    FOR SHARE
  `
  return grant?.accessLevel === "ADMIN"
}
