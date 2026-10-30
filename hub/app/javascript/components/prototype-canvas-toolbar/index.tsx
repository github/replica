import {
  CheckCircleIcon,
  KebabHorizontalIcon,
  LinkIcon,
  PencilIcon,
  SparkleIcon,
  SyncIcon,
  UploadIcon,
} from "@primer/octicons-react"
import { ActionMenu, Button, Tooltip } from "@primer/react-brand/esm"
import type { ComponentProps, Ref, RefObject } from "react"

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
  improvementControlsRef?: Ref<HTMLDivElement>
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
  improvingContext?: boolean
  feedbackMessage?: { message: string }
}

export function Toolbar({
  toolbarRef,
  improvementControlsRef,
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
  improvingContext = false,
  feedbackMessage,
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
      {config.pickAndPolish ? (
        <div ref={improvementControlsRef} id="canvas-improvement-controls" />
      ) : null}
      {onControls ? (
        <ControlsToggle buttonRef={controlsButtonRef} open={controlsOpen} onToggle={onControls} />
      ) : null}

      {onHub ? (
        <Button
          type="button"
          ref={hubButtonRef}
          size="small"
          variant="secondary"
          className="canvas-toolbar-compact-button"
          leadingVisual={<PencilIcon size={16} />}
          aria-label={copy.editDetails}
          title={copy.editDetails}
          aria-expanded={hubOpen}
          onClick={onHub}
        >
          <span className="canvas-toolbar-button-label">{copy.editDetails}</span>
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
        <ActionMenu
          size="small"
          selectionVariant="none"
          menuAlignment="end"
          disabled={improvingContext}
        >
          <ActionMenu.IconButton
            icon={KebabHorizontalIcon}
            variant="secondary"
            aria-label={copy.moreActions}
            aria-busy={improvingContext}
          />
          <ActionMenu.Overlay aria-label={copy.moreActions}>
            <ImproveContextAction
              className="canvas-more-action"
              leadingVisual={<SparkleIcon size={16} />}
              onClick={onImproveContext}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  onImproveContext()
                }
                if (event.key === " ") {
                  event.preventDefault()
                  event.currentTarget.click()
                }
              }}
            >
              {copy.improveContext}
            </ImproveContextAction>
          </ActionMenu.Overlay>
        </ActionMenu>
      ) : null}
      {feedbackMessage ? (
        <p className="canvas-feedback-message" role="alert">
          {feedbackMessage.message}
        </p>
      ) : null}
    </header>
  )
}

function ImproveContextAction(props: ComponentProps<typeof ActionMenu.Item>) {
  return (
    <Tooltip text={copy.improveContextDescription} type="description" direction="w">
      <ActionMenu.Item {...props} />
    </Tooltip>
  )
}

function publishIcon(state: PublishState) {
  if (state === "published") return <CheckCircleIcon size={16} />
  if (state === "failed" || state === "in_progress" || state === "requested")
    return <SyncIcon size={16} />
  return <UploadIcon size={16} />
}
