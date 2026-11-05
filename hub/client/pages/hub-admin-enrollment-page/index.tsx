import { Button, FormControl, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"

import type { HubAdminEnrollmentPageData } from "./types"
import "./styles.css"

/** Requires the deployment bootstrap secret before starting a fresh GitHub identity check. */
export function HubAdminEnrollmentPage({ data }: { data: HubAdminEnrollmentPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />
      {data.alert ? <HubAlert title={data.alert} variant="warning" /> : null}
      <form action={data.submitPath} method="post" className="administrator-enrollment__form">
        <FormControl required>
          <FormControl.Label>{data.secretLabel}</FormControl.Label>
          <TextInput
            name="bootstrap_secret"
            type="password"
            autoComplete="current-password"
            fullWidth
          />
        </FormControl>
        <Button type="submit" variant="primary" disabled={data.canContinue === false} block>
          {data.submitLabel}
        </Button>
      </form>
    </GithubAppSetupPage>
  )
}
