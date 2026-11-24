import { Prisma } from "../../../generated/prisma/client.ts"

export async function hasUnreadInbox(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  {
    keys,
    repositoryIds,
    local,
    githubMembershipId,
  }: { keys: string[]; repositoryIds: string[]; local: boolean; githubMembershipId?: string },
) {
  const githubGrant = githubMembershipId
    ? Prisma.sql`AND r.github_repository_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM repository_access_grants g
        WHERE g.repository_id = r.id AND g.membership_id = ${githubMembershipId}::uuid
      )`
    : Prisma.empty

  // Compare the prototype's branch to its repository's default in one join, not one OR arm per repository.
  const [result] = await database.$queryRaw<[{ unread: boolean }]>`
    SELECT EXISTS (
      SELECT 1 FROM review_notifications n
      JOIN review_comments c ON c.id = n.comment_id
      JOIN review_threads t ON t.id = c.thread_id
      JOIN repositories r ON r.id = t.repository_id
      JOIN prototypes p ON p.id = t.prototype_id
      WHERE n.recipient_key = ANY(${keys})
        AND n.read_at IS NULL
        AND c.deleted_at IS NULL
        AND r.id = ANY(${repositoryIds}::uuid[])
        AND r.removed_at IS NULL
        AND (r.local_path IS NOT NULL) = ${local}
        ${githubGrant}
        AND p.registered_at IS NOT NULL
        AND p.branch_deleted_at IS NULL
        AND NOT p.replica
        AND p.branch_name NOT IN (r.default_branch, 'replica/install-workflow')
        AND EXISTS (
          SELECT 1 FROM builds b WHERE b.prototype_id = p.id AND b.state = 'successful'
        )
    ) AS unread
  `
  return result.unread
}
