import { basename } from "node:path"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"
import {
  canvasAuthorityReference,
  findCanvasBrowserSession,
  readCanvasAuthority,
} from "../../../repositories/canvas/authority/index.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import {
  lockCanvasRepository,
  type CanvasRepository,
} from "../../../repositories/canvas/records/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { lockRestorableHubSession } from "../../../repositories/hub-sessions/lock-restorable-hub-session/index.ts"
import { lockActiveMembershipAssignments } from "../../../repositories/membership-assignments/lock-active-membership-assignments/index.ts"
import { lockMembershipById } from "../../../repositories/memberships/lock-membership-by-id/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"
import { localDeveloperIdentity } from "../../../utils/local-developer-identity/index.ts"

type CanvasViewer = NonNullable<Awaited<ReturnType<typeof readCanvasAuthority>>>
type Permission = "none" | "read" | "triage" | "write" | "maintain" | "admin"

export type GetCanvasRepositoryPermission = (
  viewer: Pick<CanvasViewer, "membershipId" | "externalIdentityId" | "sessionProvider" | "role">,
  repositoryId: string,
) => Promise<Permission>

export function createCanvasAuthorization(
  database: PrismaClient,
  getRepositoryPermission?: GetCanvasRepositoryPermission,
) {
  async function permission(
    viewer: CanvasViewer,
    repository: CanvasRepository,
  ): Promise<Permission> {
    if (repository.removedAt) return "none"
    if (viewer.sessionProvider === "local") {
      if (
        viewer.role !== "ADMINISTRATOR" ||
        viewer.issuer !== localDeveloperIdentity.issuer ||
        viewer.subject !== localDeveloperIdentity.subject ||
        !repository.localPath ||
        repository.githubRepositoryId !== null ||
        repository.nameWithOwner !== `local/${basename(repository.localPath)}`
      ) {
        return "none"
      }
      return getRepositoryPermission?.(viewer, repository.id) ?? "admin"
    }
    if (
      viewer.sessionProvider !== "github" ||
      viewer.githubAccessRevision === null ||
      repository.localPath ||
      !repository.githubRepositoryId
    ) {
      return "none"
    }
    return getRepositoryPermission?.(viewer, repository.id) ?? "none"
  }

  async function browser(digest: string) {
    const session = await findCanvasBrowserSession(database, digest)
    const reference = session && canvasAuthorityReference(session)
    const viewer = reference && (await readCanvasAuthority(database, reference))
    return session && viewer ? { digest, sessionId: session.id, viewer } : null
  }

  type Browser = NonNullable<Awaited<ReturnType<typeof browser>>>

  async function current(
    transaction: Prisma.TransactionClient,
    reference: CanvasViewer,
    browser?: Browser,
    checkRepository = false,
  ) {
    await lockAuthenticationProvidersForPrototypeEdit(transaction)
    await lockSessionRevocationState(transaction)
    if (checkRepository && reference.sessionProvider === "github") {
      const state = await lockGitHubRepositoryAccessState(transaction)
      if (state.revision !== reference.githubAccessRevision) return null
    }
    await lockMembershipById(transaction, reference.membershipId)
    await lockActiveMembershipAssignments(transaction, reference.membershipId)
    if (
      browser &&
      (await lockRestorableHubSession(transaction, browser.digest))?.id !== browser.sessionId
    ) {
      return null
    }
    const viewer = await readCanvasAuthority(transaction, reference)
    return viewer && (!browser || viewer.role === browser.viewer.role) ? viewer : null
  }

  async function withRepository<T>(
    reference: CanvasViewer,
    repository: CanvasRepository,
    operation: (transaction: Prisma.TransactionClient, viewer: CanvasViewer) => Promise<T>,
    browser?: Browser,
  ) {
    return database.$transaction(async (transaction) => {
      const viewer = await current(transaction, reference, browser, true)
      const persisted = viewer && (await lockCanvasRepository(transaction, repository.id))
      if (
        !viewer ||
        !persisted ||
        viewer.role !== reference.role ||
        persisted.nameWithOwner !== repository.nameWithOwner ||
        persisted.githubRepositoryId !== repository.githubRepositoryId ||
        persisted.localPath !== repository.localPath
      )
        return null
      return operation(transaction, viewer)
    })
  }

  return { browser, current, permission, withRepository }
}

export type CanvasAuthorization = ReturnType<typeof createCanvasAuthorization>
export type CanvasBrowser = NonNullable<Awaited<ReturnType<CanvasAuthorization["browser"]>>>
