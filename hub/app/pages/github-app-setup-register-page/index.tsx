import { Button, Text } from "@primer/react-brand"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"
import type { GithubAppSetupRegisterPageData } from "./types"

import "./styles.css"

/** Explains the App's access before sending its manifest to GitHub. */
export function GithubAppSetupRegisterPage({ data }: { data: GithubAppSetupRegisterPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />

      <Text as="p" className="setup__access">
        {data.access}
      </Text>

      <form action={data.submitPath} method="post">
        <input type="hidden" name="manifest" value={data.manifest} />
        <Button type="submit" variant="primary" block>
          {data.submitLabel}
        </Button>
      </form>
    </GithubAppSetupPage>
  )
}
