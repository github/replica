import { PencilIcon, SyncIcon } from "@primer/octicons-react"
import { Button, TextInput } from "@primer/react-brand"
import { useEffect, useId, useRef, useState, type RefObject } from "react"

import { HubIconButton } from "@components/hub-icon-button"

import { CanvasDialog } from "../prototype-canvas-dialog"
import { copy } from "@utils/prototype-canvas/en"
import { HubApproval } from "../prototype-hub-approval"
import type { HubStatus } from "@utils/prototype-canvas/types"

import "./styles.css"

type Props = {
  status: HubStatus | null
  pairing?: HubStatus["pairing"] | null
  connecting: boolean
  error: string
  onConnect: (origin?: string) => Promise<void>
  onSelectHub: (origin: string) => Promise<void>
  onResetHub?: () => Promise<string>
  onClose: () => void
  hubButtonRef: RefObject<HTMLButtonElement | null>
}

export function HubConnectionDialog({
  status,
  pairing,
  connecting,
  error,
  onConnect,
  onSelectHub,
  onResetHub,
  onClose,
  hubButtonRef,
}: Props) {
  const originId = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const [explicitEditing, setExplicitEditing] = useState(false)
  const [initialSubmitted, setInitialSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [saveError, setSaveError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const editing = explicitEditing || !status?.hubOrigin || (draft !== null && !initialSubmitted)
  const previousEditing = useRef(editing)
  const origin = draft ?? status?.hubOrigin ?? ""
  const busy = connecting || saving || resetting
  const approvalPending = Boolean(pairing) || connecting

  useEffect(() => {
    if (editing && !approvalPending) inputRef.current?.focus()
    else if (previousEditing.current && !approvalPending) editButtonRef.current?.focus()
    previousEditing.current = editing
  }, [editing, approvalPending])

  useEffect(() => {
    if (explicitEditing || draft === null || !initialSubmitted || !status?.hubOrigin) return
    const timeout = window.setTimeout(() => setDraft(null), 0)
    return () => window.clearTimeout(timeout)
  }, [draft, explicitEditing, initialSubmitted, status?.hubOrigin])

  async function save() {
    if (busy) return
    setSaving(true)
    setSaveError("")
    try {
      await onSelectHub(origin)
      setDraft(null)
      setExplicitEditing(false)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (busy || !onResetHub) return
    setResetting(true)
    setSaveError("")
    try {
      setDraft(await onResetHub())
      setExplicitEditing(Boolean(status?.hubOrigin))
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setResetting(false)
    }
  }

  return (
    <CanvasDialog
      title={copy.connectToHub}
      closeLabel={copy.closeConnectionDialog}
      onClose={onClose}
      returnFocusRef={hubButtonRef}
    >
      <p>{copy.connectionDescription}</p>
      {saveError || error ? <p role="alert">{saveError || error}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (busy) return
          if (!approvalPending && editing && (explicitEditing || status?.hubOrigin)) void save()
          else {
            setSaveError("")
            if (!status?.hubOrigin) setInitialSubmitted(true)
            void onConnect(status?.hubOrigin ? undefined : origin)
          }
        }}
      >
        {!approvalPending &&
          (editing ? (
            <div className="hub-connection-origin-field">
              <label htmlFor={originId}>{copy.hubUrl}</label>
              <div className="hub-connection-origin-input">
                <TextInput
                  ref={inputRef}
                  id={originId}
                  type="url"
                  value={origin}
                  onChange={(event) => {
                    setInitialSubmitted(false)
                    setDraft(event.target.value)
                  }}
                  required
                  fullWidth
                  disabled={busy}
                  placeholder="https://hub.example.com"
                />
                {onResetHub ? (
                  <HubIconButton
                    icon={SyncIcon}
                    variant="invisible"
                    size="small"
                    aria-label={copy.resetHubUrl}
                    disabled={busy}
                    aria-busy={resetting}
                    onClick={() => void reset()}
                  />
                ) : null}
              </div>
              {explicitEditing || status?.hubOrigin ? (
                <Button type="submit" variant="subtle" size="small" disabled={busy}>
                  {copy.saveHub}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="hub-connection-origin">
              <a
                href={status?.hubOrigin && new URL(status.hubOrigin).origin}
                target="_blank"
                rel="noopener noreferrer"
              >
                {status?.hubOrigin}
              </a>
              <HubIconButton
                ref={editButtonRef}
                icon={PencilIcon}
                variant="invisible"
                size="small"
                aria-label={copy.editHubUrl}
                disabled={busy}
                onClick={() => {
                  setSaveError("")
                  setExplicitEditing(true)
                  setDraft(status?.hubOrigin ?? "")
                }}
              />
            </div>
          ))}
        {pairing ? <HubApproval key={pairing.verificationUrl} pairing={pairing} /> : null}
        {!pairing ? (
          <Button
            type="submit"
            variant="primary"
            disabled={
              busy ||
              !status?.repository ||
              (!approvalPending && editing && (explicitEditing || Boolean(status?.hubOrigin)))
            }
          >
            {connecting ? copy.connectionOpeningBrowser : copy.connectToHub}
          </Button>
        ) : null}
      </form>
    </CanvasDialog>
  )
}
