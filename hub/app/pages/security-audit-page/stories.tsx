import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

import { SecurityAuditPage } from "."
import type { SecurityAuditPageData } from "./types"

const data: SecurityAuditPageData = {
  administrationWorkspace: {
    ...hubAdministrationWorkspaceData,
    selectedSection: "audit",
    securityAuditPath: "/security_audit",
  },
  pageTitle: "Security audit",
  heading: "Security audit",
  description:
    "Deployment security actions. Repository records require that repository's GitHub admin permission.",
  notice: null,
  scopeLabel: "Audit scope",
  selectedScopeId: "hub",
  scopes: [
    { id: "hub", label: "Hub", path: "/security_audit" },
    { id: "2001", label: "github/prototype", path: "/repositories/2001/security_audit" },
    { id: "2002", label: "github/empty", path: "/repositories/2002/security_audit" },
  ],
  retention:
    "Records are kept for 90 days and are never sent to analytics destinations. Security acceptance of this retention period is pending.",
  emptyLabel: "No retained security actions.",
  nextLabel: "Older actions",
  nextPath: null,
  repositoriesLabel: "Repositories",
  repositoriesPath: "/repositories",
  hubAdminsLabel: "Hub administrators",
  hubAdminsPath: "/hub_admins",
  githubAppLabel: "GitHub App",
  githubAppPath: "/github_app",
  sharingSettingsLabel: "Public sharing",
  sharingSettingsPath: "/sharing_settings",
  sessionRevocationLabel: "End all Hub sessions",
  sessionRevocationPath: "/session_revocation",
  signOutLabel: "Sign out",
  signOutPath: "/session",
  authenticityToken: "storybook-token",
  columns: {
    time: "Time (UTC)",
    action: "Action",
    actor: "Actor",
    ip: "Source IP",
    context: "Device and connection",
    outcome: "Outcome",
  },
  events: [],
}

const meta = {
  title: "Hub/Pages/Security/Audit",
  component: SecurityAuditPage,
  parameters: { layout: "fullscreen" },
  args: { data },
} satisfies Meta<typeof SecurityAuditPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const HubOnly: Story = {
  args: {
    data: {
      ...data,
      administrationWorkspace: {
        ...data.administrationWorkspace!,
        repository: null,
      },
      scopes: data.scopes.filter((scope) => scope.id === "hub"),
    },
  },
}
export const ScopesUnavailable: Story = {
  args: {
    data: {
      ...data,
      scopes: data.scopes.filter((scope) => scope.id === "hub"),
      scopesUnavailableMessage:
        "Some repository admin permissions could not be verified. Those scope choices are unavailable; the current authorized audit scope is unchanged.",
    },
  },
}

export const AuthorizationSucceeded: Story = {
  args: {
    data: {
      ...data,
      notice:
        "GitHub authorization succeeded for this connection only. Return to the action and submit it again within five minutes.",
    },
  },
}

export const Single: Story = {
  args: {
    data: {
      ...data,
      events: [
        {
          id: 1,
          time: "2026-10-05T19:00:00Z",
          action: "hub_admin.enroll",
          actor: "User 1001",
          ip: "203.0.113.12",
          context: '{"source":"browser","device_family":"desktop","browser_family":"firefox"}',
          outcome: "Succeeded",
        },
      ],
    },
  },
}

export const Multiple: Story = {
  args: {
    data: {
      ...data,
      nextPath: "/security_audit?before=1",
      events: [
        {
          id: 2,
          time: "2026-10-05T19:01:00Z",
          action: "hub_admin.enroll",
          actor: "No signed-in actor",
          ip: "203.0.113.12",
          context: '{"source":"browser","device_family":"mobile","browser_family":"safari"}',
          outcome: "Denied",
        },
        {
          id: 1,
          time: "2026-10-05T19:00:00Z",
          action: "github_app.reset",
          actor: "No signed-in actor",
          ip: "Not available",
          context: '{"source":"command"}',
          outcome: "Succeeded",
        },
      ],
    },
  },
}

export const Repository: Story = {
  args: {
    data: {
      ...data,
      hubAdminsPath: null,
      administrationWorkspace: null,
      githubAppPath: null,
      sharingSettingsPath: null,
      sessionRevocationPath: null,
      selectedScopeId: "2001",
      scopes: data.scopes.filter((scope) => scope.id !== "hub"),
      description:
        "Security actions for github/prototype. Global setup and operator records are not included.",
      workspace: {
        ...prototypeWorkspaceData,
        analyticsLabel: "Analytics",
        analyticsPath: "/repositories/2001/analytics",
        selectedSection: "security",
      },
      events: [
        {
          id: 1,
          time: "2026-10-05T19:00:00Z",
          action: "share_link.create",
          actor: "User 1001",
          ip: "203.0.113.12",
          context: '{"source":"canvas","canvas_grant_id":1,"share_link_id":1}',
          outcome: "Succeeded",
        },
      ],
    },
  },
}
export const RepositoryEmpty: Story = {
  args: {
    data: { ...Repository.args!.data!, events: [] },
  },
}
export const RepositoryAndHubAdmin: Story = {
  args: {
    data: {
      ...Repository.args!.data!,
      scopes: data.scopes,
      workspace: {
        ...Repository.args!.data!.workspace!,
        administrationLinks: hubAdministrationWorkspaceData.administrationLinks,
      },
    },
  },
}
