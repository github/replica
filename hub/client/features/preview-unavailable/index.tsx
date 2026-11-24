import { GlobeIcon } from "@primer/octicons-react"

import { HubEmptyState } from "@components/hub-empty-state"

import "./styles.css"

export function PreviewUnavailable({
  heading,
  description,
  screenshot,
  narrowScreenshot,
  screenshotAlt,
  openUrl,
}: {
  heading: string
  description: string
  screenshot?: string
  narrowScreenshot?: string
  screenshotAlt?: string
  openUrl?: string
}) {
  return (
    <div className="review-shell__unavailable">
      <HubEmptyState visual={<GlobeIcon size={24} />} heading={heading} description={description} />
      {openUrl ? (
        <a href={openUrl} target="_blank" rel="noopener noreferrer">
          Open preview in a new tab
        </a>
      ) : null}
      {screenshot ? (
        <>
          <a href={screenshot} target="_blank" rel="noopener noreferrer">
            Open saved screenshot
          </a>
          <picture>
            {narrowScreenshot ? (
              <source media="(max-width: 40rem)" srcSet={narrowScreenshot} />
            ) : null}
            <img src={screenshot} alt={screenshotAlt ?? "Saved Build screenshot"} />
          </picture>
        </>
      ) : null}
    </div>
  )
}
