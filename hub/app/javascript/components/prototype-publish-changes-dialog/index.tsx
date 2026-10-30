import { Button, Checkbox, FormControl, Stack } from "@primer/react-brand/esm"
import { useId, useState, type RefObject } from "react"

import { HubAlert } from "@components/hub-alert"

import { CanvasDialog } from "../prototype-canvas-dialog"
import type { PublishMode, PublishPreparation } from "@utils/prototype-canvas/types"
import { publishChangesCopy as copy } from "@hooks/use-canvas-publish-preference/en"

import "./styles.css"

export function PublishChangesDialog({
  busy,
  error,
  changes,
  checkError,
  remembered,
  returnFocusRef,
  onClose,
  onChoose,
  onRetry,
}: {
  busy: boolean
  error: string
  changes?: PublishPreparation["changes"]
  checkError?: string
  remembered: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onChoose: (mode: PublishMode, remember: boolean) => void
  onRetry: () => void
}) {
  const [remember, setRemember] = useState(remembered)
  const descriptionId = useId()
  const checkboxId = useId()
  return (
    <CanvasDialog
      title={checkError ? copy.checkFailedTitle : copy.title}
      closeLabel={copy.close}
      descriptionId={checkError ? undefined : descriptionId}
      returnFocusRef={returnFocusRef}
      onClose={() => {
        if (!busy) onClose()
      }}
      className="publish-changes-dialog"
    >
      <Stack gap="normal" padding="none">
        {!checkError ? <p id={descriptionId}>{copy.description}</p> : null}
        {checkError ? <HubAlert title={checkError} variant="critical" layout="compact" /> : null}
        {changes?.files.total ? (
          <section aria-label={copy.changedFiles}>
            <ul className="publish-changes-dialog__files">
              {changes.files.paths.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
              {changes.files.total > changes.files.paths.length ? (
                <li>{copy.moreChanges(changes.files.total - changes.files.paths.length)}</li>
              ) : null}
            </ul>
          </section>
        ) : null}
        {!checkError ? (
          <p>
            {changes?.localSkills.total ? `${copy.localSkills(changes.localSkills.total)} ` : null}
            {copy.selection}
          </p>
        ) : null}
        {!checkError ? (
          <FormControl id={checkboxId} fullWidth>
            <Checkbox
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <FormControl.Label>{copy.remember}</FormControl.Label>
          </FormControl>
        ) : null}
        {error ? <HubAlert title={error} variant="critical" layout="compact" /> : null}
        <footer className="publish-changes-dialog__actions">
          {checkError ? (
            <Button
              variant="primary"
              size="small"
              disabled={busy}
              aria-busy={busy}
              onClick={onRetry}
            >
              {copy.retryCheck}
            </Button>
          ) : null}
          {!checkError ? (
            <Button
              variant="primary"
              size="small"
              disabled={busy}
              aria-busy={busy}
              onClick={() => onChoose("commit-changes", remember)}
            >
              {copy.commit}
            </Button>
          ) : null}
          <Button size="small" disabled={busy} onClick={() => onChoose("committed-only", false)}>
            {copy.committed}
          </Button>
        </footer>
      </Stack>
    </CanvasDialog>
  )
}
