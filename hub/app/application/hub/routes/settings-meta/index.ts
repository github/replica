import type { SettingsSection } from "../../settings-contracts"
import type { SettingsRouteData } from "../settings-controller/types"

export function settingsMeta(section: SettingsSection, loaderData?: SettingsRouteData) {
  if (!loaderData) return [{ title: "Replica Hub" }]
  const labels: Record<SettingsSection, string> = {
    analytics: "Analytics",
    canvas: "Canvas connections",
    "canvas-approval": "Approve mock canvas connection",
    copilot: "Copilot connection",
    authorize: "Mock confirmation",
    github: "GitHub App",
    "github-setup": "Mock GitHub App setup",
    "github-register": "Register mock GitHub App",
    "github-installed": "Mock GitHub App installation",
    "admin-confirmation": "Confirm mock administrator change",
    enrollment: "Mock administrator enrollment",
    admins: "Hub administrators",
    learnings: "Learnings",
    notifications: "Inbox",
    audit: "Security audit",
    sessions: "Mock browser session",
    welcome: "Welcome",
  }
  let title = labels[section]
  if (loaderData.surface === "workspace") {
    if ((section === "analytics" || section === "learnings") && loaderData.state.repository) {
      title += ` - ${loaderData.state.repository.nameWithOwner}`
    } else if (section === "github" && loaderData.query.change) {
      title = {
        credentials: "Simulate replacement credentials",
        rotation: "Simulate webhook rotation",
        reset: "Reset mock App configuration",
      }[loaderData.query.change]
    } else if (section === "admin-confirmation" && loaderData.confirmation) {
      title =
        loaderData.confirmation.operation === "designate"
          ? "Add mock administrator"
          : "Remove mock administrator"
    } else if (section === "notifications" && loaderData.state.notifications.unreadCount) {
      title += ` (${loaderData.state.notifications.unreadCount} unread)`
    }
  } else if (section === "sessions" && !loaderData.state.session.viewer) {
    title = loaderData.state.sessionRevoked
      ? "Mock browser session ended"
      : "Mock browser signed out"
  } else if (section === "authorize" && !loaderData.state.continuation) {
    title = "No pending mock confirmation"
  } else if (section === "github-installed" && loaderData.state.github.state === "installed") {
    title = "Mock GitHub App installed"
  }
  return [{ title: `${title} - Replica Hub` }]
}
