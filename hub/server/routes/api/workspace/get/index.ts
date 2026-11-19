import type { RequestHandler } from "express"
import { z } from "zod"

import { authorizeRepositoryReview } from "../../../../domains/review-comments/authorize-repository-review/index.ts"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name/index.ts"
import { readCookie } from "../../../../integrations/express/read-cookie/index.ts"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors.ts"
import { canWriteRepository } from "../../../../utils/can-write-repository/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import { readProductSession } from "../../product/read-product-session/index.ts"
import { readProductWithCurrentAuthority } from "../../product/read-product-with-current-authority/index.ts"
import { canBrowseTemplates } from "../../product/template-repository-access/index.ts"
import type { WorkspaceProductRouteDependencies } from "../../product/types.ts"

export function get(
  session: CurrentSessionDependencies,
  product: WorkspaceProductRouteDependencies,
  manageSharing = false,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookie = readCookie(request, hubSessionCookieName)
      const initial = await readProductSession(cookie, session)
      if (!initial) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const selectedRepository = z.uuid().safeParse(request.query.repositoryId)
      const read = await readProductWithCurrentAuthority(
        initial,
        cookie,
        session,
        async (viewer) => {
          const [repositories, welcomeHidden] = await Promise.all([
            product.listRepositories(viewer),
            product.welcome?.isHidden(viewer.userId),
          ])
          const selected = selectedRepository.success
            ? repositories.find(({ id }) => id === selectedRepository.data)
            : undefined
          let permission = "none"
          let permissionUnavailable = false
          if (selected) {
            try {
              permission = (await product.getRepositoryPermission?.(viewer, selected.id)) ?? "none"
            } catch (error) {
              if (!(error instanceof GitHubProviderRequestError)) throw error
              // Permission uncertainty must not hide an otherwise readable gallery.
              permissionUnavailable = true
            }
          }
          return { repositories, selected, permission, permissionUnavailable, welcomeHidden }
        },
      )
      if (!read) {
        response.status(401).json({ error: "Sign in to continue." })
        return
      }
      const {
        current,
        result: { repositories, selected, permission, permissionUnavailable, welcomeHidden },
      } = read
      const presentedRepositories = repositories.map(({ localPath, ...repository }) => ({
        ...repository,
        capabilities: {
          reviewPrototypes: authorizeRepositoryReview(current, { localPath }).canView,
          manageSharing: current.provider === "local" && Boolean(localPath) && manageSharing,
          ...(product.templates && canBrowseTemplates(current, Boolean(localPath))
            ? { browseTemplates: true, local: Boolean(localPath) }
            : {}),
          ...((product.findPrototypeManagement || product.findLocalPrototypeManagement) &&
          ((repository.id === selected?.id && canWriteRepository(permission)) ||
            (current.sessionProvider === "local" && current.role === "ADMINISTRATOR" && localPath))
            ? { managePrototypeListings: true }
            : {}),
          ...(product.analytics &&
          ((repository.id === selected?.id && permission === "admin") ||
            (product.analytics.localAdministration &&
              current.sessionProvider === "local" &&
              current.role === "ADMINISTRATOR" &&
              localPath))
            ? { manageAnalytics: true }
            : {}),
          ...(repository.id === selected?.id
            ? {
                administerRepository: permission === "admin",
                ...(permissionUnavailable ? { repositoryPermissionUnavailable: true } : {}),
              }
            : current.sessionProvider === "local" && current.role === "ADMINISTRATOR" && localPath
              ? { administerRepository: true }
              : {}),
        },
      }))
      response.json({
        viewer: {
          id: current.userId,
          login: current.login,
          name: current.name,
          provider: current.provider,
          avatarUrl: null,
        },
        repositories: presentedRepositories,
        ...(welcomeHidden !== undefined ? { welcomeHidden } : {}),
        capabilities: {
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
          administerHub: current.role === "ADMINISTRATOR",
        },
      })
    } catch (error) {
      next(error)
    }
  }
}
