import { z } from "zod"

import { REACTION_CONTENT_SCHEMA } from "@utils/review-comment/schemas"

export const NOTIFICATION_SCHEMA = z.object({
  id: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  actor: z.object({
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  kind: z.enum(["comment", "mention", "reply", "reaction", "resolved", "reopened"]),
  reactionContent: REACTION_CONTENT_SCHEMA.nullable().optional(),
  excerpt: z.string(),
  createdAt: z.string(),
  read: z.boolean(),
  repository: z.string(),
  prototype: z.string(),
  path: z.string().startsWith("/repositories/"),
  updatePath: z.string().startsWith("/notifications/"),
  target: z.object({
    prototypeId: z.number().int().positive(),
    threadId: z.number().int().positive(),
    commentId: z.number().int().positive(),
  }),
})

export const NOTIFICATION_PAGE_SCHEMA = z.object({
  notifications: z.array(NOTIFICATION_SCHEMA),
  nextBefore: z.number().int().positive().nullable(),
  unreadCount: z.number().int().nonnegative(),
})

export const NOTIFICATION_READ_SCHEMA = z.object({
  version: z.number().int().nonnegative(),
  read: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
})
