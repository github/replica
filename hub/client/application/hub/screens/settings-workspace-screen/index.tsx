import { useCallback } from "react"
import { useLocation, useNavigate, useOutletContext } from "react-router"

import { AnalyticsPage } from "@pages/analytics-page"
import { CanvasPairingsPage } from "@pages/canvas-pairings-page"
import { CopilotConnectionPage } from "@pages/copilot-connection-page"
import { GithubAppPage } from "@pages/github-app-page"
import { HubAdminConfirmationPage } from "@pages/hub-admin-confirmation-page"
import { HubAdminsPage } from "@pages/hub-admins-page"
import { LearningsPage } from "@pages/learnings-page"
import { SecurityAuditPage } from "@pages/security-audit-page"
import { WelcomePage } from "@pages/welcome-page"
import { workspaceResponseSchema } from "@application/hub/contracts"
import { settingsRequest } from "@application/hub/requests/settings-request"
import { settingsCandidateResponseSchema } from "@application/hub/settings-contracts"
import type { SettingsSection } from "@application/hub/settings-contracts/types"
import type { SettingsRouteData } from "@application/hub/routes/settings-controller/types"
import { settingsAdminConfirmation } from "@application/hub/view-models/settings-admin-confirmation"
import { settingsAdmins } from "@application/hub/view-models/settings-admins"
import { settingsAnalytics } from "@application/hub/view-models/settings-analytics"
import { settingsAudit } from "@application/hub/view-models/settings-audit"
import { settingsCanvas } from "@application/hub/view-models/settings-canvas"
import { settingsCopilot } from "@application/hub/view-models/settings-copilot"
import { settingsGithub } from "@application/hub/view-models/settings-github"
import { settingsLearnings } from "@application/hub/view-models/settings-learnings"
import { settingsWelcome } from "@application/hub/view-models/settings-welcome"

import { NotificationsScreen } from "../notifications-screen"

export function SettingsWorkspaceScreen({
  section,
  data,
  busy,
}: {
  section: SettingsSection
  data: Extract<SettingsRouteData, { surface: "workspace" }>
  busy: boolean
}) {
  const workspace = workspaceResponseSchema.parse(useOutletContext<unknown>())
  const location = useLocation()
  const navigate = useNavigate()
  const search = new URLSearchParams(location.search)
  const { state, query } = data
  const onSearch = useCallback((q: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set("q", q)
    return settingsRequest(
      new Request(url),
      "admin-candidates",
      settingsCandidateResponseSchema,
    ).then((response) => ({
      users: response.users.map((user) => ({
        id: String(user.id),
        provider: "github",
        login: user.login,
        name: user.name,
      })),
      more: response.more,
    }))
  }, [])

  function changeInbox(values: Record<string, string>) {
    const updated = new URLSearchParams(location.search)
    Object.entries(values).forEach(([key, value]) => updated.set(key, value))
    void navigate(`${location.pathname}?${updated}`)
  }

  switch (section) {
    case "analytics":
      return <AnalyticsPage data={settingsAnalytics(workspace, state, search)} />
    case "canvas":
    case "canvas-approval":
      return (
        <CanvasPairingsPage data={settingsCanvas(state, search, section === "canvas-approval")} />
      )
    case "copilot":
      return <CopilotConnectionPage data={settingsCopilot(workspace, state, search)} />
    case "github":
      return <GithubAppPage data={settingsGithub(workspace, state, search, query)} />
    case "admins":
      return (
        <HubAdminsPage
          key={state.revision}
          data={settingsAdmins(workspace, state, search)}
          onSearch={onSearch}
          pending={busy}
        />
      )
    case "admin-confirmation": {
      if (!data.confirmation)
        throw new Error("An administrator confirmation is missing its validated target.")
      return (
        <HubAdminConfirmationPage
          data={settingsAdminConfirmation(
            workspace,
            state,
            search,
            data.confirmation.user,
            data.confirmation.operation,
          )}
        />
      )
    }
    case "learnings":
      return <LearningsPage data={settingsLearnings(workspace, state, search)} />
    case "notifications":
      return (
        <NotificationsScreen
          key={`${query.repositoryId ?? ""}:${query.unread}`}
          workspace={workspace}
          state={state}
          search={search}
          onFilter={(unread) => changeInbox({ unread: String(unread), page: "1" })}
        />
      )
    case "audit":
      return <SecurityAuditPage data={settingsAudit(workspace, state, search, query)} />
    case "welcome":
      return <WelcomePage data={settingsWelcome(workspace, state, search)} />
    default:
      throw new Error("A public settings page was mounted in the private settings surface.")
  }
}
