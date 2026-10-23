import { useState } from "react"

import { GearIcon, GitBranchIcon, SearchIcon } from "@primer/octicons-react"
import { Button, Pagination, Text } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubEmptyState } from "@components/hub-empty-state"
import { HubIconButton } from "@components/hub-icon-button"
import { PrototypeCard } from "@components/prototype-card"
import { PrototypeViewModeControl } from "@components/prototype-view-mode-control"
import type { PrototypeViewMode } from "@components/prototype-view-mode-control/types"
import { PrototypeIndexHeader } from "@features/prototype-index-header"
import { PrototypeAuthorFilter } from "@features/prototype-author-filter"
import { RepositoryWorkspace } from "@features/repository-workspace"
import { WorkflowInstallation } from "@features/workflow-installation"
import type { PrototypeListingControls } from "@utils/prototype-listing/types"

import type { RepositoriesShowPageData } from "./types"

import "./styles.css"

/** Shows branches after the server confirms repository access. */
export function RepositoriesShowPage({
  data,
  controls,
  managingPrototypes = false,
}: {
  data: RepositoriesShowPageData
  controls: PrototypeListingControls
  managingPrototypes?: boolean
}) {
  const [view, setView] = useState<PrototypeViewMode>("gallery")
  const filtered = Boolean(data.listing.query || data.listing.author)
  const visiblePrototypes = data.prototypes
  function pageHref(page: number) {
    const url = new URL(data.listing.pagePath, window.location.origin)
    if (page > 1) url.searchParams.set("page", String(page))
    return `${url.pathname}${url.search}`
  }
  const managePrototypesLabelIndex = data.managePrototypesLabel
    ? data.emptyLabel.indexOf(data.managePrototypesLabel)
    : -1
  const emptyState = {
    className: "repository-detail__empty",
    visual: <GitBranchIcon size={48} />,
    heading: data.emptyHeading,
    description:
      managePrototypesLabelIndex >= 0 && data.managePrototypesLabel ? (
        <>
          {data.emptyLabel.slice(0, managePrototypesLabelIndex)}
          <span className="repository-detail__manage-label">
            <GearIcon size={16} aria-hidden="true" />
            <span>{data.managePrototypesLabel}</span>
          </span>
          {data.emptyLabel.slice(managePrototypesLabelIndex + data.managePrototypesLabel.length)}
        </>
      ) : (
        data.emptyLabel
      ),
  }

  return (
    <RepositoryWorkspace data={data}>
      <div className="repository-detail">
        <PrototypeIndexHeader
          action={
            data.managePrototypesPath ? (
              <HubIconButton
                as="a"
                href={data.managePrototypesPath}
                icon={GearIcon}
                variant="invisible"
                size="small"
                loading={managingPrototypes}
                aria-label={data.managePrototypesLabel ?? ""}
                description={data.managePrototypesLabel}
              />
            ) : null
          }
          clearSearchLabel={data.clearSearchLabel}
          heading={data.prototypesHeading}
          onSearchChange={controls.onQueryChange}
          onSearchSubmit={controls.onQuerySubmit}
          searchLabel={data.searchLabel}
          searchQuery={controls.query}
          searchMaxLength={200}
          tools={
            <div className="repository-detail__toolbar" data-view={view}>
              <Text size="100" className="repository-detail__count" aria-live="polite">
                {data.prototypesCountLabel}
                {data.listing.matchingCount > data.prototypes.length
                  ? ` (${data.listing.copy.shown})`
                  : ""}
              </Text>

              <PrototypeAuthorFilter
                key={data.listing.authorsPath}
                listing={data.listing}
                onChange={controls.onAuthorChange}
                onSearch={controls.loadAuthors}
              />
            </div>
          }
          trailingTools={
            <PrototypeViewModeControl
              ariaLabel={data.viewLabel}
              galleryLabel={data.galleryViewLabel}
              listLabel={data.listViewLabel}
              onChange={setView}
              value={view}
            />
          }
        />

        <div
          className="repository-detail__body"
          aria-busy={controls.pending}
          role="region"
          aria-label={data.prototypesHeading}
          tabIndex={-1}
          data-prototype-results
        >
          {controls.pending ? <Text role="status">{data.listing.copy.updating}</Text> : null}
          {controls.error ? (
            <HubAlert
              title={data.listing.copy.resultsFailed}
              variant="critical"
              action={
                <Button variant="secondary" size="small" onClick={controls.onRetry}>
                  {data.listing.copy.retry}
                </Button>
              }
            />
          ) : null}
          {data.alert ? <HubAlert title={data.alert} variant="critical" layout="compact" /> : null}
          {data.notice ? <HubAlert title={data.notice} variant="info" layout="compact" /> : null}

          {data.candidateCheckFailed ? (
            <HubAlert title={data.candidateCheckFailed} variant="warning" />
          ) : null}

          {data.recentBranches?.length ? (
            <div className="repository-detail__recent-branches">
              {data.recentBranches.map((branch) => (
                <HubAlert
                  key={branch.id}
                  title={branch.title}
                  variant="info"
                  action={
                    <div className="repository-detail__branch-actions">
                      <form action={branch.dismissalPath} method="post">
                        <input
                          type="hidden"
                          name="authenticity_token"
                          value={data.authenticityToken}
                        />

                        <Button type="submit" variant="subtle" size="small">
                          {data.declineBranchLabel}
                        </Button>
                      </form>

                      <form action={branch.registrationPath} method="post">
                        <input
                          type="hidden"
                          name="authenticity_token"
                          value={data.authenticityToken}
                        />
                        <input type="hidden" name="_method" value="patch" />
                        <input type="hidden" name="intent" value="register_only" />
                        <input type="hidden" name="return_to" value="repository" />
                        <input type="hidden" name="prototype[name]" value={branch.branchName} />

                        <Button type="submit" variant="secondary" size="small">
                          {data.addToHubLabel}
                        </Button>
                      </form>
                    </div>
                  }
                />
              ))}
            </div>
          ) : null}

          {data.workflowInstallation ? (
            <WorkflowInstallation
              authenticityToken={data.authenticityToken}
              data={data.workflowInstallation}
            />
          ) : null}

          {filtered && visiblePrototypes.length === 0 ? (
            <HubEmptyState
              visual={<SearchIcon size={24} />}
              heading={data.noSearchResultsHeading}
              description={data.noSearchResultsDescription}
            />
          ) : data.prototypes.length === 0 ? (
            data.newPrototypePath ? (
              <HubEmptyState
                {...emptyState}
                actionLabel={data.buildPrototypeLabel}
                actionHref={data.newPrototypePath}
              />
            ) : (
              <HubEmptyState {...emptyState} />
            )
          ) : view === "gallery" ? (
            <div className="repository-detail__prototypes" data-view={view}>
              {visiblePrototypes.map((prototype) => (
                <PrototypeCard
                  key={prototype.id}
                  prototype={prototype}
                  passingLabel={data.passingLabel}
                  notPassingLabel={data.notPassingLabel}
                  noBuildLabel={data.noBuildLabel}
                />
              ))}
            </div>
          ) : (
            <table className="repository-detail__list">
              <thead>
                <tr>
                  <th scope="col">{data.prototypeColumnLabel}</th>
                  <th scope="col">{data.ownerColumnLabel}</th>
                  <th scope="col">{data.buildColumnLabel}</th>
                </tr>
              </thead>
              <tbody>
                {visiblePrototypes.map((prototype) => (
                  <PrototypeCard
                    key={prototype.id}
                    layout="list"
                    prototype={prototype}
                    passingLabel={data.passingLabel}
                    notPassingLabel={data.notPassingLabel}
                    noBuildLabel={data.noBuildLabel}
                  />
                ))}
              </tbody>
            </table>
          )}

          {data.listing.pageCount > 1 ? (
            <Pagination
              className="repository-detail__pagination"
              aria-label={data.listing.copy.pagination}
              pageCount={data.listing.pageCount}
              currentPage={data.listing.page}
              hrefBuilder={pageHref}
              labels={{
                prev: data.listing.copy.previous,
                prevAriaLabel: data.listing.copy.previous,
                next: data.listing.copy.next,
                nextAriaLabel: data.listing.copy.next,
              }}
              onPageChange={(event, page) => {
                if (
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  controls.onNavigate(pageHref(page))
                }
              }}
            />
          ) : null}
        </div>
      </div>
    </RepositoryWorkspace>
  )
}
