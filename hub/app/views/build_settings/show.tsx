import { usePageData } from "@hooks/use-page-data"
import { useWorkspaceInbox } from "@hooks/use-workspace-inbox"
import { BuildSettingsPage } from "@pages/build-settings-page"
import type { BuildSettingsPageData } from "@pages/build-settings-page/types"

export default function BuildSettingsShowView() {
  return <BuildSettingsPage data={useWorkspaceInbox(usePageData<BuildSettingsPageData>())} />
}
