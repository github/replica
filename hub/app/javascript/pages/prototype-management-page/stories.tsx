import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { PrototypeManagementPage } from "."
import type { PrototypeManagementPageData } from "./types"

const data: PrototypeManagementPageData = {
  ...authenticatedHeaderData,
  alert: null,
  backLabel: "Back to prototypes",
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  navigationLabel: "Repository navigation",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  pageTitle: "Prototypes",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [githubPrototype, githubEmpty],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
  sectionLoadId: "management-story",
  repositoryChoices: {
    repositories: [githubPrototype, githubEmpty],
    path: "/repositories/2001/prototypes/manage?props_at=data.repositoryChoices",
    loadingLabel: "Loading repositories...",
    errorLabel: "Hub could not load all repository choices.",
    retryLabel: "Retry repository choices",
    failed: false,
  },
  management: {
    heading: "Manage prototypes",
    unlistedHeading: "Available branches",
    unlistedDescription:
      "Add a branch to Hub to make your prototype available for others to explore.",
    registeredHeading: "Prototypes in Hub",
    registeredEmptyLabel:
      "No prototypes in Hub yet. Once you add a branch, it will appear here so you can manage its details.",
    emptyLabel:
      "No branches available to add. When you create a new branch, it will appear here so you can add it to Hub.",
    candidateCheckFailed: false,
    candidateCheckFailedLabel: "Hub could not check which branches you can add.",
    candidateLoadingLabel: "Checking branches you can add...",
    candidateRetryLabel: "Retry branch check",
    candidateDataPath: "/repositories/2001/prototypes/manage?props_at=data.management",
    candidatePage: 1,
    candidatePageCount: 1,
    candidatePagePath: "/repositories/2001/prototypes/manage",
    paginationLabel: "Available branches pages",
    previousPageLabel: "Previous",
    previousPageAriaLabel: "Previous page",
    nextPageLabel: "Next",
    nextPageAriaLabel: "Next page",
    nameLabel: "Name",
    descriptionLabel: "Description (optional)",
    startPageLabel: "Start page (optional)",
    startPageHint:
      "Paste a preview URL or route, including any query or fragment. Leave blank to start at /.",
    addLabel: "Add to Hub",
    editLabel: "Edit details",
    saveLabel: "Save details",
    cancelLabel: "Cancel",
    addDialogHeading: "Add branch to Hub",
    editDialogHeading: "Edit prototype details",
    closeDialogLabel: "Close dialog",
    nameMaximumLength: 255,
    descriptionMaximumLength: 500,
    unlisted: [
      {
        id: "2",
        branchName: "prototype/new",
        name: "prototype/new",
        description: null,
        startPage: null,
        path: "/repositories/2001/prototypes/2/registration",
      },
      {
        id: "3",
        branchName: "prototype/navigation",
        name: "prototype/navigation",
        description: null,
        startPage: null,
        path: "/repositories/2001/prototypes/3/registration",
      },
    ],
    registered: [
      {
        id: "1",
        branchName: "prototype/welcome",
        name: "Welcome",
        description: "Explore the new welcome flow.",
        startPage: "/welcome?step=1#intro",
        path: "/repositories/2001/prototypes/1/registration",
      },
      {
        id: "4",
        branchName: "prototype/settings",
        name: "Settings",
        description: null,
        startPage: null,
        path: "/repositories/2001/prototypes/4/registration",
      },
    ],
  },
}

const meta = {
  title: "Pages/Prototypes/Manage",
  component: PrototypeManagementPage,
  args: { data },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PrototypeManagementPage>

export default meta
type Story = StoryObj<typeof meta>

export const Multiple: Story = {}

export const Loading: Story = {
  args: {
    candidates: { loading: true, failed: false, retry: () => {} },
    repositoryChoices: { loading: true, failed: false, retry: () => {} },
    data: {
      ...data,
      repositoryChoices: { ...data.repositoryChoices, repositories: [githubPrototype] },
      management: { ...data.management, unlisted: [], candidatePageCount: 0 },
    },
  },
}

export const Retry: Story = {
  args: {
    candidates: { loading: false, failed: true, retry: () => {} },
    repositoryChoices: { loading: false, failed: true, retry: () => {} },
  },
}

export const EditStartPage: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Edit details: prototype/welcome" }))
  },
}

export const Empty: Story = {
  args: {
    data: {
      ...data,
      management: { ...data.management, candidatePageCount: 0, unlisted: [], registered: [] },
    },
  },
}

export const Single: Story = {
  args: {
    data: {
      ...data,
      management: {
        ...data.management,
        unlisted: data.management.unlisted.slice(0, 1),
        registered: [],
      },
    },
  },
}

export const BranchCheckUnavailable: Story = {
  args: {
    data: {
      ...data,
      management: {
        ...data.management,
        candidateCheckFailed: true,
        candidatePageCount: 0,
        unlisted: [],
      },
    },
  },
}

export const FirstPage: Story = {
  args: {
    data: {
      ...data,
      management: {
        ...data.management,
        candidatePageCount: 2,
        unlisted: Array.from({ length: 10 }, (_, index) => ({
          id: String(index + 5),
          branchName: `prototype/branch-${String(index + 1).padStart(2, "0")}`,
          name: `prototype/branch-${String(index + 1).padStart(2, "0")}`,
          description: null,
          startPage: null,
          path: `/repositories/2001/prototypes/${index + 5}/registration`,
        })),
      },
    },
  },
}

export const LastPage: Story = {
  args: {
    data: {
      ...data,
      management: {
        ...data.management,
        candidatePage: 2,
        candidatePageCount: 2,
        unlisted: [
          {
            id: "15",
            branchName: "prototype/branch-11",
            name: "prototype/branch-11",
            description: null,
            startPage: null,
            path: "/repositories/2001/prototypes/15/registration",
          },
        ],
      },
    },
  },
}

export const Local: Story = {
  args: {
    data: {
      ...data,
      newPrototypePath: null,
      prototypesPath: "/repositories/1",
      repositories: [{ id: "1", nameWithOwner: "local/example", path: "/repositories/1" }],
      repositorySelectorLabel: "Choose repository. local/example selected",
      selectedRepositoryId: "1",
      repositoryChoices: {
        ...data.repositoryChoices,
        repositories: [{ id: "1", nameWithOwner: "local/example", path: "/repositories/1" }],
      },
      management: {
        ...data.management,
        candidatePagePath: "/repositories/1/prototypes/manage",
        unlisted: data.management.unlisted.map((entry) => ({
          ...entry,
          path: `/repositories/1/prototypes/${entry.id}/registration`,
        })),
        registered: data.management.registered.map((entry) => ({
          ...entry,
          path: `/repositories/1/prototypes/${entry.id}/registration`,
        })),
      },
    },
  },
}
