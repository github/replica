import {
  ClockIcon,
  GitCommitIcon,
  PackageIcon,
  PlayIcon,
  WorkflowIcon,
} from "@primer/octicons-react"
import { Button, Heading, InlineLink, Stack, Text } from "@primer/react-brand/esm"

import { HubActivityTimeline } from "@components/hub-activity-timeline"
import { HubAlert } from "@components/hub-alert"
import { HubContentPageHeader } from "@components/hub-content-page-header"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { BuildStateLabel } from "@components/build-state-label"
import { ScrollingScreenshot } from "@components/scrolling-screenshot"
import { PrototypeWorkspace } from "@features/prototype-workspace"
import type { BuildsShowPageData } from "./types"

import "./styles.css"

/** Shows the commit, state, and recorded times for one Build. */
export function BuildsShowPage({ data }: { data: BuildsShowPageData }) {
  return (
    <PrototypeWorkspace data={data}>
      <Stack gap="normal">
        <HubContentPageHeader
          title={data.heading}
          trailing={<BuildStateLabel state={data.state} label={data.stateLabel} />}
        />

        {data.failureSummary && data.failureHeading ? (
          <HubAlert
            title={data.failureHeading}
            description={data.failureSummary}
            variant="critical"
            layout="compact"
          />
        ) : null}

        <div className="build-detail__layout">
          <Stack gap="none" padding="none" className="build-detail__summary">
            <section className="build-detail__section">
              <Stack gap="condensed" padding="none">
                <Stack direction="horizontal" alignItems="center" gap="condensed" padding="none">
                  <GitCommitIcon />

                  <Heading as="h3" size="5">
                    {data.commitHeading}
                  </Heading>
                </Stack>

                <code className="build-detail__sha">{data.commitSha}</code>

                {data.commitAuthor.url ? (
                  <InlineLink href={data.commitAuthor.url} className="build-detail__author">
                    <HubUserAvatar
                      src={data.commitAuthor.avatarUrl}
                      className="build-detail__avatar"
                    />

                    {data.commitAuthor.label}
                  </InlineLink>
                ) : (
                  <Text size="100" className="build-detail__author">
                    <HubUserAvatar
                      src={data.commitAuthor.avatarUrl}
                      className="build-detail__avatar"
                    />
                    {data.commitAuthor.label}
                  </Text>
                )}
              </Stack>
            </section>

            {data.workflowUrl && data.workflowHeading && data.workflowLabel ? (
              <section className="build-detail__section">
                <Stack gap="condensed" padding="none">
                  <Stack direction="horizontal" alignItems="center" gap="condensed" padding="none">
                    <WorkflowIcon />

                    <Heading as="h3" size="5">
                      {data.workflowHeading}
                    </Heading>
                  </Stack>

                  <InlineLink href={data.workflowUrl}>{data.workflowLabel}</InlineLink>
                </Stack>
              </section>
            ) : null}

            {data.retainedSizeLabel && data.publicationHeading ? (
              <section className="build-detail__section">
                <Stack gap="condensed" padding="none">
                  <Stack direction="horizontal" alignItems="center" gap="condensed" padding="none">
                    <PackageIcon />

                    <Heading as="h3" size="5">
                      {data.publicationHeading}
                    </Heading>
                  </Stack>

                  <Text>{data.retainedSizeLabel}</Text>

                  {data.previewPath && data.previewLabel ? (
                    <div>
                      <Button
                        as="a"
                        href={data.previewPath}
                        data-sg-visit="true"
                        leadingVisual={PlayIcon}
                      >
                        {data.previewLabel}
                      </Button>
                    </div>
                  ) : null}
                </Stack>
              </section>
            ) : null}
          </Stack>

          <section className="build-detail__timeline" aria-labelledby="build-timeline-heading">
            <Stack gap="normal" padding="none">
              <Stack direction="horizontal" alignItems="center" gap="condensed" padding="none">
                <ClockIcon />

                <Heading as="h3" size="5" id="build-timeline-heading">
                  {data.timelineHeading}
                </Heading>
              </Stack>

              <HubActivityTimeline
                items={[
                  {
                    id: "created",
                    dateTime: data.createdAt,
                    label: data.createdLabel,
                  },
                  ...(data.startedAt && data.startedLabel
                    ? [
                        {
                          id: "started",
                          dateTime: data.startedAt,
                          label: data.startedLabel,
                        },
                      ]
                    : []),
                  ...(data.workflowCompletedAt && data.workflowCompletedLabel
                    ? [
                        {
                          id: "workflow-completed",
                          dateTime: data.workflowCompletedAt,
                          label: data.workflowCompletedLabel,
                        },
                      ]
                    : []),
                  ...(data.finishedAt && data.finishedLabel
                    ? [
                        {
                          id: "finished",
                          dateTime: data.finishedAt,
                          label: data.finishedLabel,
                        },
                      ]
                    : []),
                ]}
              />
            </Stack>
          </section>
        </div>

        {data.screenshotsHeading && data.desktopScreenshot && data.narrowScreenshot ? (
          <section
            className="build-detail__screenshots-section"
            aria-labelledby="build-screenshots-heading"
          >
            <Stack gap="normal" padding="none">
              <Heading as="h3" size="5" id="build-screenshots-heading">
                {data.screenshotsHeading}
              </Heading>

              <div className="build-detail__screenshots">
                {[data.desktopScreenshot, data.narrowScreenshot].map((screenshot) => (
                  <figure className="build-detail__screenshot" key={screenshot.src}>
                    <ScrollingScreenshot
                      src={screenshot.src}
                      darkSrc={screenshot.darkSrc}
                      alt={screenshot.alt}
                    />

                    <figcaption className="build-detail__screenshot-caption">
                      {screenshot.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Stack>
          </section>
        ) : null}
      </Stack>
    </PrototypeWorkspace>
  )
}
