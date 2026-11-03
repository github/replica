import type { ReactNode } from "react"

import { Button } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { HubAdministrationWorkspace } from "@features/hub-administration-workspace"
import { HubWorkspace } from "@features/hub-workspace"

import type { HubAdministrationPageData } from "./types"
import "./styles.css"

/** Keeps deployment controls separate from repository navigation and permissions. */
export function HubAdministrationPage({
  data,
  children,
}: {
  data: HubAdministrationPageData
  children: ReactNode
}) {
  const content = (
    <section className="hub-administration-page">
      <HubContentPageHeader headingAs="h1" title={data.heading} description={data.description} />

      {!data.signedOut && !data.administrationWorkspace && !data.authenticatedWorkspace ? (
        <nav className="hub-administration-page__actions" aria-label={data.heading}>
          <Button as="a" href={data.repositoriesPath} variant="secondary">
            {data.repositoriesLabel}
          </Button>
          <form action={data.signOutPath} method="post">
            <input type="hidden" name="_method" value="delete" />
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
            <Button type="submit" variant="secondary">
              {data.signOutLabel}
            </Button>
          </form>
        </nav>
      ) : null}

      {data.alert ? <HubAlert variant="critical" title={data.alert} /> : null}
      {data.notice ? <HubAlert variant="success" title={data.notice} /> : null}

      {children}
    </section>
  )
  return data.administrationWorkspace && !data.signedOut ? (
    <HubAdministrationWorkspace data={data.administrationWorkspace}>
      {content}
    </HubAdministrationWorkspace>
  ) : data.authenticatedWorkspace && !data.signedOut ? (
    <HubWorkspace data={data.authenticatedWorkspace}>{content}</HubWorkspace>
  ) : (
    <main>{content}</main>
  )
}
