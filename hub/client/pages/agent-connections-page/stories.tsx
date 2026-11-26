import type { Meta, StoryObj } from "@storybook/react-vite"

import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { AgentConnectionsPrototype } from "."
import type { AgentConnectionsPrototypeData } from "./types"

const workspace: RepositoryWorkspaceData = {
  ...authenticatedHeaderData,
  analyticsLabel: "Analytics",
  analyticsPath: "/repositories/2001/analytics",
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  learningsLabel: "Learnings",
  learningsPath: "/repositories/2001/learnings",
  navigationLabel: "Repository navigation",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [githubPrototype, githubEmpty],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
  selectedSection: "learnings",
  welcomeLabel: "Welcome",
  welcomePath: "/welcome",
}

const connections: AgentConnectionsPrototypeData = {
  repositoryId: "2001",
  repositoryName: "github/prototype",
  hubUrl: "https://hub.example.com",
  signedInAs: "@octocat",
  view: "connections",
  connections: [
    {
      id: "agent-vscode",
      name: "Visual Studio Code",
      connectedAt: "2026-11-18",
      lastUsedAt: "2026-11-24",
    },
    {
      id: "agent-local",
      name: "Local MCP client",
      connectedAt: "2026-11-12",
      lastUsedAt: "2026-11-21",
    },
  ],
}

const approval: AgentConnectionsPrototypeData = {
  ...connections,
  view: "approval",
  requestingAgent: "Visual Studio Code",
}

const meta = {
  title: "Hub/Pages/Learnings/Agent connections",
  component: AgentConnectionsPrototype,
  parameters: { layout: "fullscreen" },
  args: { data: connections },
  render: ({ data }) =>
    data.view === "connections" ? (
      <RepositoryWorkspace data={workspace}>
        <AgentConnectionsPrototype data={data} />
      </RepositoryWorkspace>
    ) : (
      <AgentConnectionsPrototype data={data} />
    ),
} satisfies Meta<typeof AgentConnectionsPrototype>

export default meta
type Story = StoryObj<typeof meta>

export const ConnectedAgents: Story = {}
export const NoConnectedAgents: Story = {
  args: { data: { ...connections, connections: [] } },
}
export const RevokeConfirmation: Story = {
  args: { data: connections },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Revoke Visual Studio Code access" }))
    await canvas.findByRole("dialog", { name: "Revoke agent access?" })
  },
}
export const ApprovalRequest: Story = {
  args: { data: approval },
}
export const Approved: Story = {
  args: { data: approval },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Approve access" }))
    await canvas.findByRole("heading", { name: "Agent connected" })
  },
}
export const Cancelled: Story = {
  args: { data: approval },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }))
    await canvas.findByRole("heading", { name: "Connection cancelled" })
  },
}
