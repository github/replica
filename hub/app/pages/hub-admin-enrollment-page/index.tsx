import { Button, FormControl, TextInput } from "@primer/react-brand"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"

import type { HubAdminEnrollmentPageData } from "./types"
import "./styles.css"

/** Requires operator-secret possession before starting a fresh GitHub identity check. */
export function HubAdminEnrollmentPage({ data }: { data: HubAdminEnrollmentPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />
      <form action={data.submitPath} method="post" className="operator-enrollment__form">
        <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
        <FormControl required>
          <FormControl.Label>{data.secretLabel}</FormControl.Label>
          <TextInput
            name="bootstrap_secret"
            type="password"
            autoComplete="current-password"
            fullWidth
          />
        </FormControl>
        <Button type="submit" variant="primary" block>
          {data.submitLabel}
        </Button>
      </form>
    </GithubAppSetupPage>
  )
}
