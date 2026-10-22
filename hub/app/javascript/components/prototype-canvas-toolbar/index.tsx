import {
  CheckCircleIcon,
  KebabHorizontalIcon,
  LinkIcon,
  SparkleIcon,
  SyncIcon,
  UploadIcon,
} from "@primer/octicons-react"
import { ActionMenu, Button, Tooltip } from "@primer/react-brand"
import type { RefObject } from "react"

import { ControlsToggle } from "../prototype-controls-toggle"
import { HubIconButton } from "@components/hub-icon-button"
import { shareCopy } from "@hooks/use-canvas-share-links/en"
import { copy } from "@utils/prototype-canvas/en"
import { publicationCopy } from "@utils/resolve-prototype-publication/en"
import type { Publication } from "@utils/resolve-prototype-publication"
import type { CanvasConfig, PrototypeState, PublishState } from "@utils/prototype-canvas/types"

import "./styles.css"

type Props = {
  toolbarRef?: RefObject<HTMLElement | null>
  config: CanvasConfig
  onPublish: () => void
  publishButtonRef: RefObject<HTMLButtonElement | null>
  hubButtonRef?: RefObject<HTMLButtonElement | null>
  titleButtonRef: RefObject<HTMLButtonElement | null>
  onBuildDetails: () => void
  publishing: boolean
  state: PrototypeState | null
  prototypeName?: string
  hubOpen?: boolean
  onHub?: () => void
  publication?: Publication
  onControls?: () => void
  controlsOpen?: boolean
  controlsButtonRef?: RefObject<HTMLButtonElement | null>
  onShare?: () => void
  shareButtonRef?: RefObject<HTMLButtonElement | null>
  onImproveContext?: () => void
}

export function Toolbar({
  toolbarRef,
  config,
  onPublish,
  publishButtonRef,
  hubButtonRef,
  titleButtonRef,
  onBuildDetails,
  publishing,
  state,
  prototypeName,
  hubOpen,
  onHub,
  publication,
  onControls,
  controlsOpen,
  controlsButtonRef,
  onShare,
  shareButtonRef,
  onImproveContext,
}: Props) {
  const status = state?.publishStatus ?? {
    state: "unavailable" as const,
    detail: copy.statusUnavailable,
  }
  const displayName = prototypeName?.trim() || state?.stats.branch || state?.name || config.name
  const title = state
    ? [
        displayName,
        state.stats.repository,
        state.stats.commitSha?.slice(0, 7),
        state.stats.workingTree === "changed" ? copy.workingTreeChanged : copy.workingTreeClean,
        state.stats.urlHost,
      ]
        .filter(Boolean)
        .join(" · ")
    : displayName
  const publishDisabled =
    publishing ||
    (publication
      ? publication.action === "none"
      : status.state === "requested" ||
        status.state === "in_progress" ||
        status.state === "published")
  const publishBusy =
    publishing ||
    (publication
      ? publication.kind === "requested" ||
        publication.kind === "queued" ||
        publication.kind === "building" ||
        publication.kind === "importing" ||
        publication.kind === "awaiting_build" ||
        publication.kind === "registration"
      : status.state === "requested" || status.state === "in_progress")
  const published =
    !publishBusy && (publication ? publication.kind === "ready" : status.state === "published")
  const publishButton = (
    <Button
      type="button"
      ref={publishButtonRef}
      className="canvas-publish-button"
      variant="secondary"
      size="small"
      leadingVisual={publishBusy ? <SyncIcon size={16} /> : publishIcon(status.state)}
      disabled={publishDisabled && !published}
      aria-busy={publishBusy}
      title={published ? undefined : publication?.detail || status.detail}
      onClick={publishDisabled || published ? undefined : onPublish}
    >
      {publication?.label || copy.publishLabels[status.state]}
    </Button>
  )

  return (
    <header ref={toolbarRef} className="canvas-toolbar">
      <Button
        type="button"
        className="canvas-title"
        ref={titleButtonRef}
        variant="subtle"
        size="small"
        title={title}
        disabled={!state}
        onClick={onBuildDetails}
      >
        {displayName}
      </Button>

      <div id="canvas-review-controls" className="canvas-review-controls-slot" />
      {onControls ? (
        <ControlsToggle buttonRef={controlsButtonRef} open={controlsOpen} onToggle={onControls} />
      ) : null}

      {onHub ? (
        <Button
          type="button"
          ref={hubButtonRef}
          size="small"
          variant="secondary"
          aria-expanded={hubOpen}
          onClick={onHub}
        >
          {copy.editDetails}
        </Button>
      ) : null}
      <div className="canvas-publish-share" role="group" aria-label={shareCopy.group}>
        {published ? (
          <Tooltip
            ref={publishButtonRef}
            text={publicationCopy.alreadyPublished}
            type="description"
          >
            {publishButton}
          </Tooltip>
        ) : (
          publishButton
        )}
        {onShare ? (
          <HubIconButton
            ref={shareButtonRef}
            icon={LinkIcon}
            size="small"
            aria-label={shareCopy.title}
            description={shareCopy.title}
            onClick={onShare}
          />
        ) : null}
      </div>

      {onImproveContext ? (
        <ActionMenu size="small" selectionVariant="none" menuAlignment="end">
          <ActionMenu.IconButton
            icon={KebabHorizontalIcon}
            variant="secondary"
            aria-label={copy.moreActions}
          />
          <ActionMenu.Overlay aria-label={copy.moreActions}>
            <ActionMenu.Item
              className="canvas-more-action"
              leadingVisual={<SparkleIcon size={16} />}
              onClick={onImproveContext}
              onKeyDown={(event) => {
                if (event.key === "Enter") onImproveContext()
                if (event.key === " ") {
                  event.preventDefault()
                  event.currentTarget.click()
                }
              }}
            >
              {copy.improveContext}
            </ActionMenu.Item>
          </ActionMenu.Overlay>
        </ActionMenu>
      ) : null}
    </header>
  )
}

function publishIcon(state: PublishState) {
  if (state === "published") return <CheckCircleIcon size={16} />
  if (state === "failed" || state === "in_progress" || state === "requested")
    return <SyncIcon size={16} />
  return <UploadIcon size={16} />
}
