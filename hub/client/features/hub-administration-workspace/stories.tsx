import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { keepFormsLocal } from "@/storybook/keep-forms-local"

import { HubAdministrationWorkspace } from "."

const meta = {
  title: "Hub/Features/Hub Administration Workspace",
  component: HubAdministrationWorkspace,
  decorators: [keepFormsLocal],
  parameters: { layout: "fullscreen" },
  args: {
    data: hubAdministrationWorkspaceData,
    children: (
      <div style={{ padding: "1.5rem" }}>Deployment-wide content with repository navigation.</div>
    ),
  },
} satisfies Meta<typeof HubAdministrationWorkspace>

export default meta
type Story = StoryObj<typeof meta>

export const Expanded: Story = {}
export const Collapsed: Story = { args: { defaultNavigationCollapsed: true } }
export const NoRepositories: Story = {
  args: {
    data: {
      ...hubAdministrationWorkspaceData,
      repository: null,
      canvasConnectionsPath: "/canvas/connections",
      securityAuditPath: "/settings/audit?scope=hub",
    },
    children: (
      <div style={{ padding: "1.5rem" }}>Deployment-wide content without repositories.</div>
    ),
  },
}
