import type { RepositoryRecord, WorkspaceResponse } from "@application/hub/contracts/types"
import { http } from "@/test/stub-hub-fetch"

export function authenticatedWorkspace(
  repositories: RepositoryRecord[],
  {
    administerHub = false,
    provider = "github",
    reviewInboxAvailable = false,
    publicSharingSettingsAvailable = false,
  }: {
    administerHub?: boolean
    provider?: "github" | "local"
    reviewInboxAvailable?: boolean
    publicSharingSettingsAvailable?: boolean
  } = {},
) {
  const viewer = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    login: "octocat",
    name: "The Octocat",
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
    http.get("/api/workspace", () => Response.json(workspace)),
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
