import { GitCommitIcon } from "@primer/octicons-react"
import { InlineLink, Stack, Text } from "@primer/react-brand/esm"

import { HubActivityTimeline } from "@components/hub-activity-timeline"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { HubEmptyState } from "@components/hub-empty-state"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { PrototypeWorkspace } from "@features/prototype-workspace"

import type { BuildsIndexPageData } from "./types"

import "./styles.css"

/** Lists every Build recorded for one prototype branch. */
export function BuildsIndexPage({ data }: { data: BuildsIndexPageData }) {
  return (
    <PrototypeWorkspace data={data}>
      <Stack gap="normal">
        <HubContentPageHeader title={data.buildsHeading} />

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
                  <InlineLink
                    href={build.path}
                    data-sg-visit="true"
                    className="build-history__build-link"
                  >
                    {build.numberLabel}
                  </InlineLink>

                  <span className="build-history__meta">
                    <Text size="100" title={build.commitSha}>
                      {build.commitLabel}
                    </Text>

                    <Text size="100" className="build-history__state">
                      {build.stateLabel}
                    </Text>

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
              <InlineLink href={data.newestPagePath} data-sg-visit="true">
                {data.newestPageLabel}
              </InlineLink>
            ) : (
              <span />
            )}

            {data.nextPagePath ? (
              <InlineLink href={data.nextPagePath} data-sg-visit="true">
                {data.nextPageLabel}
              </InlineLink>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </PrototypeWorkspace>
  )
}
