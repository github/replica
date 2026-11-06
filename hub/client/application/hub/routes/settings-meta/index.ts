import type { SettingsSection } from "../../settings-contracts/types"
import type { SettingsRouteData } from "../settings-controller/types"

export function settingsMeta(section: SettingsSection, loaderData?: SettingsRouteData) {
  if (!loaderData) return [{ title: "Replica Hub" }]
  const labels: Record<SettingsSection, string> = {
    analytics: "Analytics",
    canvas: "Canvas connections",
    "canvas-approval": "Connect Replica canvas",
    copilot: "Copilot connection",
    authorize: "Fresh GitHub authorization required",
    github: "GitHub App",
    "github-setup": "Set up Replica Hub",
    "github-register": "Create GitHub App",
    "github-installed": "Install GitHub App",
    "admin-confirmation": "Confirm Hub administrator role change",
    enrollment: "Enroll a Hub operator",
    admins: "Hub administrators",
    learnings: "Learnings",
    notifications: "Inbox",
    audit: "Security audit",
    sessions: "End all Hub sessions",
    welcome: "Welcome",
  }
  let title = labels[section]
  if (loaderData.surface === "workspace") {
    if ((section === "analytics" || section === "learnings") && loaderData.state.repository) {
      title += ` - ${loaderData.state.repository.nameWithOwner}`
    } else if (section === "github" && loaderData.query.change) {
      title = {
        credentials: "Replace App credentials",
        rotation: "Webhook secret rotation",
        reset: "Reset local GitHub App?",
      }[loaderData.query.change]
    } else if (section === "admin-confirmation" && loaderData.confirmation) {
      title =
        loaderData.confirmation.operation === "designate"
          ? "Designate Hub administrator?"
          : "Remove Hub administrator?"
    } else if (section === "notifications" && loaderData.state.notifications.unreadCount) {
      title += ` (${loaderData.state.notifications.unreadCount} unread)`
    }
  } else if (section === "sessions" && !loaderData.state.session.viewer) {
    title = loaderData.state.sessionRevoked
      ? "All existing Hub sessions ended"
      : "Sign in to continue"
  } else if (section === "authorize" && !loaderData.state.continuation) {
    title = "Nothing to authorize"
  } else if (section === "github-installed" && loaderData.state.github.state === "installed") {
    title = "GitHub connected"
  }
  return [{ title: `${title} - Replica Hub` }]
}
