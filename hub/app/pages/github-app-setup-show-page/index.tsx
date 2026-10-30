import { Button, FormControl, TextInput } from "@primer/react-brand"

import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"
import type { GithubAppSetupShowPageData } from "./types"

import "./styles.css"

/** Collects the operator secret before disclosing setup availability. */
export function GithubAppSetupShowPage({ data }: { data: GithubAppSetupShowPageData }) {
  return (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />

      <form action={data.submitPath} method="post" className="setup__form">
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

        <FormControl>
          <FormControl.Label>{data.organizationLabel}</FormControl.Label>
          <TextInput name="organization" autoComplete="organization" fullWidth />
          <FormControl.Hint>{data.organizationHint}</FormControl.Hint>
        </FormControl>

        <Button type="submit" variant="primary" block>
          {data.submitLabel}
        </Button>
      </form>
    </GithubAppSetupPage>
  )
}
