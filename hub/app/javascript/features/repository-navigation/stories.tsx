import { useState } from "react"

import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { RepositoryNavigation } from "."

const meta = {
  title: "Features/Repository Navigation",
  component: RepositoryNavigation,
  args: {
    collapsed: false,
    data: {
      ...authenticatedHeaderData,
      collapseNavigationLabel: "Collapse sidebar",
      expandNavigationLabel: "Expand sidebar",
      navigationLabel: "Repository navigation",
      welcomeLabel: "Welcome",
      welcomePath: "/welcome",
      newPrototypeLabel: "Create",
      newPrototypePath: "/repositories/2001/new",
      prototypesLabel: "Prototypes",
      prototypesPath: "/repositories/2001",
      repositories: [githubPrototype, githubEmpty],
      repositoryMenuLabel: "Repositories",
      repositorySelectorLabel: "Choose repository. github/prototype selected",
      selectedRepositoryId: "2001",
    },
    onCollapsedChange: () => undefined,
  },
  render: function RepositoryNavigationStory(args) {
    const [collapsed, setCollapsed] = useState(args.collapsed)

    return <RepositoryNavigation {...args} collapsed={collapsed} onCollapsedChange={setCollapsed} />
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RepositoryNavigation>

export default meta
type Story = StoryObj<typeof meta>

export const PrototypesSelected: Story = {}

export const WelcomeSelected: Story = {
  args: { data: { ...meta.args.data, selectedSection: "welcome" } },
}

export const WelcomeHidden: Story = {
  args: { data: { ...meta.args.data, welcomePath: null } },
}

export const Collapsed: Story = {
  args: { collapsed: true },
}

export const RepositoryMenuOpen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: meta.args.data.repositorySelectorLabel }),
    )
  },
}

export const RepositoryMenuOpenCollapsed: Story = {
  ...RepositoryMenuOpen,
  args: { collapsed: true },
}

export const CreateSelected: Story = {
  args: { data: { ...meta.args.data, selectedSection: "new" } },
}

export const CreateSelectedCollapsed: Story = {
  args: { ...CreateSelected.args, collapsed: true },
}

export const HubAdministrator: Story = {
  args: {
    data: {
      ...meta.args.data,
      securityAuditLabel: "Security audit",
      securityAuditPath: "/repositories/2001/security_audit",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: authenticatedHeaderData.accountMenuLabel }),
    )
  },
}

export const HubAdministratorCollapsed: Story = {
  ...HubAdministrator,
  args: { ...HubAdministrator.args, collapsed: true },
}

export const OrdinaryAccountMenu: Story = {
  play: HubAdministrator.play,
}
