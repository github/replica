import type { Meta, StoryObj } from "@storybook/react-vite"

import type { HubWorkspaceData } from "@features/hub-workspace/types"
import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { keepFormsLocal } from "@/storybook/keep-forms-local"

import { RepositoriesIndexPage } from "."

const data: HubWorkspaceData = {
  ...authenticatedHubWorkspaceData,
  repository: null,
  canvasConnectionsPath: "/canvas/connections",
  welcomeLabel: "Welcome",
  welcomePath: "/welcome",
  notificationsLabel: "Inbox",
  notificationsPath: "/notifications",
  securityAuditPath: null,
}

const realEmptyWorkspaceData: HubWorkspaceData = {
  ...data,
  currentUser: {
    ...data.currentUser,
    provider: "local",
    login: "local-developer",
    name: "Local developer",
    avatarUrl: null,
  },
  accountMenuLabel: "Account menu for Local developer",
  selectedSection: "prototypes",
  administrationLinks: [
    { section: "admins", label: "Hub administrators", path: "/settings/administrators" },
    { section: "sharing", label: "Public sharing", path: "/settings/sharing" },
    { section: "sessions", label: "End all Hub sessions", path: "/settings/sessions" },
    { section: "copilot", label: "Copilot connection", path: "/settings/copilot" },
  ],
  securityAuditPath: "/settings/audit?scope=hub",
}

const meta = {
  title: "Hub/Pages/Repositories",
  component: RepositoriesIndexPage,
  decorators: [keepFormsLocal],
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof RepositoriesIndexPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const RealEmptyWorkspace: Story = {
  args: { data: realEmptyWorkspaceData },
}

export const Administrator: Story = {
  args: {
    data: {
      ...data,
      administrationLinks: realEmptyWorkspaceData.administrationLinks,
      securityAuditPath: realEmptyWorkspaceData.securityAuditPath,
    },
  },
}
