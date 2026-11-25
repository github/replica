import { usePageData } from "@hooks/use-page-data"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import { NotificationSettingsPage } from "@pages/notification-settings-page"
import type { NotificationSettingsPageData } from "@pages/notification-settings-page/types"

export default function NotificationSettingsShowView() {
  return (
    <NotificationSettingsPage
      data={useRepositoryInbox(usePageData<NotificationSettingsPageData>())}
    />
  )
}
