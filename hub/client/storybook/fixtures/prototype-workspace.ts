import type { PrototypeWorkspaceData } from "@features/prototype-workspace"

import { authenticatedHeaderData } from "./authenticated-header"
import { githubEmpty, githubPrototype } from "./repositories"
import { octocat } from "./users"

export const prototypeWorkspaceData = {
  ...authenticatedHeaderData,
  author: {
    avatarUrl: octocat.avatarUrl,
    label: "By @octocat",
    url: "https://github.com/octocat",
  },
  branchName: "prototype/welcome",
  branchPath: "/repositories/2001/prototypes/1",
  buildOptions: [
    {
      number: 1,
      label: "v1",
      path: "/repositories/2001/prototypes/1?build=1",
      state: "successful",
    },
  ],
  buildSelectionLabel: "Choose build",
  closeLabel: "Close",
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  historyLabel: "History",
  historyPath: "/repositories/2001/prototypes/1/builds",
  moreActionsLabel: "More actions",
  navigationLabel: "Repository navigation",
  settingsNavigationLabel: "Security and settings",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [githubPrototype, githubEmpty],
  repositoryPath: "/repositories/2001",
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedBuild: {
    detailsLabel: "Build details",
    detailsPath: "/repositories/2001/prototypes/1/builds/1",
    number: 1,
  },
  selectedRepositoryId: "2001",
  securityAuditLabel: "Security audit",
  securityAuditPath: "/repositories/2001/security_audit",
  useDarkThemeLabel: "Use dark theme",
  useLightThemeLabel: "Use light theme",
} satisfies PrototypeWorkspaceData
