import { z } from "zod"

import { normalizeStartPage } from "@utils/normalize-start-page"

const identifier = z.number().int().positive()
const httpUrl = z.url({ protocol: /^https?$/ })
const timestamp = z.iso.datetime({ offset: true })
const buildStateSchema = z.enum(["failed", "queued", "running", "successful", "superseded"])

// Keep numeric mock IDs while accepting UUIDs from the API.
export const recordIdentifierSchema = z
  .string()
  .regex(/^(?:[1-9]\d*|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i)

export const routeIdentifierSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(identifier)

export const userSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatarUrl: httpUrl.nullable(),
  provider: z.string().min(1).optional(),
})

export const repositorySchema = z.object({
  id: recordIdentifierSchema,
  nameWithOwner: z.string().min(1),
  defaultBranch: z.string().min(1),
})

export const buildSchema = z.object({
  number: identifier,
  repositoryId: recordIdentifierSchema,
  prototypeId: recordIdentifierSchema,
  state: buildStateSchema,
  commitSha: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i)
    .nullable(),
  commitAuthorProvider: z.string().min(1).nullable().optional(),
  commitAuthorIssuer: z.string().min(1).nullable().optional(),
  commitAuthorProviderUserId: z.string().min(1).nullable().optional(),
  commitAuthorLogin: z.string().nullable(),
  commitAuthorName: z.string().nullable().optional(),
  commitAuthorAvatarUrl: httpUrl.nullable().optional(),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  previewUrl: httpUrl.nullable(),
  desktopScreenshotUrl: httpUrl.nullable(),
  narrowScreenshotUrl: httpUrl.nullable(),
  failureSummary: z.string().nullable(),
})

export const prototypeSchema = z.object({
  id: recordIdentifierSchema,
  repositoryId: recordIdentifierSchema,
  name: z.string().min(1),
  branchName: z.string().min(1),
  description: z.string().nullable(),
  startPage: z.string().nullable().optional(),
  authorLogin: z.string().min(1).nullable(),
  authorName: z.string().nullable().optional(),
  authorProvider: z.string().min(1).nullable().optional(),
  canEdit: z.boolean(),
  latestBuild: z.object({ number: identifier, state: buildStateSchema }).nullable().optional(),
  builds: z.array(buildSchema),
})

export const paginationSchema = z.object({
  page: identifier,
  pageSize: identifier,
  totalCount: z.number().int().nonnegative(),
  pageCount: identifier,
})

export const workspaceCapabilitiesSchema = z.object({
  createPrototypes: z.boolean(),
  reviewPrototypes: z.boolean(),
  manageSharing: z.boolean(),
  administerHub: z.boolean(),
})

export const workspaceResponseSchema = z.object({
  viewer: userSchema,
  repositories: z.array(repositorySchema),
  capabilities: workspaceCapabilitiesSchema.optional(),
  navigation: z
    .object({
      welcomeHidden: z.boolean(),
      notificationsUnreadCount: z.number().int().nonnegative(),
    })
    .optional(),
})

export const repositoryResponseSchema = z.object({
  repository: repositorySchema,
  prototypes: z.array(
    prototypeSchema.extend({
      authorId: z.string().nullable().optional(),
      authorLogin: z.string().min(1).nullable(),
    }),
  ),
  pagination: paginationSchema,
  authors: z.array(userSchema),
})

export const prototypeResponseSchema = z.object({
  repository: repositorySchema,
  prototype: prototypeSchema,
  selectedBuild: buildSchema.nullable(),
  controlsIdentity: z.string().min(1).max(128).optional(),
  showPrototypeInfo: z.boolean().optional(),
})

export const buildHistoryResponseSchema = z.object({
  repository: repositorySchema,
  prototype: prototypeSchema,
  builds: z.array(buildSchema),
  pagination: paginationSchema,
})

export const authorResultsSchema = z.object({
  authors: z.array(userSchema),
  nextCursor: z.string().nullable(),
})

export const prototypeDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a prototype name.")
      .max(120, "Use at most 120 characters for the prototype name."),
    description: z
      .string()
      .trim()
      .max(4000, "Use at most 4,000 characters for the description.")
      .nullable(),
  })
  .strict()

const metadataSpace = /^[\s\u0085]$/u

function trimMetadata(value: string) {
  let start = 0
  let end = value.length
  while (start < end && metadataSpace.test(value.charAt(start))) start += 1
  while (end > start && metadataSpace.test(value.charAt(end - 1))) end -= 1
  return value.slice(start, end)
}

export const prototypeStartPageSchema = z.string().transform((value, context) => {
  const startPage = normalizeStartPage(trimMetadata(value) || "/")
  if (startPage !== null) return startPage
  context.addIssue({
    code: "custom",
    message: "Enter a local route of at most 2,048 bytes, such as /settings.",
  })
  return z.NEVER
})

export const prototypeEditSchema = z
  .object({
    name: z
      .string()
      .transform(trimMetadata)
      .refine((value) => value.length > 0, "Enter a prototype name.")
      .refine((value) => !/[\p{Cs}\0]/u.test(value), "Remove unsupported characters from the name.")
      .refine(
        (value) => [...value].length <= 255,
        "Use at most 255 characters for the prototype name.",
      ),
    description: z
      .string()
      .nullable()
      .transform((value) => (value === null ? null : trimMetadata(value) || null))
      .refine(
        (value) => !value || !/[\p{Cs}\0]/u.test(value),
        "Remove unsupported characters from the description.",
      )
      .refine(
        (value) => !value || [...value].length <= 500,
        "Use at most 500 characters for the description.",
      ),
    startPage: prototypeStartPageSchema
      .nullable()
      .transform((value) => value ?? "/")
      .optional(),
  })
  .strict()

export const apiErrorSchema = z.object({ error: z.string().min(1) })

export const routeQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  author: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().positive().default(1),
  view: z.enum(["gallery", "list"]).default("gallery"),
  build: z.coerce.number().int().positive().optional(),
})

export const prototypeQuerySchema = z
  .object({
    build: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(z.number().int())
      .optional(),
    view: z.enum(["gallery", "list", "minimized"]).optional(),
  })
  .strict()
