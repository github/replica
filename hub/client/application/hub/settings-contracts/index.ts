import { z } from "zod"

import { NOTIFICATION_SCHEMA } from "@utils/notification/schemas"

import { repositorySchema, userSchema } from "../contracts"
import { sessionResponseSchema } from "../session-contracts"

const identifier = z.number().int().positive()
const confirmed = z.literal(true, { error: "Confirm the change before continuing." })
const timestamp = z.iso.datetime({ offset: true })

export const settingsQuerySchema = z.object({
  repositoryId: z.coerce.number().int().positive().optional(),
  unread: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  scope: z.enum(["repository", "hub"]).default("repository"),
  q: z.string().trim().max(100).default(""),
  change: z.enum(["credentials", "rotation", "reset"]).optional(),
})

export const analyticsEventSchema = z.enum([
  "prototype_registered",
  "build_published",
  "review_comment_created",
])

export const analyticsConfigurationSchema = z
  .object({
    provider: z.enum(["segment", "mixpanel", "custom"]),
    region: z.enum(["us", "eu", "in", "custom"]),
    name: z.string().trim().max(64).default(""),
    eventTypes: z.array(analyticsEventSchema).min(1, "Choose at least one event.").max(3),
    history: z.enum(["new", "retained"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider === "custom" && (!value.name || value.region !== "custom")) {
      context.addIssue({
        code: "custom",
        message: "Give the custom destination a name and use the custom region.",
      })
    }
    if (value.provider !== "custom" && value.region === "custom") {
      context.addIssue({ code: "custom", message: "Choose a provider region." })
    }
    if (value.provider === "segment" && value.region === "in") {
      context.addIssue({ code: "custom", message: "Choose the US or EU Segment region." })
    }
  })

export const analyticsDestinationSchema = z.object({
  id: identifier,
  repositoryId: identifier,
  configuration: analyticsConfigurationSchema,
  enabled: z.boolean(),
})

export const canvasGrantSchema = z.object({
  id: identifier,
  repositoryId: identifier,
  repository: z.string().min(1),
  viewerLogin: z.string().min(1),
  expiresAt: timestamp,
})

export const githubConfigurationSchema = z.object({
  state: z.enum(["not-configured", "ready", "registered", "installed"]),
  organization: z.string().trim().min(1).max(100),
  version: z.number().int().nonnegative(),
  rotation: z.enum(["idle", "pending", "confirmed"]),
  credentialRevision: z.number().int().nonnegative(),
})

export const administratorSchema = z.object({
  id: identifier,
  login: z.string().min(1),
  name: z.string().nullable(),
})

export const settingsCandidateResponseSchema = z.object({
  users: z.array(administratorSchema),
  more: z.boolean(),
})

export const learningRecordSchema = z.object({
  id: z.string().min(1),
  repositoryId: identifier,
  content: z.string().trim().min(1).max(2000),
  digest: z.string().min(1),
  evidenceId: z.string().min(1),
  version: identifier,
  state: z.enum(["suggested", "accepted", "rejected", "retired"]),
  decidedBy: z.string().nullable(),
  reason: z.string().nullable(),
})

export const learningRunSchema = z.object({
  id: identifier,
  repositoryId: identifier,
  startedAt: timestamp,
  startedBy: z.string().min(1),
  state: z.enum(["queued", "running", "succeeded"]),
})

export const settingsAuditEventSchema = z.object({
  id: identifier,
  createdAt: timestamp,
  actor: z.string().min(1),
  operation: z.string().min(1),
  repositoryId: identifier.nullable(),
  context: z.string().min(1),
})

export const authorizationContinuationSchema = z.object({
  id: z.string().min(1),
  operation: z.enum(["copilot-connect", "copilot-disconnect", "enroll"]),
  viewerLogin: z.string().min(1),
})

export const settingsPublicResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  session: sessionResponseSchema,
  github: githubConfigurationSchema,
  enrollmentComplete: z.boolean(),
  sessionRevoked: z.boolean(),
  continuation: authorizationContinuationSchema.nullable(),
})

export const settingsWorkspaceResponseSchema = settingsPublicResponseSchema.extend({
  repository: repositorySchema.nullable(),
  welcomeHidden: z.boolean(),
  analytics: z.array(analyticsDestinationSchema),
  grants: z.array(canvasGrantSchema),
  canvasApproval: z.object({
    code: z.string().min(1),
    consentVersion: z.string().min(1),
  }),
  copilot: z.object({ connected: z.boolean(), connectedBy: z.string().nullable() }),
  administrators: z.object({
    accessDenied: z.boolean(),
    users: z.array(administratorSchema),
  }),
  learnings: z.array(learningRecordSchema),
  learningRuns: z.array(learningRunSchema),
  notifications: z.object({
    items: z.array(NOTIFICATION_SCHEMA),
    unreadCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    unreadOnly: z.boolean(),
    limit: identifier,
  }),
  audit: z.object({
    accessDenied: z.boolean(),
    scope: z.enum(["repository", "hub"]),
    events: z.array(settingsAuditEventSchema),
    nextPage: identifier.nullable(),
  }),
  evidenceAuthor: userSchema.nullable(),
  evidencePrototype: z.object({ id: identifier, name: z.string().min(1) }).nullable(),
})

export const settingsOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("welcome-hide") }).strict(),
  z
    .object({
      operation: z.literal("analytics-save"),
      repositoryId: identifier,
      destinationId: identifier.optional(),
      configuration: analyticsConfigurationSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("analytics-state"),
      repositoryId: identifier,
      destinationId: identifier,
      state: z.enum(["paused", "enabled", "disconnected"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("canvas-approve"),
      repositoryId: identifier,
      consentVersion: z.string().min(1),
    })
    .strict(),
  z.object({ operation: z.literal("canvas-revoke"), grantId: identifier }).strict(),
  z.object({ operation: z.literal("copilot-connect"), confirmed }).strict(),
  z.object({ operation: z.literal("copilot-disconnect"), confirmed }).strict(),
  z
    .object({
      operation: z.literal("github-setup"),
      organization: z.string().trim().min(1).max(100),
    })
    .strict(),
  z.object({ operation: z.literal("github-register") }).strict(),
  z.object({ operation: z.literal("github-install") }).strict(),
  z
    .object({
      operation: z.literal("github-credentials"),
      expectedVersion: z.number().int().nonnegative(),
      confirmed,
    })
    .strict(),
  z
    .object({
      operation: z.literal("github-rotation"),
      expectedVersion: z.number().int().nonnegative(),
      phase: z.enum(["start", "retry", "finish"]),
      confirmed,
    })
    .strict(),
  z
    .object({
      operation: z.literal("github-reset"),
      expectedVersion: z.number().int().nonnegative(),
      confirmation: z.string().min(1, "Enter the confirmation phrase."),
      confirmed,
    })
    .strict(),
  z
    .object({
      operation: z.literal("admin-add"),
      userIds: z.array(identifier).min(1),
      confirmed,
    })
    .strict(),
  z
    .object({
      operation: z.literal("admin-change"),
      userId: identifier,
      change: z.enum(["designate", "revoke"]),
      confirmed,
    })
    .strict(),
  z.object({ operation: z.literal("enroll") }).strict(),
  z
    .object({
      operation: z.literal("authorize"),
      continuationId: authorizationContinuationSchema.shape.id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("authorization-cancel"),
      continuationId: authorizationContinuationSchema.shape.id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("learning-decide"),
      repositoryId: identifier,
      learningId: learningRecordSchema.shape.id,
      decision: z.enum(["accept", "reject", "retire"]),
      digest: z.string().max(100).optional(),
      content: z.string().trim().min(1).max(2000).optional(),
      reason: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  z.object({ operation: z.literal("learning-run"), repositoryId: identifier }).strict(),
  z
    .object({
      operation: z.literal("notification-read"),
      notificationId: identifier,
      version: z.number().int().nonnegative(),
      read: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal("session-revoke"), confirmed }).strict(),
  z.object({ operation: z.literal("session-cancel") }).strict(),
])

export const settingsMutationResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  notice: z.string().min(1),
  redirect: z
    .string()
    .regex(/^\/(?:settings(?:\/[a-z0-9/-]+)?|welcome|notifications)(?:\?[^#]*)?$/)
    .nullable(),
})
