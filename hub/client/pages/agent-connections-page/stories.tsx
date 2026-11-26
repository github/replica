import type { Meta, StoryObj } from "@storybook/react-vite"

import { RepositoryWorkspace } from "@features/repository-workspace"
import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"

import { AgentConnectionsPage } from "."
import type { AgentConnectionsPageData } from "./types"

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

const connections: AgentConnectionsPageData = {
  view: "connections",
  repositoryName: "github/prototype",
  mcpUrl: "https://hub.example.com/mcp/repositories/2001",
  signedInAs: "octocat",
  notice: null,
  connections: [
    {
      id: "agent-vscode",
      name: "Visual Studio Code",
      connectedLabel: "Connected 11/18/2026",
      lastUsedLabel: "Last used 11/24/2026",
      revokePath: "/repositories/2001/learnings/agents/agent-vscode",
    },
    {
      id: "agent-local",
      name: "Local MCP client",
      connectedLabel: "Connected 11/12/2026",
      lastUsedLabel: "Not used yet",
      revokePath: "/repositories/2001/learnings/agents/agent-local",
    },
  ],
}

const approval: AgentConnectionsPageData = {
  view: "approval",
  requestingAgent: "Visual Studio Code",
  destination: "127.0.0.1:33418",
  localDestination: true,
  session: "session-octocat",
  signedInAs: "octocat",
  expiresLabel: "This request expires at 3:15:00 PM.",
  decisionPath: "/agents/approve/7c9e6679-7425-40de-944b-e07fc1f90ae7",
}

const meta = {
  title: "Hub/Pages/Learnings/Agent connections",
  component: AgentConnectionsPage,
  parameters: { layout: "fullscreen" },
  args: { data: connections },
  // The page's forms post to Hub, so stories keep them from leaving Storybook.
  render: ({ data }) => (
    <div onSubmit={(event) => event.preventDefault()}>
      {data.view === "connections" ? (
        <RepositoryWorkspace data={workspace}>
          <AgentConnectionsPage data={data} />
        </RepositoryWorkspace>
      ) : (
        <AgentConnectionsPage data={data} />
      )}
    </div>
  ),
} satisfies Meta<typeof AgentConnectionsPage>

export default meta
type Story = StoryObj<typeof meta>

export const ConnectedAgents: Story = {}
export const NoConnectedAgents: Story = {
  args: { data: { ...connections, connections: [] } },
}
export const RevokeConfirmation: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Revoke Visual Studio Code access" }))
    await canvas.findByRole("dialog", { name: "Revoke agent access?" })
  },
}
export const Revoked: Story = {
  args: {
    data: {
      ...connections,
      connections: connections.connections.slice(1),
      notice: "Agent access revoked.",
    },
  },
}
export const ApprovalRequest: Story = {
  args: { data: approval },
}
export const RemoteApprovalRequest: Story = {
  args: { data: { ...approval, destination: "agent.example.net", localDestination: false } },
}
