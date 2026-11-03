import { CheckIcon } from "@primer/octicons-react"
import { ActionMenu, Button, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { RepositoryWorkspace } from "@features/repository-workspace"
import { HubAdministrationWorkspace } from "@features/hub-administration-workspace"

import type { SecurityAuditPageData } from "./types"
import "./styles.css"

/** Displays only the server-authorized audit scope, with no export or mutation controls. */
export function SecurityAuditPage({ data }: { data: SecurityAuditPageData }) {
  const content = (
    <section className="security-audit-page">
      <HubContentPageHeader headingAs="h1" title={data.heading} description={data.description} />
      <div className="security-audit-page__scope">
        <Text as="span">{data.scopeLabel}</Text>
        <ActionMenu size="small" selectionVariant="none" menuAlignment="start">
          <ActionMenu.Button aria-label={data.scopeLabel} variant="subtle" size="small">
            {data.scopes.find((scope) => scope.id === data.selectedScopeId)?.label}
          </ActionMenu.Button>
          <ActionMenu.Overlay aria-label={data.scopeLabel}>
            {data.scopes.map((scope) => (
              <ActionMenu.Item
                as="a"
                key={scope.id}
                href={scope.path}
                aria-current={scope.id === data.selectedScopeId ? "page" : undefined}
                leadingVisual={
                  scope.id === data.selectedScopeId ? <CheckIcon size={16} /> : undefined
                }
                onKeyDown={(event) => {
                  if (
                    event.key === " " ||
                    (event.key === "Enter" && event.target === event.currentTarget)
                  ) {
                    event.preventDefault()
                    event.currentTarget.querySelector("a")?.click()
                  }
                }}
              >
                {scope.label}
              </ActionMenu.Item>
            ))}
          </ActionMenu.Overlay>
        </ActionMenu>
      </div>
      {data.scopesUnavailableMessage ? (
        <HubAlert title={data.scopesUnavailableMessage} variant="warning" />
      ) : null}
      {data.notice ? <HubAlert title={data.notice} variant="success" /> : null}
      <Text as="p">{data.retention}</Text>
      {!data.workspace && !data.administrationWorkspace ? (
        <div className="security-audit-page__actions">
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
        </div>
      ) : null}
      {data.events.length ? (
        <div
          className="security-audit-page__records"
          role="region"
          aria-label={data.heading}
          tabIndex={0}
        >
          <table>
            <caption className="security-audit-page__caption">{data.heading}</caption>
            <thead>
              <tr>
                {Object.entries(data.columns).map(([key, label]) => (
                  <th key={key} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <time dateTime={event.time}>{event.time}</time>
                  </td>
                  <td>
                    <code>{event.action}</code>
                  </td>
                  <td>{event.actor}</td>
                  <td>{event.ip}</td>
                  <td>
                    <code>{event.context}</code>
                  </td>
                  <td>{event.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Text as="p">{data.emptyLabel}</Text>
      )}
      {data.nextPath ? (
        <Button as="a" href={data.nextPath} variant="secondary">
          {data.nextLabel}
        </Button>
      ) : null}
    </section>
  )
  return data.workspace ? (
    <RepositoryWorkspace data={data.workspace}>{content}</RepositoryWorkspace>
  ) : data.administrationWorkspace ? (
    <HubAdministrationWorkspace data={data.administrationWorkspace}>
      {content}
    </HubAdministrationWorkspace>
  ) : (
    <main>{content}</main>
  )
}
