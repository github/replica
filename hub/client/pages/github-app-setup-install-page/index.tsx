import { Button, Stack } from "@primer/react-brand"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"
import type { GithubAppSetupInstallPageData } from "./types"

/** Confirms that GitHub App creation and installation succeeded. */
export function GithubAppSetupInstallPage({ data }: { data: GithubAppSetupInstallPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />
      {data.submitPath || data.nextPath ? (
        <Stack direction="vertical" gap="normal">
          {data.submitPath && data.submitLabel ? (
            <form action={data.submitPath} method="post">
              <Button type="submit" variant="primary" disabled={data.canContinue === false} block>
                {data.submitLabel}
              </Button>
            </form>
          ) : null}
          {data.nextPath && data.nextLabel ? (
            <Button as="a" href={data.nextPath} variant="secondary" block>
              {data.nextLabel}
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </GithubAppSetupPage>
  )
}
