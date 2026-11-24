import { route } from "@react-router/dev/routes"
import type { RouteConfigEntry } from "@react-router/dev/routes"

export const workspaceSettingsRoutes: RouteConfigEntry[] = [
  route("settings/:section", "routes/legacy-repository-settings/index.tsx"),
  route("settings/canvas", "routes/settings-canvas/index.tsx"),
  route("settings/canvas/approve", "routes/settings-canvas-approval/index.tsx"),
  route("settings/administrators", "routes/settings-administrators/index.tsx"),
  route("settings/administrators/confirm", "routes/settings-administrator-authorization/index.tsx"),
  route(
    "settings/administrators/:membershipId/:operation",
    "routes/settings-administrator-confirmation/index.tsx",
  ),
  route("settings/sessions", "routes/settings-sessions/index.tsx"),
  route("settings/sessions/confirm", "routes/settings-session-revocation-authorization/index.tsx"),
  route("settings/copilot", "routes/settings-copilot/index.tsx"),
  route("settings/copilot/confirm", "routes/settings-copilot-authorization/index.tsx"),
  route("settings/admins", "routes/settings-admins/index.tsx"),
  route("settings/admins/:userId/:operation", "routes/settings-admin-confirmation/index.tsx"),
  route("settings/audit", "routes/settings-audit/index.tsx"),
]

export const standaloneSetupRoutes: RouteConfigEntry[] = [
  route("settings/github/setup", "routes/settings-github-setup/index.tsx"),
]
