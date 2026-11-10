import type { Meta, StoryObj } from "@storybook/react-vite"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

import { SecurityAuditPage } from "."
import type { SecurityAuditPageData } from "./types"

const data: SecurityAuditPageData = {
  administrationWorkspace: {
    ...hubAdministrationWorkspaceData,
    selectedSection: "audit",
    securityAuditPath: "/settings/audit?scope=hub",
  },
  pageTitle: "Security audit",
  heading: "Security audit",
  description: "Hub-wide identity, sign-in, session, and administrator security actions.",
  notice: null,
  scopeLabel: "Audit scope",
  selectedScopeId: "hub",
  scopes: [
    { id: "hub", label: "Hub", path: "/settings/audit?scope=hub" },
    {
      id: "2001",
      label: "github/prototype",
      path: "/settings/audit?scope=repository&repositoryId=2001",
    },
    {
      id: "2002",
      label: "github/empty",
      path: "/settings/audit?scope=repository&repositoryId=2002",
    },
  ],
  retention: "Records are shown newest first. Export and retention controls are not available.",
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
    context: "Context",
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
          id: "11111111-1111-4111-8111-111111111111",
          time: "2026-10-05T19:00:00Z",
          action: "membership.assignment.administrator_created",
          actor: "Membership 22222222-2222-4222-8222-222222222222",
          context: [
            { label: "Source", value: "hub_administrator" },
            { label: "Target membership", value: "33333333-3333-4333-8333-333333333333" },
          ],
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
      nextPath: "/settings/audit?scope=hub&before=opaque-cursor",
      events: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          time: "2026-10-05T19:01:00Z",
          action: "admission.denied",
          actor: "No signed-in actor",
          context: [{ label: "Reason", value: "membership_missing" }],
          outcome: "Denied",
        },
        {
          id: "11111111-1111-4111-8111-111111111111",
          time: "2026-10-05T19:00:00Z",
          action: "unknown.future.action",
          actor: "No signed-in actor",
          context: [],
          outcome: "Not recorded",
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
        securityAuditPath: "/settings/audit?scope=repository&repositoryId=2001",
        selectedSection: "security",
      },
      events: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          time: "2026-10-05T19:00:00Z",
          action: "share_link.create",
          actor: "octocat",
          context: [
            { label: "Prototype", value: "Welcome" },
            { label: "Build", value: "3" },
          ],
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
