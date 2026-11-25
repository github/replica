import type { RepositoryRecord, WorkspaceResponse } from "@application/hub/contracts/types"
import { http } from "@/test/stub-hub-fetch"

export const workspaceViewerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

export function authenticatedWorkspace(
  repositories: RepositoryRecord[],
  {
    administerHub = false,
    provider = "github",
    reviewInboxAvailable = false,
    publicSharingSettingsAvailable = false,
    scopeRepositoryPermissions = false,
  }: {
    administerHub?: boolean
    provider?: "github" | "local"
    reviewInboxAvailable?: boolean
    publicSharingSettingsAvailable?: boolean
    scopeRepositoryPermissions?: boolean
  } = {},
) {
  const viewer = {
    id: workspaceViewerId,
    login: provider === "local" ? "local-developer" : "octocat",
    name: provider === "local" ? "Local developer" : "The Octocat",
    avatarUrl: null,
    provider,
  }
  const workspace: WorkspaceResponse = {
    viewer,
    repositories,
    repositoryPermissionsAvailable: true,
    reviewInboxAvailable,
    publicSharingSettingsAvailable,
    capabilities: {
      createPrototypes: false,
      reviewPrototypes: false,
      manageSharing: false,
      administerHub,
    },
  }
  return [
    http.get("/api/workspace", ({ request }) => {
      if (!scopeRepositoryPermissions) return Response.json(workspace)

      const { searchParams } = new URL(request.url)
      const navigationOnly = searchParams.get("view") === "navigation"
      const selected = navigationOnly
        ? undefined
        : (repositories.find(({ id }) => id === searchParams.get("repositoryId")) ??
          repositories[0])

      return Response.json({
        ...workspace,
        repositoryPermissionsAvailable: navigationOnly && provider === "github" ? true : undefined,
        repositories: repositories.map((repository) => {
          if (repository === selected || provider === "local" || !repository.capabilities) {
            return repository
          }
          const { reviewPrototypes, manageSharing, browseTemplates, local } =
            repository.capabilities
          return {
            ...repository,
            capabilities: { reviewPrototypes, manageSharing, browseTemplates, local },
          }
        }),
      })
    }),
    http.get("/api/auth/session", () =>
      Response.json({
        authenticated: true,
        membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        userId: viewer.id,
        login: viewer.login,
        name: viewer.name,
        provider,
        role: administerHub ? "ADMINISTRATOR" : "MEMBER",
        reviewInboxAvailable,
      }),
    ),
  ]
}
