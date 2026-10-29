import type { AccessDecision, AccessInput, PrototypeRole } from "../evaluate-access/types.ts"
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface PrototypeAuthorizationService {
  listWorkspaces(sessionToken: string, query: unknown): Promise<Page<unknown>>
  createWorkspace(sessionToken: string, input: unknown): Promise<unknown>
  getWorkspace(sessionToken: string, workspaceId: string): Promise<unknown>
  setWorkspaceAccess(
    sessionToken: string,
    workspaceId: string,
    targetUserId: string,
    input: unknown,
  ): Promise<unknown>
  removeWorkspaceAccess(
    sessionToken: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<void>
  listPrototypes(sessionToken: string, workspaceId: string, query: unknown): Promise<Page<unknown>>
  createPrototype(sessionToken: string, workspaceId: string, input: unknown): Promise<unknown>
  getPrototype(sessionToken: string, prototypeId: string): Promise<unknown>
  archivePrototype(sessionToken: string, prototypeId: string): Promise<unknown>
  setPrototypeAuthorization(
    sessionToken: string,
    prototypeId: string,
    input: unknown,
  ): Promise<unknown>
  explainPrototypeAccess(sessionToken: string, prototypeId: string): Promise<AccessDecision>
  setPrototypeAccess(
    sessionToken: string,
    prototypeId: string,
    targetUserId: string,
    input: unknown,
  ): Promise<unknown>
  removePrototypeAccess(
    sessionToken: string,
    prototypeId: string,
    targetUserId: string,
  ): Promise<void>
  listVersions(sessionToken: string, prototypeId: string, query: unknown): Promise<Page<unknown>>
  createVersion(sessionToken: string, prototypeId: string, input: unknown): Promise<unknown>
  getVersion(sessionToken: string, prototypeId: string, versionId: string): Promise<unknown>
}

export interface GrantInput {
  effect: "allow" | "deny"
  role: PrototypeRole | null
}

export interface PrototypeBaselinePolicy {
  baseline(
    database: Prisma.TransactionClient | PrismaClient,
    userId: string,
    prototypeId: string,
  ): Promise<AccessInput["baseline"]>
  workspaceIds?(
    database: Prisma.TransactionClient | PrismaClient,
    userId: string,
  ): Promise<string[]>
  prototypeIds?(
    database: Prisma.TransactionClient | PrismaClient,
    userId: string,
    workspaceId: string,
  ): Promise<string[]>
}
