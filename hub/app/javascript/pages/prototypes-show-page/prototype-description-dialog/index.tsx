import { GitBranchIcon, PencilIcon, XIcon } from "@primer/octicons-react"
import {
  Button,
  ButtonGroup,
  EyebrowText,
  FormControl,
  Heading,
  Text,
  Textarea,
  TextInput,
} from "@primer/react-brand"
import { useEffect, useId, useRef } from "react"
import type { KeyboardEvent } from "react"

import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { HubUserAvatar } from "@components/hub-user-avatar"

import type { PrototypesShowPageData } from "../types"

import "./styles.css"

export function PrototypeDescriptionDialog({
  data,
  onBranch,
  onClose,
  editing,
  onEditingChange,
}: {
  data: PrototypesShowPageData
  onBranch: () => void
  onClose: () => void
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const headingId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const wasEditing = useRef(false)
  const hasDescription = Boolean(data.prototypeDescription?.trim())
  const editButton =
    data.detailsEditPath && data.editDetailsLabel ? (
      <HubIconButton
        icon={PencilIcon}
        size="small"
        variant="invisible"
        className="prototype-description-dialog__edit"
        aria-label={data.editDetailsLabel}
        description={data.editDetailsLabel}
        onClick={() => onEditingChange(true)}
      />
    ) : null

  useEffect(() => {
    const previouslyFocused = document.activeElement
    close.current?.focus()
    return () => {
      if (document.activeElement === document.body && previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (editing) nameInput.current?.focus()
    else if (wasEditing.current) {
      dialog.current
        ?.querySelector<HTMLButtonElement>(".prototype-description-dialog__edit")
        ?.focus()
    }
    wasEditing.current = editing
  }, [editing])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      if (editing) onEditingChange(false)
      else onClose()
    }
    if (event.key !== "Tab") return

    const controls = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])",
    )
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="prototype-description-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={!editing && hasDescription ? descriptionId : undefined}
        className="prototype-description-dialog"
        onKeyDown={handleKeyDown}
      >
        <header className="prototype-description-dialog__header">
          <Heading as="h2" size="6" id={headingId} className="prototype-description-dialog__title">
            {editing ? data.editDetailsHeading : data.prototypeName}
          </Heading>
          <Button
            ref={close}
            type="button"
            variant="subtle"
            className="prototype-description-dialog__close"
            aria-label={data.closeInfoLabel}
            leadingVisual={<XIcon />}
            onClick={onClose}
          />
        </header>

        {data.alert ? <HubAlert variant="critical" layout="compact" title={data.alert} /> : null}

        {editing && data.detailsEditPath ? (
          <form
            id="prototype-description-edit"
            action={data.detailsEditPath}
            method="post"
            className="prototype-description-dialog__form"
          >
            <input type="hidden" name="_method" value="patch" />
            <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
            <input type="hidden" name="return_to" value="review" />
            {data.buildPinned && data.selectedBuild ? (
              <input type="hidden" name="build" value={data.selectedBuild.number} />
            ) : null}

            <FormControl id="prototype-description-name" fullWidth required>
              <FormControl.Label>{data.nameLabel}</FormControl.Label>
              <TextInput
                ref={nameInput}
                name="prototype[name]"
                defaultValue={data.prototypeName}
                maxLength={data.nameMaximumLength}
                required
                fullWidth
              />
            </FormControl>

            <FormControl id="prototype-description-text" fullWidth>
              <FormControl.Label>{data.descriptionLabel}</FormControl.Label>
              <Textarea
                name="prototype[description]"
                defaultValue={data.prototypeDescription ?? ""}
                maxLength={data.descriptionMaximumLength}
                rows={4}
                fullWidth
                resize="vertical"
              />
            </FormControl>

            <FormControl id="prototype-description-start-page" fullWidth>
              <FormControl.Label>{data.startPageLabel}</FormControl.Label>
              <TextInput
                name="prototype[start_page]"
                defaultValue={data.startPage ?? ""}
                placeholder="/"
                fullWidth
              />
              <FormControl.Hint>{data.startPageHint}</FormControl.Hint>
            </FormControl>
          </form>
        ) : (
          <>
            <div className="prototype-description-dialog__author">
              <HubUserAvatar src={data.author.avatarUrl} />
              <Text as="p" size="100" variant="muted">
                {data.author.url ? (
                  <a href={data.author.url}>{data.author.label}</a>
                ) : (
                  data.author.label
                )}
              </Text>
              {!hasDescription ? editButton : null}
            </div>

            {hasDescription ? (
              <div className="prototype-description-dialog__body">
                <div className="prototype-description-dialog__description-heading">
                  <EyebrowText>{data.descriptionLabel}</EyebrowText>
                  {editButton}
                </div>
                <Text
                  as="p"
                  size="200"
                  id={descriptionId}
                  className="prototype-description-dialog__description"
                >
                  {data.prototypeDescription}
                </Text>
              </div>
            ) : null}
          </>
        )}

        <footer className="prototype-description-dialog__actions">
          {editing ? (
            <ButtonGroup>
              <Button variant="secondary" onClick={() => onEditingChange(false)}>
                {data.cancelEditLabel}
              </Button>
              <Button variant="primary" type="submit" form="prototype-description-edit">
                {data.saveDetailsLabel}
              </Button>
            </ButtonGroup>
          ) : (
            <ButtonGroup>
              {data.branchSubmissionMode === "copilot" && data.newPrototypePath ? (
                <Button variant="secondary" leadingVisual={<GitBranchIcon />} onClick={onBranch}>
                  {data.branchFromHereLabel}
                </Button>
              ) : null}
              <Button variant="primary" onClick={onClose}>
                {data.dismissInfoLabel}
              </Button>
            </ButtonGroup>
          )}
        </footer>
      </div>
    </div>
  )
}
