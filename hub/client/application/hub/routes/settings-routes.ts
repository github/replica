import { route } from "@react-router/dev/routes"
import type { RouteConfigEntry } from "@react-router/dev/routes"

export const settingsWorkspaceRoutes: RouteConfigEntry[] = [
  route("welcome", "routes/settings-welcome/index.tsx"),
  route("notifications", "routes/settings-notifications/index.tsx"),
  route("settings/analytics", "routes/settings-analytics/index.tsx"),
  route("settings/learnings", "routes/settings-learnings/index.tsx"),
  route("settings/canvas", "routes/settings-canvas/index.tsx"),
  route("settings/canvas/approve", "routes/settings-canvas-approval/index.tsx"),
  route("settings/copilot", "routes/settings-copilot/index.tsx"),
  route("settings/github", "routes/settings-github/index.tsx"),
  route("settings/admins", "routes/settings-admins/index.tsx"),
  route("settings/admins/:userId/:operation", "routes/settings-admin-confirmation/index.tsx"),
  route("settings/audit", "routes/settings-audit/index.tsx"),
]

export const settingsPublicRoutes: RouteConfigEntry[] = [
  route("settings/github/setup", "routes/settings-github-setup/index.tsx"),
  route("settings/github/register", "routes/settings-github-register/index.tsx"),
  route("settings/github/installed", "routes/settings-github-installed/index.tsx"),
  route("settings/enroll", "routes/settings-enrollment/index.tsx"),
  route("settings/authorize", "routes/settings-authorize/index.tsx"),
  route("settings/sessions", "routes/settings-sessions/index.tsx"),
]
