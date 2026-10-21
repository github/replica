import { z } from "zod"

import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"

const IDENTIFIER_SCHEMA = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const DATE_TIME_SCHEMA = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const NULLABLE_DATE_TIME_SCHEMA = DATE_TIME_SCHEMA.nullable()
const AUTHOR_SCHEMA = z.object({
  login: z.string().min(1),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
})
export const REACTION_CONTENT_SCHEMA = z.enum([
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
])
const REACTION_SCHEMA = z.object({
  content: REACTION_CONTENT_SCHEMA,
  count: IDENTIFIER_SCHEMA,
  viewerHasReacted: z.boolean(),
})

const COMMON_COMMENT_FIELDS = {
  id: IDENTIFIER_SCHEMA,
  body: z.string().nullable(),
  mentions: z.array(z.object({ login: z.string().min(1), githubId: IDENTIFIER_SCHEMA })).optional(),
  createdAt: DATE_TIME_SCHEMA,
  updatedAt: DATE_TIME_SCHEMA,
  editedAt: NULLABLE_DATE_TIME_SCHEMA,
  deletedAt: NULLABLE_DATE_TIME_SCHEMA,
  author: AUTHOR_SCHEMA,
  viewerCanEdit: z.boolean(),
  viewerCanDelete: z.boolean(),
  reactions: z.array(REACTION_SCHEMA),
}

const ROOT_COMMENT_SCHEMA = z.object({
  ...COMMON_COMMENT_FIELDS,
  kind: z.literal("root"),
  buildNumber: IDENTIFIER_SCHEMA.nullable(),
  buildPath: z.string().startsWith("/").nullable(),
  draftRevisionId: IDENTIFIER_SCHEMA.nullable().optional(),
  anchor: REVIEW_ANCHOR_SCHEMA,
  resolvedAt: NULLABLE_DATE_TIME_SCHEMA,
  resolvedBy: AUTHOR_SCHEMA.nullable(),
  activityVersion: IDENTIFIER_SCHEMA,
  viewerLastSeenActivityVersion: IDENTIFIER_SCHEMA.nullable(),
})

const REPLY_COMMENT_SCHEMA = z.object({
  ...COMMON_COMMENT_FIELDS,
  kind: z.literal("reply"),
  rootId: IDENTIFIER_SCHEMA,
})

export const REVIEW_COMMENT_SCHEMA = z.discriminatedUnion("kind", [
  ROOT_COMMENT_SCHEMA,
  REPLY_COMMENT_SCHEMA,
])

export const REVIEW_COMMENT_PAGE_SCHEMA = z.discriminatedUnion("hasMore", [
  z.object({
    comments: z.array(REVIEW_COMMENT_SCHEMA),
    nextCursor: z.string().min(1),
    hasMore: z.literal(true),
  }),
  z.object({
    comments: z.array(REVIEW_COMMENT_SCHEMA),
    nextCursor: z.null(),
    hasMore: z.literal(false),
  }),
])

export const REVIEW_COMMENT_MUTATION_SCHEMA = z.object({
  comments: z.array(REVIEW_COMMENT_SCHEMA).min(1).max(2),
})
