import { useCallback } from "react"
import { useLocation, useNavigate, useOutletContext } from "react-router"

import { AnalyticsPage } from "@pages/analytics-page"
import { CanvasPairingsPage } from "@pages/canvas-pairings-page"
import { CopilotConnectionPage } from "@pages/copilot-connection-page"
import { GithubAppPage } from "@pages/github-app-page"
import { HubAdminConfirmationPage } from "@pages/hub-admin-confirmation-page"
import { HubAdminsPage } from "@pages/hub-admins-page"
import { LearningsPage } from "@pages/learnings-page"
import { NotificationsPage } from "@pages/notifications-page"
import { SecurityAuditPage } from "@pages/security-audit-page"
import { WelcomePage } from "@pages/welcome-page"

import { workspaceResponseSchema } from "../../contracts"
import { settingsRequest } from "../../requests/settings-request"
import { settingsCandidateResponseSchema } from "../../settings-contracts"
import type { SettingsSection } from "../../settings-contracts"
import type { SettingsRouteData } from "../../routes/settings-controller/types"
import { settingsAdminConfirmation } from "../../view-models/settings-admin-confirmation"
import { settingsAdmins } from "../../view-models/settings-admins"
import { settingsAnalytics } from "../../view-models/settings-analytics"
import { settingsAudit } from "../../view-models/settings-audit"
import { settingsCanvas } from "../../view-models/settings-canvas"
import { settingsCopilot } from "../../view-models/settings-copilot"
import { settingsGithub } from "../../view-models/settings-github"
import { settingsLearnings } from "../../view-models/settings-learnings"
import { settingsNotifications } from "../../view-models/settings-notifications"
import { settingsWelcome } from "../../view-models/settings-welcome"

export function SettingsWorkspaceScreen({
  section,
  data,
  busy,
  failed,
  onSubmit,
  onRetry,
}: {
  section: SettingsSection
  data: Extract<SettingsRouteData, { surface: "workspace" }>
  busy: boolean
  failed: boolean
  onSubmit: (input: FormData) => void
  onRetry: () => void
}) {
  const workspace = workspaceResponseSchema.parse(useOutletContext<unknown>())
  const location = useLocation()
  const navigate = useNavigate()
  const search = new URLSearchParams(location.search)
  const { state, query } = data
  const onSearch = useCallback((q: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set("q", q)
    return settingsRequest(new Request(url), "admin-candidates", settingsCandidateResponseSchema)
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
        throw new Error("A mock administrator confirmation is missing its validated target.")
      return (
        <HubAdminConfirmationPage
          data={settingsAdminConfirmation(
            workspace,
            state,
            search,
            data.confirmation.userId,
            data.confirmation.operation,
          )}
        />
      )
    }
    case "learnings":
      return <LearningsPage data={settingsLearnings(workspace, state, search)} />
    case "notifications":
      return (
        <NotificationsPage
          data={settingsNotifications(workspace, state, search)}
          notifications={state.notifications.items}
          unreadCount={state.notifications.unreadCount}
          unreadOnly={state.notifications.unreadOnly}
          loading={busy}
          failed={failed}
          hasMore={state.notifications.hasMore}
          onFilter={(unread) => changeInbox({ unread: String(unread), limit: "2" })}
          onToggleRead={(id) => {
            const notification = state.notifications.items.find((entry) => entry.id === id)
            if (!notification) throw new Error("An unrendered notification cannot be changed.")
            const input = new FormData()
            input.set("_action", "/notifications")
            input.set("notificationId", String(id))
            input.set("version", String(notification.version))
            input.set("read", String(!notification.read))
            onSubmit(input)
          }}
          onLoadMore={() =>
            changeInbox({ limit: String(Math.min(50, state.notifications.limit + 2)) })
          }
          onRetry={onRetry}
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
