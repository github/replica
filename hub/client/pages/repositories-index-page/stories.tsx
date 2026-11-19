import type { Meta, StoryObj } from "@storybook/react-vite"

import type { HubWorkspaceData } from "@features/hub-workspace/types"
import { authenticatedHubWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { RepositoriesIndexPage } from "."

const data: HubWorkspaceData = {
  ...authenticatedHubWorkspaceData,
  repository: null,
  welcomeLabel: "Welcome",
  welcomePath: "/welcome",
  notificationsLabel: "Notifications",
  notificationsPath: "/notifications",
  securityAuditPath: null,
}

const realEmptyWorkspaceData: HubWorkspaceData = {
  ...data,
  authenticityToken: "",
  canvasConnectionsPath: "/canvas/connections",
  currentUser: {
    ...data.currentUser,
    provider: "local",
    login: "local-developer",
    name: "Local developer",
    avatarUrl: null,
  },
  accountMenuLabel: "Account menu for Local developer",
  repositoriesLabel: "Prototypes",
  emptyRepositoryLabel: "No repository selected",
  selectedSection: "prototypes",
  signOutPath: "/api/auth/session/sign-out",
  notificationsLabel: "Inbox",
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
      administrationLinks: [
        { section: "admins", label: "Hub administrators", path: "/settings/admins" },
        { section: "sharing", label: "Public sharing", path: "/settings/sharing" },
        { section: "sessions", label: "End all Hub sessions", path: "/settings/sessions" },
        { section: "github", label: "GitHub App", path: "/settings/github" },
        { section: "copilot", label: "Copilot connection", path: "/settings/copilot" },
      ],
      securityAuditPath: "/settings/audit?scope=hub",
    },
  },
}
