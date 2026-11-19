import type { Prisma } from "../../../generated/prisma/client.ts"
import { reviewThreadInclude } from "../types.ts"

export function collaborationInclude(userId: string) {
  return {
    ...reviewThreadInclude,
    comments: {
      ...reviewThreadInclude.comments,
      include: {
        mentions: { select: { login: true, recipientKey: true } },
        reactions: { select: { content: true, userId: true } },
      },
    },
    reads: { where: { userId }, select: { activityVersion: true } },
  } satisfies Prisma.ReviewThreadInclude
}

export type CollaborationThread = Prisma.ReviewThreadGetPayload<{
  include: ReturnType<typeof collaborationInclude>
}>

export function eligibleReviewPrototype(
  repository: { id: string; defaultBranch: string },
  prototypeId?: string,
): Prisma.PrototypeWhereInput {
  return {
    id: prototypeId,
    repositoryId: repository.id,
    registeredAt: { not: null },
    branchDeletedAt: null,
    replica: false,
    branchName: { notIn: [repository.defaultBranch, "replica/install-workflow"] },
  }
}

export async function findReviewRepository(
  database: Pick<Prisma.TransactionClient, "repository">,
  repositoryId: string,
  prototypeId: string,
) {
  const repository = await database.repository.findFirst({
    where: { id: repositoryId, removedAt: null },
    select: { id: true, nameWithOwner: true, localPath: true, defaultBranch: true },
  })
  if (!repository) return null
  const available = await database.repository.findFirst({
    where: {
      id: repositoryId,
      removedAt: null,
      defaultBranch: repository.defaultBranch,
      prototypes: { some: eligibleReviewPrototype(repository, prototypeId) },
    },
    select: { id: true },
  })
  return available ? repository : null
}

export async function readMentionSource(
  database: Pick<Prisma.TransactionClient, "reviewComment">,
  repositoryId: string,
  prototypeId: string,
  publicId: number,
  authorId: string,
) {
  return database.reviewComment.findFirst({
    where: {
      publicId,
      authorId,
      deletedAt: null,
      thread: { repositoryId, prototypeId },
    },
    select: { body: true, mentions: { select: { login: true, recipientKey: true } } },
  })
}

export function findLocalReviewPeople(
  database: Pick<Prisma.TransactionClient, "userProfile">,
  login: string,
  exact: boolean,
) {
  return database.userProfile.findMany({
    where: {
      provider: "local",
      login: { ...(exact ? { equals: login } : { contains: login }), mode: "insensitive" },
      user: {
        membership: {
          lifecycle: "ACTIVE",
          assignments: {
            some: {
              lifecycle: "ACTIVE",
              externalIdentity: { provider: "local" },
              providerRevision: { selectedBy: { key: "local", enabled: true } },
            },
          },
        },
      },
    },
    select: { userId: true, login: true },
    orderBy: [{ login: "asc" }, { userId: "asc" }],
    take: exact ? 2 : 20,
  })
}

export async function reviewPersonKeys(
  database: Pick<Prisma.TransactionClient, "externalIdentity">,
  userIds: string[],
  local: boolean,
) {
  const keys = new Map(userIds.map((id) => [id, `user:${id}`]))
  if (local || !userIds.length) return keys
  const identities = await database.externalIdentity.findMany({
    where: { userId: { in: userIds }, provider: "github", issuer: "https://github.com" },
    select: { userId: true, subject: true },
    orderBy: { createdAt: "asc" },
  })
  for (const { userId, subject } of identities) {
    if (/^[1-9]\d{0,15}$/.test(subject) && keys.get(userId) === `user:${userId}`) {
      keys.set(userId, `github:${subject}`)
    }
  }
  return keys
}

export async function markReviewThreadRead(
  transaction: Prisma.TransactionClient,
  threadId: string,
  userId: string,
  version: number | null,
) {
  const identity = { threadId, userId }
  if (version === null) {
    await transaction.reviewThreadRead.deleteMany({ where: identity })
    return
  }
  const existing = await transaction.reviewThreadRead.findUnique({
    where: { threadId_userId: identity },
    select: { activityVersion: true },
  })
  if (!existing || version > existing.activityVersion) {
    await transaction.reviewThreadRead.upsert({
      where: { threadId_userId: identity },
      create: { ...identity, activityVersion: version },
      update: { activityVersion: version },
    })
  }
}

export function findReviewActivityContext(transaction: Prisma.TransactionClient, threadId: string) {
  return transaction.reviewThread.findUniqueOrThrow({
    where: { id: threadId },
    select: {
      prototype: { select: { authorId: true } },
      repository: { select: { localPath: true } },
      comments: {
        select: {
          id: true,
          authorId: true,
          deletedAt: true,
          mentions: { select: { id: true, login: true, recipientKey: true } },
        },
      },
    },
  })
}

export async function saveReviewActivity(
  transaction: Prisma.TransactionClient,
  activity: {
    commentId: string
    mentionIdsRemoved: string[]
    mentionsAdded: Prisma.ReviewMentionCreateManyInput[]
    changedMentionLogins: { id: string; login: string }[]
    notifications: Prisma.ReviewNotificationCreateManyInput[]
    deleteMessage?: boolean
  },
) {
  if (activity.deleteMessage) {
    await transaction.reviewNotification.deleteMany({ where: { commentId: activity.commentId } })
    await transaction.reviewMention.deleteMany({ where: { commentId: activity.commentId } })
    await transaction.reviewReaction.deleteMany({ where: { commentId: activity.commentId } })
    return
  }
  if (activity.mentionIdsRemoved.length) {
    await transaction.reviewMention.deleteMany({
      where: { id: { in: activity.mentionIdsRemoved } },
    })
  }
  if (activity.mentionsAdded.length) {
    await transaction.reviewMention.createMany({ data: activity.mentionsAdded })
  }
  for (const { id, login } of activity.changedMentionLogins) {
    await transaction.reviewMention.update({ where: { id }, data: { login } })
  }
  if (activity.notifications.length) {
    await transaction.reviewNotification.createMany({ data: activity.notifications })
  }
}
