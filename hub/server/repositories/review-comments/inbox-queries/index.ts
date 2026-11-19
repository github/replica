import type { Prisma } from "../../../generated/prisma/client.ts"
import { eligibleReviewPrototype } from "../collaboration-queries/index.ts"

export function findInboxRepositories(
  database: Pick<Prisma.TransactionClient, "repository">,
  scope: Prisma.RepositoryWhereInput,
  keys: string[],
  local: boolean,
) {
  return database.repository.findMany({
    where: {
      AND: [
        scope,
        { localPath: local ? { not: null } : null },
        {
          reviewThreads: {
            some: {
              comments: {
                some: {
                  deletedAt: null,
                  notifications: { some: { recipientKey: { in: keys } } },
                },
              },
            },
          },
        },
      ],
    },
    select: { id: true, nameWithOwner: true, defaultBranch: true },
  })
}

export function inboxWhere(
  keys: string[],
  repositories: { id: string; defaultBranch: string }[],
): Prisma.ReviewNotificationWhereInput {
  return {
    recipientKey: { in: keys },
    comment: {
      deletedAt: null,
      thread: {
        OR: repositories.map((repository) => ({
          repositoryId: repository.id,
          prototype: {
            ...eligibleReviewPrototype(repository),
            builds: { some: { state: "successful" } },
          },
        })),
      },
    },
  }
}

const include = {
  comment: {
    select: {
      publicId: true,
      body: true,
      root: { select: { publicId: true } },
      thread: {
        select: {
          repository: { select: { id: true, nameWithOwner: true } },
          prototype: {
            select: {
              id: true,
              name: true,
              branchName: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ReviewNotificationInclude

export type InboxActivity = Prisma.ReviewNotificationGetPayload<{ include: typeof include }>

export function findInboxPage(
  transaction: Prisma.TransactionClient,
  where: Prisma.ReviewNotificationWhereInput,
  input: { unread: boolean; limit: number; before?: number },
) {
  return transaction.reviewNotification.findMany({
    where: {
      ...where,
      ...(input.unread ? { readAt: null } : {}),
      ...(input.before === undefined ? {} : { publicId: { lt: input.before } }),
    },
    orderBy: { publicId: "desc" },
    take: input.limit + 1,
    include,
  })
}

export function findInboxActivity(
  transaction: Prisma.TransactionClient,
  where: Prisma.ReviewNotificationWhereInput,
  publicId: number,
) {
  return transaction.reviewNotification.findFirst({ where: { ...where, publicId }, include })
}

export function countUnreadInbox(
  transaction: Prisma.TransactionClient,
  where: Prisma.ReviewNotificationWhereInput,
) {
  return transaction.reviewNotification.count({ where: { ...where, readAt: null } })
}

export async function saveInboxRead(
  transaction: Prisma.TransactionClient,
  where: Prisma.ReviewNotificationWhereInput,
  id: string,
  version: number,
  read: boolean,
) {
  const updated = await transaction.reviewNotification.updateMany({
    where: { ...where, id, version },
    data: { readAt: read ? new Date() : null, version: { increment: 1 } },
  })
  return updated.count === 1
}

export function findSessionGitHubSubject(
  database: Pick<Prisma.TransactionClient, "hubSession">,
  digest: string,
) {
  return database.hubSession.findUnique({
    where: { digest },
    select: { externalIdentity: { select: { provider: true, issuer: true, subject: true } } },
  })
}
