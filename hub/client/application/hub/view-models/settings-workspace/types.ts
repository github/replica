import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { SettingsWorkspaceResponse } from "@application/hub/settings-contracts/types"

export type NavigationState = Pick<SettingsWorkspaceResponse, "repository" | "welcomeHidden"> & {
  session: { capabilities: WorkspaceResponse["capabilities"] }
  notifications: Pick<SettingsWorkspaceResponse["notifications"], "unreadCount">
}
