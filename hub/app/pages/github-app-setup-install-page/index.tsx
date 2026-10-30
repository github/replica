import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"
import type { GithubAppSetupInstallPageData } from "./types"

/** Confirms that GitHub App creation and installation succeeded. */
export function GithubAppSetupInstallPage({ data }: { data: GithubAppSetupInstallPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />
    </GithubAppSetupPage>
  )
}
