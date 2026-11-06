import { Heading, Stack, Text } from "@primer/react-brand"

import { HubContentPageHeader } from "@components/hub-content-page-header"
import type { ShareLinksContentProps } from "./types"

import "./styles.css"

export function ShareLinksContent({
  labels,
  headingRef,
  headingTrailing,
  feedback,
  form,
  formUnavailable,
  links,
  hasLinks,
  showEmpty = true,
  listRef,
  listBusy,
  beforeLinks,
  afterLinks,
}: ShareLinksContentProps) {
  return (
    <Stack gap="normal">
      <HubContentPageHeader
        title={labels.heading}
        description={labels.description}
        headingRef={headingRef}
        trailing={headingTrailing}
      />
      {feedback}
      {form ||
        (formUnavailable !== undefined ? (
          formUnavailable
        ) : (
          <section className="share-links__empty">
            <Heading as="h2" size="5">
              {labels.noBuildHeading}
            </Heading>
            <Text as="p" className="share-links__empty-description">
              {labels.noBuildLabel}
            </Text>
          </section>
        ))}
      {beforeLinks}
      {hasLinks ? (
        <ul className="share-links__list" ref={listRef} aria-busy={listBusy}>
          {links}
        </ul>
      ) : showEmpty ? (
        <section className="share-links__empty">
          <Heading as="h2" size="5">
            {labels.emptyHeading}
          </Heading>
          <Text as="p" className="share-links__empty-description">
            {labels.emptyLabel}
          </Text>
        </section>
      ) : null}
      {afterLinks}
    </Stack>
  )
}
