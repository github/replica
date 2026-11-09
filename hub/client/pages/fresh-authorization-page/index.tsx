import { Button, Stack } from "@primer/react-brand"
import type { Ref } from "react"

import { HubAlert } from "@components/hub-alert"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { GithubAppSetupHeader } from "@features/github-app-setup-header"
import { GithubAppSetupPage } from "@features/github-app-setup-page"
import { HubAdministrationWorkspace } from "@features/hub-administration-workspace"

import type { FreshAuthorizationPageData } from "./types"
import "@features/hub-administration-page/styles.css"

export function FreshAuthorizationPage({
  data,
  error,
  continuationFormRef,
}: {
  data: FreshAuthorizationPageData
  error?: string | null
  continuationFormRef?: Ref<HTMLFormElement>
}) {
  const actions = (
    <Stack direction="vertical" gap="normal">
      <form action={data.submitPath} method="post" ref={continuationFormRef}>
        <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
        {data.continuation && (
          <>
            <input
              type="hidden"
              name="authorization_continuation_id"
              value={data.continuation.id}
            />
            <input type="hidden" name="_method" value={data.continuation.method} />
          </>
        )}
        <Button type="submit" variant="primary" disabled={data.canContinue === false} block>
          {data.submitLabel}
        </Button>
      </form>

      {data.cancelPath && (
        <form action={data.cancelPath} method="post">
          <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
          <input type="hidden" name="_method" value="delete" />
          {data.continuation ? (
            <input
              type="hidden"
              name="authorization_continuation_id"
              value={data.continuation.id}
            />
          ) : null}
          <Button type="submit" variant="subtle" block>
            {data.cancelLabel}
          </Button>
        </form>
      )}
    </Stack>
  )
  return data.administrationWorkspace ? (
    <HubAdministrationWorkspace data={data.administrationWorkspace}>
      <section className="hub-administration-page">
        <HubContentPageHeader headingAs="h1" title={data.heading} description={data.description} />
        {error ? <HubAlert variant="critical" title={error} /> : null}
        {actions}
      </section>
    </HubAdministrationWorkspace>
  ) : (
    <GithubAppSetupPage>
      <GithubAppSetupHeader data={data} />
      {error ? <HubAlert variant="critical" title={error} /> : null}
      {actions}
    </GithubAppSetupPage>
  )
}
