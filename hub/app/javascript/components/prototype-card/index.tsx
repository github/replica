import { ArrowUpRightIcon, GitBranchIcon } from "@primer/octicons-react"
import { Label } from "@primer/react-brand/esm"

import { BuildStateLabel } from "@components/build-state-label"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { ScrollingScreenshot } from "@components/scrolling-screenshot"

import type { PrototypeCardData } from "./types"

import "./styles.css"

/** Shows one prototype branch and its latest reviewable Build. */
export function PrototypeCard({
  layout = "gallery",
  prototype,
  passingLabel,
  notPassingLabel,
  noBuildLabel,
}: {
  layout?: "gallery" | "list"
  prototype: PrototypeCardData
  passingLabel: string
  notPassingLabel: string
  noBuildLabel: string
}) {
  const avatar = (
    <HubUserAvatar src={prototype.author.avatarUrl} size={layout === "gallery" ? 28 : 24} />
  )
  const preview = (
    <div className="prototype-card__preview">
      {prototype.reviewBuild ? (
        <ScrollingScreenshot
          src={prototype.reviewBuild.screenshotSrc}
          darkSrc={prototype.reviewBuild.darkScreenshotSrc}
          alt={prototype.reviewBuild.screenshotAlt}
        />
      ) : (
        <span className="prototype-card__fallback">
          <GitBranchIcon size={32} />
          <span>{prototype.previewFallbackLabel}</span>
        </span>
      )}
    </div>
  )
  const title = (
    <a href={prototype.path} data-sg-visit="true" className="prototype-card__review-link">
      {prototype.name}
    </a>
  )

  if (layout === "list") {
    const latestBuild = prototype.latestBuild
    const state = latestBuild?.state
    const buildStatus =
      state === "successful" || state === "failed" ? (
        <Label
          color={state === "successful" ? "green" : "red"}
          size="small"
          className="prototype-card__build-label"
        >
          {state === "successful" ? passingLabel : notPassingLabel}
        </Label>
      ) : latestBuild ? (
        <BuildStateLabel state={latestBuild.state} label={latestBuild.stateLabel} />
      ) : (
        <span className="prototype-card__no-build">{noBuildLabel}</span>
      )

    return (
      <tr className="prototype-card prototype-card--list">
        <td>
          <div className="prototype-card__list-identity">
            {preview}
            <span className="prototype-card__list-title">{title}</span>
          </div>
        </td>
        <td>
          {prototype.author.url ? (
            <a href={prototype.author.url} className="prototype-card__list-owner">
              {avatar}
              <span className="prototype-card__list-owner-name">{prototype.author.ownerLabel}</span>
            </a>
          ) : (
            <span className="prototype-card__list-owner">
              {avatar}
              {prototype.author.ownerLabel}
            </span>
          )}
        </td>
        <td>{buildStatus}</td>
      </tr>
    )
  }

  return (
    <section className="prototype-card" data-layout="gallery">
      {preview}

      <div className="prototype-card__footer">
        {prototype.author.url ? (
          <a
            href={prototype.author.url}
            className="prototype-card__author-avatar-link"
            aria-label={prototype.author.label}
          >
            {avatar}
          </a>
        ) : (
          avatar
        )}

        <div className="prototype-card__metadata">
          <h2 className="prototype-card__branch-name">{title}</h2>

          {prototype.author.url ? (
            <a
              href={prototype.author.url}
              className="prototype-card__author-link"
              aria-label={prototype.author.label}
            >
              {prototype.author.label}
            </a>
          ) : (
            <span className="prototype-card__author">{prototype.author.label}</span>
          )}
        </div>

        <ArrowUpRightIcon className="prototype-card__arrow" size={16} aria-hidden="true" />
      </div>
    </section>
  )
}
