import { useState } from "react"

import type { Meta, StoryObj } from "@storybook/react-vite"

import { authenticatedHeaderData } from "@/storybook/fixtures/authenticated-header"
import { githubEmpty, githubPrototype } from "@/storybook/fixtures/repositories"
import { mona } from "@/storybook/fixtures/users"

import { WorkspaceNav } from "."
import type { WorkspaceNavData } from "./types"

const administrationLinks: NonNullable<WorkspaceNavData["administrationLinks"]> = [
  { section: "admins", label: "Hub administrators", path: "/settings/admins" },
  { section: "sharing", label: "Public sharing", path: "/settings/sharing" },
  { section: "sessions", label: "End all Hub sessions", path: "/settings/sessions" },
  { section: "github", label: "GitHub App", path: "/settings/github" },
  { section: "copilot", label: "Copilot connection", path: "/settings/copilot" },
]
const repository = {
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  analyticsLabel: "Analytics",
  analyticsPath: "/repositories/2001/analytics",
  learningsLabel: "Learnings",
  learningsPath: "/repositories/2001/learnings",
  repositories: [githubPrototype, githubEmpty],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
}
const administrator: WorkspaceNavData = {
  ...authenticatedHeaderData,
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  navigationLabel: "Repository navigation",
  settingsNavigationLabel: "Security and settings",
  welcomeLabel: "Welcome",
  welcomePath: "/welcome?repositoryId=2001",
  notificationsLabel: "Notifications",
  notificationsPath: "/notifications?repositoryId=2001",
  notificationsUnread: true,
  notificationsUnreadCount: 12,
  notificationsUnreadLabel: "Notifications, 12 unread",
  repositoriesLabel: "Repositories",
  repositoriesPath: "/repositories",
  repository,
  administrationLinks: administrationLinks.map((link) => ({
    ...link,
    path: `${link.path}?repositoryId=2001`,
  })),
  securityAuditLabel: "Security audit",
  securityAuditPath: "/settings/audit?repositoryId=2001&scope=hub",
  selectedSection: "prototypes",
}

const meta = {
  title: "Hub/Features/Workspace Navigation",
  component: WorkspaceNav,
  args: {
    collapsed: false,
    data: administrator,
    onCollapsedChange: () => undefined,
  },
  render: function WorkspaceNavStory(args) {
    const [collapsed, setCollapsed] = useState(args.collapsed)
    return <WorkspaceNav {...args} collapsed={collapsed} onCollapsedChange={setCollapsed} />
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspaceNav>

export default meta
type Story = StoryObj<typeof meta>

export const Administrator: Story = {}

export const WithoutRepository: Story = {
  args: {
    data: {
      ...administrator,
      navigationLabel: "Hub navigation",
      repository: null,
      welcomePath: "/welcome",
      notificationsPath: "/notifications",
      administrationLinks,
      securityAuditPath: "/settings/audit?scope=hub",
      selectedSection: "welcome",
    },
  },
}

export const ReadOnly: Story = {
  args: {
    data: {
      ...administrator,
      accountMenuLabel: "Account menu for @mona",
      currentUser: mona,
      canvasConnectionsPath: "/canvas/connections",
      repository: { ...repository, newPrototypePath: null },
      administrationLinks: [],
      securityAuditPath: "/settings/audit?repositoryId=2001&scope=repository",
    },
  },
}

export const UnreadInbox: Story = {
  args: {
    data: {
      ...administrator,
      notificationsLabel: "Inbox",
      notificationsUnreadCount: undefined,
      notificationsUnreadLabel: "Inbox, unread notifications",
    },
  },
}
