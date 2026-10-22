import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { welcomePrototype } from "@/storybook/fixtures/prototypes"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { RepositoriesShowPage } from "."
import type { RepositoriesShowPageData } from "./types"

const data: RepositoriesShowPageData = {
  ...authenticatedHeaderData,
  alert: null,
  collapseNavigationLabel: "Collapse sidebar",
  clearSearchLabel: "Clear search",
  emptyHeading: "No prototypes yet",
  emptyLabel: "No prototypes have been added to Hub yet.",
  buildPrototypeLabel: "Build prototype",
  expandNavigationLabel: "Expand sidebar",
  galleryViewLabel: "Gallery view",
  listViewLabel: "List view",
  managePrototypesLabel: "Manage prototypes",
  managePrototypesPath: "/repositories/2001/prototypes/manage",
  prototypeColumnLabel: "Prototype",
  ownerColumnLabel: "Owner",
  buildColumnLabel: "Build",
  passingLabel: "passing",
  notPassingLabel: "not passing",
  noBuildLabel: "No build yet",
  noSearchResultsHeading: "No prototypes found",
  noSearchResultsDescription:
    "Try a different search, or clear the current search to browse all prototypes.",
  navigationLabel: "Repository navigation",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  pageTitle: "github/prototype",
  prototypes: [],
  prototypesCountLabel: "0 prototypes",
  prototypeCountUnitOne: "prototype",
  prototypeCountUnitOther: "prototypes",
  prototypesHeading: "Prototypes",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [githubPrototype, githubEmpty],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
  searchLabel: "Search prototypes",
  viewLabel: "Prototype layout",
  workflowInstallation: {
    actionLabel: "Open installation pull request",
    createPath: "/repositories/2001/workflow_installation",
    description: "Open a pull request that adds the Replica workflow for prototype branches.",
    heading: "Prototype workflow file missing",
    state: "installable",
  },
}

const meta = {
  title: "Pages/Repositories/Show",
  component: RepositoriesShowPage,
  args: { data },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RepositoriesShowPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const ReadyToBuild: Story = {
  args: {
    data: {
      ...data,
      workflowInstallation: undefined,
    },
  },
}

export const WorkflowUpdateFailed: Story = {
  args: {
    data: {
      ...data,
      alert:
        "Hub cannot safely reuse the replica/install-workflow branch. Review that branch on GitHub and resolve the conflict before trying again.",
      workflowInstallation: {
        actionLabel: "Open workflow update pull request",
        createPath: "/repositories/2001/workflow_installation",
        description:
          "The Replica build Action has changed. Review a pull request that replaces the installed workflow with the latest version.",
        heading: "Build Action update available",
        state: "updatable",
      },
    },
  },
}

export const WorkflowAlreadyCurrent: Story = {
  args: {
    data: {
      ...data,
      notice: "The Replica build Action is already up to date. No pull request is needed.",
      workflowInstallation: undefined,
    },
  },
}

export const LocalRepository: Story = {
  args: {
    data: {
      ...data,
      emptyLabel:
        "Hub checks committed local branches every minute. Add a recent branch here, or find older branches under Manage prototypes.",
      managePrototypesLabel: "Manage prototypes",
      managePrototypesPath: "/repositories/1/prototypes/manage",
      newPrototypePath: null,
      pageTitle: "local/example",
      repositories: [
        { id: "1", nameWithOwner: "local/example", path: "/repositories/1" },
        { id: "2", nameWithOwner: "local/another", path: "/repositories/2" },
      ],
      repositorySelectorLabel: "Choose repository. local/example selected",
      selectedRepositoryId: "1",
      workflowInstallation: undefined,
    },
  },
}

export const Single: Story = {
  args: {
    data: {
      ...data,
      prototypes: [welcomePrototype],
      prototypesCountLabel: "1 prototype",
      workflowInstallation: undefined,
    },
  },
}

export const Multiple: Story = {
  args: {
    data: {
      ...data,
      prototypes: [
        welcomePrototype,
        {
          ...welcomePrototype,
          id: "2",
          branchName: "prototype/navigation",
          name: "Navigation",
          description: "Explore a different navigation layout.",
          path: "/repositories/2001/prototypes/2",
          latestBuild: { state: "running", stateLabel: "Running" },
          reviewBuild: undefined,
          previewFallbackLabel: "No successful Build yet",
        },
      ],
      prototypesCountLabel: "2 prototypes",
    },
  },
}

export const WideViewSwitching: Story = {
  ...Multiple,
  globals: { viewport: { value: "wideDesktop", isRotated: false } },
  parameters: {
    viewport: {
      options: {
        wideDesktop: {
          name: "Wide desktop",
          styles: { width: "1920px", height: "1080px" },
        },
      },
    },
  },
}

export const Searched: Story = {
  ...Multiple,
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("searchbox", { name: "Search prototypes" }), "Navigation")
  },
}

export const List: Story = {
  args: {
    data: {
      ...data,
      workflowInstallation: undefined,
      prototypes: [
        welcomePrototype,
        {
          ...welcomePrototype,
          id: "2",
          name: "Navigation",
          path: "/repositories/2001/prototypes/2",
          latestBuild: { state: "failed", stateLabel: "Failed" },
          reviewBuild: undefined,
          previewFallbackLabel: "No successful preview is available.",
        },
      ],
      prototypesCountLabel: "2 prototypes",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("radio", { name: "List view" }))
  },
}

export const WriterWithUnlistedBranches: Story = {
  args: {
    data: {
      ...data,
      prototypes: [welcomePrototype],
      prototypesCountLabel: "1 prototype",
      workflowInstallation: undefined,
      managePrototypesLabel: "Manage prototypes",
      managePrototypesPath: "/repositories/2001/prototypes/manage",
      addToHubLabel: "Add to Hub",
      declineBranchLabel: "Hide message",
      recentBranches: [
        {
          id: "2",
          branchName: "prototype/navigation",
          title: "You pushed prototype/navigation. Add it to Hub?",
          registrationPath: "/repositories/2001/prototypes/2/registration",
          dismissalPath: "/repositories/2001/prototypes/2/branch_banner_dismissal",
        },
      ],
    },
  },
}

export const MultipleRecentBranches: Story = {
  args: {
    data: {
      ...WriterWithUnlistedBranches.args!.data!,
      recentBranches: [
        ...WriterWithUnlistedBranches.args!.data!.recentBranches!,
        {
          id: "3",
          branchName: "prototype/welcome/accessibility-and-keyboard-navigation",
          title:
            "You pushed prototype/welcome/accessibility-and-keyboard-navigation. Add it to Hub?",
          registrationPath: "/repositories/2001/prototypes/3/registration",
          dismissalPath: "/repositories/2001/prototypes/3/branch_banner_dismissal",
        },
      ],
    },
  },
}

export const LocalWriterWithUnlistedBranches: Story = {
  args: {
    data: {
      ...data,
      managePrototypesLabel: "Manage prototypes",
      managePrototypesPath: "/repositories/1/prototypes/manage",
      addToHubLabel: "Add to Hub",
      declineBranchLabel: "Hide message",
      recentBranches: [
        {
          id: "2",
          branchName: "prototype/field-notes",
          title: "Hub detected prototype/field-notes locally. Add it to Hub?",
          registrationPath: "/repositories/1/prototypes/2/registration",
          dismissalPath: "/repositories/1/prototypes/2/branch_banner_dismissal",
        },
        {
          id: "3",
          branchName: "prototype/signal-room",
          title: "Hub detected prototype/signal-room locally. Add it to Hub?",
          registrationPath: "/repositories/1/prototypes/3/registration",
          dismissalPath: "/repositories/1/prototypes/3/branch_banner_dismissal",
        },
      ],
      newPrototypePath: null,
      pageTitle: "local/example",
      prototypes: [
        {
          ...welcomePrototype,
          author: {
            avatarUrl: "/local-developer-avatar.svg",
            label: "by @local",
            ownerLabel: "@local",
            url: null,
          },
          path: "/repositories/1/prototypes/1",
        },
      ],
      prototypesCountLabel: "1 prototype",
      prototypesPath: "/repositories/1",
      repositories: [{ id: "1", nameWithOwner: "local/example", path: "/repositories/1" }],
      repositorySelectorLabel: "Choose repository. local/example selected",
      selectedRepositoryId: "1",
      workflowInstallation: undefined,
    },
  },
}

export const FreshLocalExample: Story = {
  args: {
    data: {
      ...LocalRepository.args!.data!,
      addToHubLabel: "Add to Hub",
      declineBranchLabel: "Hide message",
      recentBranches: [
        ...LocalWriterWithUnlistedBranches.args!.data!.recentBranches!,
        {
          id: "1",
          branchName: "prototype/welcome",
          title: "Hub detected prototype/welcome locally. Add it to Hub?",
          registrationPath: "/repositories/1/prototypes/1/registration",
          dismissalPath: "/repositories/1/prototypes/1/branch_banner_dismissal",
        },
      ],
      prototypesPath: "/repositories/1",
    },
  },
}
