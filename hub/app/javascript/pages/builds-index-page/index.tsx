import { GitCommitIcon } from "@primer/octicons-react"
import { InlineLink, Stack, Text } from "@primer/react-brand/esm"

import { BuildStateLabel } from "@components/build-state-label"
import { HubActivityTimeline } from "@components/hub-activity-timeline"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { HubEmptyState } from "@components/hub-empty-state"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { CopyBuildLinkButton } from "@features/copy-build-link-button"
import { PrototypeWorkspace } from "@features/prototype-workspace"
import { withControlQuery } from "@utils/prototype-controls-url/with-control-query"
import { withViewMode } from "@utils/prototype-controls-url/with-view-mode"
import { prototypeShareLink } from "@utils/prototype-share-link"

import type { BuildsIndexPageData } from "./types"

import "./styles.css"

/** Lists every Build recorded for one prototype branch. */
export function BuildsIndexPage({
  data,
  controlQuery = "",
  fullScreenPreview = true,
  preferenceError = "",
}: {
  data: BuildsIndexPageData
  controlQuery?: string
  fullScreenPreview?: boolean
  preferenceError?: string
}) {
  function controlPath(path: string) {
    const url = new URL(withControlQuery(path, controlQuery))
    return `${url.pathname}${url.search}${url.hash}`
  }

  return (
    <PrototypeWorkspace data={data}>
      <Stack gap="normal">
        <HubContentPageHeader title={data.buildsHeading} />
        {preferenceError ? <p role="alert">{preferenceError}</p> : null}

        {data.builds.length === 0 ? (
          <HubEmptyState visual={<GitCommitIcon size={24} />} description={data.emptyLabel} />
        ) : (
          <HubActivityTimeline
            className="build-history__timeline"
            aria-label={data.buildsHeading}
            items={data.builds.map((build) => ({
              id: String(build.number),
              dateTime: build.createdAt,
              label: (
                <span className="build-history__entry">
                  <span className="build-history__heading">
                    <InlineLink
                      href={build.path}
                      data-sg-visit="true"
                      className="build-history__build-link"
                    >
                      {build.numberLabel}
                    </InlineLink>

                    {build.state === "successful" ? (
                      <CopyBuildLinkButton
                        url={withViewMode(
                          withControlQuery(
                            prototypeShareLink(data.branchPath, build.number),
                            controlQuery,
                          ),
                          fullScreenPreview,
                        )}
                        buildNumber={build.number}
                      />
                    ) : null}
                  </span>

                  <span className="build-history__meta">
                    <Text size="100" title={build.commitSha}>
                      {build.commitLabel}
                    </Text>

                    <BuildStateLabel
                      state={build.state}
                      label={build.stateLabel}
                      appearance="soft"
                    />

                    {build.author.url ? (
                      <InlineLink href={build.author.url} className="build-history__author">
                        <HubUserAvatar src={build.author.avatarUrl} size={32} />

                        {build.author.label}
                      </InlineLink>
                    ) : (
                      <Text size="100" className="build-history__author build-history__state">
                        <HubUserAvatar src={build.author.avatarUrl} size={32} />
                        {build.author.label}
                      </Text>
                    )}

                    <Text size="100">{build.createdLabel}</Text>
                  </span>
                </span>
              ),
            }))}
          />
        )}

        {data.newestPagePath || data.nextPagePath ? (
          <Stack
            direction="horizontal"
            alignItems="center"
            justifyContent="space-between"
            gap="normal"
          >
            {data.newestPagePath ? (
              <InlineLink href={controlPath(data.newestPagePath)} data-sg-visit="true">
                {data.newestPageLabel}
              </InlineLink>
            ) : (
              <span />
            )}

            {data.nextPagePath ? (
              <InlineLink href={controlPath(data.nextPagePath)} data-sg-visit="true">
                {data.nextPageLabel}
              </InlineLink>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </PrototypeWorkspace>
  )
}
