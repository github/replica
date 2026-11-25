import type { HubWorkspaceData } from "@features/hub-workspace/types"
import type { WorkspaceNavData } from "@features/workspace-nav/types"

import { authenticatedHeaderData } from "./authenticated-header"
import { githubEmpty, githubPrototype } from "./repositories"

const repositoryId = "00000000-0000-4000-8000-000000000101"
const repositoryPath = `/repositories/${repositoryId}`
const emptyRepositoryId = "00000000-0000-4000-8000-000000000102"

export const signedInRepository: NonNullable<WorkspaceNavData["repository"]> = {
  newPrototypeLabel: "Create",
  newPrototypePath: null,
  prototypesLabel: "Prototypes",
  prototypesPath: repositoryPath,
  repositories: [
    { ...githubPrototype, id: repositoryId, path: repositoryPath },
    { ...githubEmpty, id: emptyRepositoryId, path: `/repositories/${emptyRepositoryId}` },
  ],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: `Choose repository. ${githubPrototype.nameWithOwner} selected`,
  selectedRepositoryId: repositoryId,
}

export const signedInWorkspace: HubWorkspaceData = {
  ...authenticatedHeaderData,
  authenticityToken: "",
  signOutPath: "/api/auth/session/sign-out",
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  navigationLabel: "Repository navigation",
  settingsNavigationLabel: "Security and settings",
  repositoriesLabel: "Prototypes",
  repositoriesPath: "/repositories",
  repository: signedInRepository,
  canvasConnectionsPath: `/canvas/connections?repositoryId=${repositoryId}`,
}
