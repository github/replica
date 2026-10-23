import { ArrowUpRightIcon, BrowserIcon } from "@primer/octicons-react"

import { ScrollingScreenshot } from "@components/scrolling-screenshot"
import "@components/prototype-card/styles.css"

import type { TemplateCardData } from "./types"
import "./styles.css"

export function TemplateCard({
  template,
  openLabel,
  unavailableLabel,
}: {
  template: TemplateCardData
  openLabel: string
  unavailableLabel: string
}) {
  return (
    <section className="prototype-card template-card">
      <div className="prototype-card__preview">
        {template.screenshotSrc ? (
          <ScrollingScreenshot
            src={template.screenshotSrc}
            darkSrc={template.darkScreenshotSrc}
            alt={template.screenshotAlt ?? ""}
          />
        ) : (
          <span className="template-card__unavailable">
            <BrowserIcon size={32} />
            {unavailableLabel}
          </span>
        )}
      </div>

      <a
        className="template-card__body prototype-card__review-link template-card__link"
        href={template.path}
        aria-label={`${openLabel}: ${template.name}`}
      >
        <div className="template-card__heading">
          <h3 className="prototype-card__branch-name">{template.name}</h3>
          <ArrowUpRightIcon className="prototype-card__arrow" size={16} aria-hidden="true" />
        </div>

        <p className="template-card__description">{template.description}</p>
      </a>
    </section>
  )
}
