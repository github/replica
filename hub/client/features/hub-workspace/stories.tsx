import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubEmptyState } from "@components/hub-empty-state"
import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { mona } from "@/storybook/fixtures/users"

import { HubWorkspace } from "."

const meta = {
  title: "Hub/Features/Hub Workspace",
  component: HubWorkspace,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HubWorkspace>

export default meta
type Story = StoryObj<typeof meta>

export const RepositoryPermissionsUnavailable: Story = {
  args: {
    data: {
      ...authenticatedHubWorkspaceData,
      currentUser: mona,
      accountMenuLabel: "Account menu for @mona",
      canvasConnectionsPath: "/canvas/connections",
      navigationLabel: "Repository navigation",
      repository: authenticatedHubWorkspaceData.repository
        ? { ...authenticatedHubWorkspaceData.repository, analyticsPath: null }
        : null,
      securityAuditPath: null,
      selectedSection: "prototypes",
    },
    onRetryPermissions: () => undefined,
    children: (
      <HubEmptyState
        heading="No prototypes available"
        description="Prototypes will appear here when they are added to this repository."
      />
    ),
  },
}
