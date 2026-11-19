import type { NotificationsPageData } from "@pages/notifications-page/types"
import { notificationInboxConfiguration } from "@utils/notification/inbox-configuration"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { SettingsWorkspaceResponse } from "@application/hub/settings-contracts/types"

import { settingsWorkspace } from "../settings-workspace"

export function settingsNotifications(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): NotificationsPageData {
  return {
    ...settingsWorkspace(workspace, state, search, "notifications"),
    notificationInbox: notificationInboxConfiguration,
  }
}
