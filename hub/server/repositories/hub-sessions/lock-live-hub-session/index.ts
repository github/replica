import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockLiveHubSession(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  id: string,
): Promise<boolean> {
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT session."id"
    FROM "hub_sessions" session
    JOIN "memberships" membership ON membership."id" = session."membership_id"
    JOIN "session_revocation_states" revocation ON revocation."key" = 'global'
    JOIN "authentication_provider_revisions" revision
      ON revision."id" = session."provider_revision_id"
    JOIN "authentication_providers" provider ON provider."id" = revision."provider_id"
    WHERE session."id" = ${id}::uuid
      AND session."ended_at" IS NULL
      AND session."expires_at" > clock_timestamp()
      AND session."revocation_revision" = revocation."revision"
      AND membership."lifecycle" = 'ACTIVE'
      AND provider."enabled" = true
      AND provider."selected_revision_id" = revision."id"
    FOR UPDATE OF session, membership
    FOR SHARE OF revocation, revision, provider
  `
  return rows.length === 1
}
