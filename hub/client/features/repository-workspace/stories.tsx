import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { PrototypeIndexHeader } from "@features/prototype-index-header"

import { RepositoryWorkspace } from "."

const meta = {
  title: "Hub/Features/Repository Workspace",
  component: RepositoryWorkspace,
  args: {
    data: {
      ...authenticatedHeaderData,
      collapseNavigationLabel: "Collapse sidebar",
      expandNavigationLabel: "Expand sidebar",
      navigationLabel: "Repository navigation",
      newPrototypeLabel: "Create",
      newPrototypePath: "/repositories/2001/new",
      prototypesLabel: "Prototypes",
      prototypesPath: "/repositories/2001",
      repositories: [githubPrototype, githubEmpty],
      repositoryMenuLabel: "Repositories",
      repositorySelectorLabel: "Choose repository. github/prototype selected",
      selectedRepositoryId: "2001",
    },
    children: (
      <>
        <PrototypeIndexHeader
          clearSearchLabel="Clear search"
          heading="Prototypes"
          onSearchChange={() => undefined}
          searchLabel="Search prototypes"
          searchQuery=""
        />
        <div style={{ padding: "1.5rem" }}>Repository content</div>
      </>
    ),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RepositoryWorkspace>

export default meta
type Story = StoryObj<typeof meta>

export const Expanded: Story = {}

export const Collapsed: Story = {
  args: { defaultNavigationCollapsed: true },
}
