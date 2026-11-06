import type { z } from "zod"

import type {
  authorResultsSchema,
  buildHistoryResponseSchema,
  buildResponseSchema,
  buildSchema,
  paginationSchema,
  prototypeDetailsSchema,
  prototypeQuerySchema,
  prototypeResponseSchema,
  prototypeSchema,
  repositoryResponseSchema,
  repositorySchema,
  routeQuerySchema,
  userSchema,
  workspaceResponseSchema,
} from "."

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
export type PrototypeQuery = z.infer<typeof prototypeQuerySchema>
export type PrototypeActionResult = { saved: true } | { saved: false; error: string }
