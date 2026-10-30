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
        {!data.simulation ? (
          <FormControl required>
            <FormControl.Label>{data.secretLabel}</FormControl.Label>
            <TextInput
              name="bootstrap_secret"
              type="password"
              autoComplete="current-password"
              fullWidth
            />
          </FormControl>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={data.canContinue === false}
          className={data.simulation ? "operator-enrollment__mock-control" : undefined}
          block
        >
          {data.submitLabel}
        </Button>
      </form>
    </GithubAppSetupPage>
  )
}
