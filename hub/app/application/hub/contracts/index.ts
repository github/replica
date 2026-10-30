import { z } from "zod"

const identifier = z.number().int().positive()
const httpUrl = z.url({ protocol: /^https?$/ })
const timestamp = z.iso.datetime({ offset: true })

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
})

export const repositorySchema = z.object({
  id: identifier,
  nameWithOwner: z.string().min(1),
  defaultBranch: z.string().min(1),
})

export const buildSchema = z.object({
  number: identifier,
  repositoryId: identifier,
  prototypeId: identifier,
  state: z.enum(["failed", "queued", "running", "successful", "superseded"]),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  commitAuthorLogin: z.string().min(1),
  createdAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  previewUrl: httpUrl.nullable(),
  desktopScreenshotUrl: httpUrl.nullable(),
  narrowScreenshotUrl: httpUrl.nullable(),
  failureSummary: z.string().nullable(),
})

export const prototypeSchema = z.object({
  id: identifier,
  repositoryId: identifier,
  name: z.string().min(1),
  branchName: z.string().min(1),
  description: z.string().nullable(),
  authorLogin: z.string().min(1),
  canEdit: z.boolean(),
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
  prototypes: z.array(prototypeSchema),
  pagination: paginationSchema,
  authors: z.array(userSchema),
})

export const prototypeResponseSchema = z.object({
  repository: repositorySchema,
  prototype: prototypeSchema,
  selectedBuild: buildSchema.nullable(),
})

export const buildResponseSchema = z.object({
  repository: repositorySchema,
  prototype: prototypeSchema,
  build: buildSchema,
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

export const apiErrorSchema = z.object({ error: z.string().min(1) })

export const mockScenarios = [
  "normal",
  "loading",
  "empty",
  "forbidden",
  "server-error",
  "invalid-response",
  "save-error",
] as const

export const mockScenarioSchema = z.enum(mockScenarios)

export const routeQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  author: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().positive().default(1),
  view: z.enum(["gallery", "list"]).default("gallery"),
  build: z.coerce.number().int().positive().optional(),
  mockScenario: mockScenarioSchema.default("normal"),
})

export type UserRecord = z.infer<typeof userSchema>
export type RepositoryRecord = z.infer<typeof repositorySchema>
export type BuildRecord = z.infer<typeof buildSchema>
export type PrototypeRecord = z.infer<typeof prototypeSchema>
export type Pagination = z.infer<typeof paginationSchema>
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>
export type RepositoryResponse = z.infer<typeof repositoryResponseSchema>
export type PrototypeResponse = z.infer<typeof prototypeResponseSchema>
export type BuildResponse = z.infer<typeof buildResponseSchema>
export type BuildHistoryResponse = z.infer<typeof buildHistoryResponseSchema>
export type AuthorResults = z.infer<typeof authorResultsSchema>
export type PrototypeDetails = z.infer<typeof prototypeDetailsSchema>
export type RouteQuery = z.infer<typeof routeQuerySchema>
export type MockScenario = (typeof mockScenarios)[number]

export type PrototypeActionResult = { saved: true } | { saved: false; error: string }
