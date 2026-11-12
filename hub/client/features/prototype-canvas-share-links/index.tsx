import { LinkExternalIcon, TrashIcon, XIcon } from "@primer/octicons-react"
import { Button, Heading, Tooltip } from "@primer/react-brand"
import { useEffect, useRef, useState, type RefObject } from "react"

import { CopyableTextInput } from "@components/copyable-text-input"
import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { PrototypeWorkspaceBody } from "@features/prototype-workspace-body"
import { ShareLinksContent } from "@features/share-links-content"
import { ShareLinkRow } from "@features/share-link-row"
import { ShareLinksForm } from "@features/share-links-form"
import { ShareControlSettings } from "./share-control-settings"
import { shareCopy } from "@hooks/use-canvas-share-links/en"
import type { SharingState } from "@hooks/use-canvas-share-links/types"
import { withControlQuery } from "@utils/prototype-controls-url/with-control-query"

import "./styles.css"

type Props = {
  state: SharingState
  buildDetails?: Record<number, { commitSha: string; author: string; publishedAt: string }>
  currentCommit?: string
  hasLocalChanges?: boolean
  shareButtonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onConnect?: () => void
  onRefresh: () => void
  onCreate: (label: string, expiration: string) => Promise<boolean>
  onDelete: (id: number) => Promise<boolean>
  onOpen: (id: number, controlsQuery?: string) => void
  onAuthorize?: () => void
  controlSettings?: {
    included: boolean
    onChange: (included: boolean) => void
    query?: string
    error?: string
    blocked?: boolean
    pending?: boolean
  }
}

export function ShareLinksPage({
  state,
  buildDetails,
  currentCommit,
  hasLocalChanges = false,
  shareButtonRef,
  onClose,
  onConnect,
  onRefresh,
  onCreate,
  onDelete,
  onOpen,
  controlSettings,
  onAuthorize,
}: Props) {
  const [label, setLabel] = useState("")
  const [expiration, setExpiration] = useState("seven_days")
  const [validation, setValidation] = useState("")
  const [now, setNow] = useState(Date.now)
  const listRef = useRef<HTMLUListElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusAfterDelete = useRef<number[] | null>(null)
  const prototype = state.context?.prototype
  const expirationOptions = shareCopy.expirations.filter(
    (option) =>
      !prototype?.shareLinkExpirationOptions ||
      prototype.shareLinkExpirationOptions.includes(option.value),
  )
  const selectedExpiration = expirationOptions.some((option) => option.value === expiration)
    ? expiration
    : (expirationOptions.find((option) => option.value === "seven_days")?.value ??
      expirationOptions[0]?.value ??
      "")
  const build = prototype?.published ? prototype.build : null
  const candidateUrl = build?.url
  const internalDestination =
    candidateUrl && URL.canParse(candidateUrl) ? new URL(candidateUrl) : null
  const internalUrl =
    internalDestination &&
    internalDestination.origin === state.context?.hubOrigin &&
    ["http:", "https:"].includes(internalDestination.protocol) &&
    !internalDestination.username &&
    !internalDestination.password
      ? candidateUrl
      : null
  const publishedVersionDiffers =
    Boolean(build && currentCommit && currentCommit !== build.commitSha) || hasLocalChanges
  const canManage = prototype?.canManageShareLinks === true
  const sharingEnabled = !state.sharingDisabled && prototype?.publicSharingEnabled !== false
  const disabled = state.busy || state.loading || state.stale || !canManage || !sharingEnabled
  const controlsQuery = controlSettings?.included ? (controlSettings.query ?? "") : ""
  const controlsBlocked = Boolean(controlSettings?.blocked)
  function sharedUrl(url: string) {
    return withControlQuery(url, controlsQuery)
  }
  const recoveryLink =
    sharingEnabled &&
    state.stale &&
    !state.loading &&
    state.created &&
    !state.links.some((link) => link.id === state.created?.id)
      ? state.created
      : null

  useEffect(() => {
    const trigger = shareButtonRef.current
    headingRef.current?.focus()
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => {
      window.clearInterval(timer)
      trigger?.focus()
    }
  }, [shareButtonRef])

  useEffect(() => {
    if (state.busy || !focusAfterDelete.current) return
    const ids = focusAfterDelete.current
    focusAfterDelete.current = null
    const next = ids
      .map((id) =>
        listRef.current?.querySelector<HTMLButtonElement>(`[data-share-id="${id}"] button`),
      )
      .find((button) => button && !button.disabled)
    ;(next || headingRef.current)?.focus()
  }, [state.busy, state.links])

  async function remove(id: number, rowLabel: string) {
    if (!window.confirm(shareCopy.deletePrompt(rowLabel))) return
    const index = state.links.findIndex((link) => link.id === id)
    const neighbors = [
      ...state.links.slice(index + 1),
      ...state.links.slice(0, index).reverse(),
    ].map((link) => link.id)
    if (await onDelete(id)) {
      focusAfterDelete.current = neighbors
      const next = neighbors
        .map((number) =>
          listRef.current?.querySelector<HTMLButtonElement>(`[data-share-id="${number}"] button`),
        )
        .find((button) => button && !button.disabled)
      ;(next || headingRef.current)?.focus()
    }
  }

  function date(value: string) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    )
  }

  return (
    <main className="canvas-share-page" aria-label={shareCopy.title}>
      <PrototypeWorkspaceBody>
        <ShareLinksContent
          labels={{
            heading: shareCopy.title,
            noBuildHeading: shareCopy.noBuildHeading,
            noBuildLabel: shareCopy.noBuild,
            emptyHeading: shareCopy.emptyHeading,
            emptyLabel: shareCopy.empty,
          }}
          headingRef={headingRef}
          headingTrailing={
            <div className="canvas-share-close">
              <HubIconButton
                icon={XIcon}
                variant="invisible"
                aria-label={shareCopy.back}
                description={shareCopy.back}
                onClick={onClose}
              />
            </div>
          }
          feedback={
            <>
              {controlSettings ? (
                <ShareControlSettings
                  included={controlSettings.included}
                  onChange={controlSettings.onChange}
                  publishedVersionDiffers={publishedVersionDiffers}
                  disabled={state.busy || controlSettings.pending}
                  error={controlSettings.error}
                />
              ) : null}
              <section className="canvas-share-internal" aria-label={shareCopy.internal}>
                <Heading as="h2" size="6">
                  {shareCopy.internal}
                </Heading>
                <p>{shareCopy.internalDescription}</p>
                {internalUrl && !controlsBlocked ? (
                  <div className="share-link-item__actions canvas-share-internal-actions">
                    <CopyableTextInput
                      value={sharedUrl(internalUrl)}
                      label={shareCopy.internal}
                      copyLabel={shareCopy.internalCopy}
                      copiedLabel={shareCopy.copied}
                      copyErrorLabel={shareCopy.copyError}
                    />
                    <HubIconButton
                      as="a"
                      href={sharedUrl(internalUrl)}
                      target="_blank"
                      rel="noopener"
                      icon={LinkExternalIcon}
                      aria-label={shareCopy.internalOpen}
                      description={shareCopy.internalOpen}
                    />
                  </div>
                ) : !internalUrl ? (
                  <p role="status">{shareCopy.internalUnavailable}</p>
                ) : null}
              </section>
              <div className="canvas-share-public-header">
                <Heading as="h2" size="6">
                  {shareCopy.public}
                </Heading>
                <p>{shareCopy.warning}</p>
              </div>
              {prototype && !canManage ? (
                <p role="status">
                  {prototype.canManageShareLinks === false
                    ? shareCopy.denied
                    : shareCopy.permissionUnknown}
                </p>
              ) : null}
              {!sharingEnabled ? <p role="status">{shareCopy.disabled}</p> : null}
              {state.error ? (
                <HubAlert title={state.error} variant="critical" layout="compact" />
              ) : null}
              {state.authorization && onAuthorize ? (
                <Button
                  variant="secondary"
                  size="small"
                  onClick={onAuthorize}
                  disabled={state.busy}
                >
                  {shareCopy.authorize}
                </Button>
              ) : null}
              {onConnect && !state.context ? (
                <Button variant="secondary" size="small" onClick={onConnect}>
                  {shareCopy.connect}
                </Button>
              ) : null}
            </>
          }
          form={
            build && canManage && sharingEnabled ? (
              <ShareLinksForm
                data={{
                  buildLabel: null,
                  labelLabel: shareCopy.label,
                  labelPlaceholder: shareCopy.labelPlaceholder,
                  labelMaximumBytes: 100,
                  expirationLabel: shareCopy.expiry,
                  expirationOptions,
                  submitLabel: state.busy ? shareCopy.creating : shareCopy.create,
                }}
                label={label}
                onLabelChange={(event) => {
                  setLabel(event.target.value)
                  setValidation("")
                }}
                expiration={selectedExpiration}
                onExpirationChange={(event) => setExpiration(event.target.value)}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!label.trim() || new TextEncoder().encode(label.trim()).length > 100) {
                    setValidation(shareCopy.labelInvalid)
                    return
                  }
                  setValidation("")
                  void onCreate(label, selectedExpiration)
                }}
                disabled={disabled}
                fieldsDisabled={state.busy}
                busy={state.busy}
                error={validation}
                details={
                  <div className="canvas-share-build-details">
                    <p>
                      {shareCopy.target} <strong>{shareCopy.build(build.number)}</strong>
                      {" - "}
                      <code>{build.commitSha.slice(0, 7)}</code>
                      {" - "}
                      <time dateTime={build.publishedAt}>{date(build.publishedAt)}</time>
                    </p>
                    {publishedVersionDiffers ? <p>{shareCopy.oldBuild}</p> : null}
                  </div>
                }
              />
            ) : null
          }
          formUnavailable={canManage && sharingEnabled && !build ? undefined : null}
          beforeLinks={
            <>
              {state.notice ? <p role="status">{state.notice}</p> : null}
              {recoveryLink && !controlsBlocked ? (
                <CopyableTextInput
                  value={sharedUrl(recoveryLink.url)}
                  label={recoveryLink.label}
                  copyLabel={shareCopy.copy(recoveryLink.label, recoveryLink.buildNumber)}
                  copiedLabel={shareCopy.copied}
                  copyErrorLabel={shareCopy.copyError}
                />
              ) : null}
              {state.loading ? <p role="status">{shareCopy.loading}</p> : null}
            </>
          }
          hasLinks={canManage && sharingEnabled && !controlsBlocked && state.links.length > 0}
          showEmpty={
            canManage && sharingEnabled && !controlsBlocked && !state.loading && !state.stale
          }
          listRef={listRef}
          listBusy={state.loading}
          links={(!canManage || !sharingEnabled || controlsBlocked ? [] : state.links).map(
            (link) => {
              const expired = link.expiresAt !== null && Date.parse(link.expiresAt) <= now
              const details = buildDetails?.[link.buildNumber]
              return (
                <ShareLinkRow
                  key={link.id}
                  className={
                    build && link.buildNumber < build.number
                      ? "canvas-share-link--older-build"
                      : undefined
                  }
                  shareLink={{
                    ...link,
                    url: sharedUrl(link.url),
                    buildLabel: details ? (
                      <Tooltip
                        text={shareCopy.buildDetails(
                          details.commitSha.slice(0, 7),
                          details.author,
                          date(details.publishedAt),
                        )}
                        type="description"
                        className="canvas-share-build-tooltip"
                      >
                        <button type="button" className="canvas-share-build-reference">
                          <strong>{shareCopy.build(link.buildNumber)}</strong>
                        </button>
                      </Tooltip>
                    ) : (
                      <strong>{shareCopy.build(link.buildNumber)}</strong>
                    ),
                    createdLabel:
                      link.createdBy && link.createdAt
                        ? shareCopy.createdBy(link.createdBy.login, date(link.createdAt))
                        : undefined,
                    expiresLabel: link.expiresAt
                      ? shareCopy.expires(date(link.expiresAt))
                      : shareCopy.never,
                  }}
                  copyLabel={shareCopy.copy(link.label, link.buildNumber)}
                  copiedLabel={shareCopy.copied}
                  copyErrorLabel={shareCopy.copyError}
                  urlLabel={`${link.label}, Build #${link.buildNumber} URL`}
                  unavailableLabel={expired ? shareCopy.expired : undefined}
                >
                  <HubIconButton
                    icon={LinkExternalIcon}
                    aria-label={shareCopy.open(link.label, link.buildNumber)}
                    description={shareCopy.open(link.label, link.buildNumber)}
                    disabled={disabled || expired}
                    onClick={() =>
                      controlsQuery ? onOpen(link.id, controlsQuery) : onOpen(link.id)
                    }
                  />
                  <HubIconButton
                    icon={TrashIcon}
                    variant="danger"
                    aria-label={shareCopy.delete(link.label, link.buildNumber)}
                    description={shareCopy.delete(link.label, link.buildNumber)}
                    disabled={disabled || expired}
                    onClick={() => void remove(link.id, link.label)}
                  />
                </ShareLinkRow>
              )
            },
          )}
          afterLinks={
            <div className="canvas-share-list-actions">
              {canManage || (!state.context && !onConnect) ? (
                <Button
                  size="small"
                  variant="subtle"
                  onClick={onRefresh}
                  disabled={state.busy || state.loading}
                >
                  {shareCopy.refresh}
                </Button>
              ) : null}
            </div>
          }
        />
      </PrototypeWorkspaceBody>
    </main>
  )
}
