import { usePageData } from "@hooks/use-page-data"
import { GithubAppSetupManualPage } from "@pages/github-app-setup-manual-page"
import type { GithubAppSetupManualPageData } from "@pages/github-app-setup-manual-page/types"

export default function GithubAppSetupManualView() {
  return <GithubAppSetupManualPage data={usePageData<GithubAppSetupManualPageData>()} />
}
