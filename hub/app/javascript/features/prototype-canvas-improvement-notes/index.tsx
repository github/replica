import { CrosshairsIcon } from "@primer/octicons-react"
import { Button, FormControl, Textarea } from "@primer/react-brand"
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

import { HubCounter } from "@components/hub-counter"
import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { ImprovementThreads } from "@features/prototype-canvas-improvement-threads"
import type { ReviewAnchor } from "@utils/review-anchor/types"
import { copy } from "./en"
import { improvementThreadView } from "./thread-view"
import { usePreviewSelection } from "./use-preview-selection"
import { useSavedNotes } from "./use-saved-notes"

import "./styles.css"

type Props = {
  canvas: {
    token?: string
    frameRef: RefObject<HTMLIFrameElement | null>
    toolbarTarget: HTMLDivElement | null
    prototypeUrl: string
    previewUrl?: string
    hubOpen: boolean
    active?: boolean
    selectionDisabled?: boolean
    onInteractionChange?: (blocked: boolean) => void
    onOpenNotes: () => void
    onNavigate: (url: string) => void
  }
}
type Source = { identity: string; sourceId: string }
type Selection = { identity?: string; sourceId?: string; anchor: ReviewAnchor }

export function ImprovementNotesPrototype({ canvas }: Props) {
  const saved = useSavedNotes(canvas.token)
  const notes = saved.state?.notes ?? []
  const [route, setRoute] = useState("")
  const [annotating, setAnnotating] = useState(false)
  const [capturingSource, setCapturingSource] = useState(false)
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [draft, setDraft] = useState("")
  const [discarding, setDiscarding] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [message, setMessage] = useState("")
  const [threadInteraction, setThreadInteraction] = useState(false)
  const captureGeneration = useRef(0)
  const annotateRef = useRef<HTMLButtonElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const notesToggleRef = useRef<HTMLButtonElement>(null)
  const selectionChanged = selection !== null && selection.identity !== saved.state?.identity
  const composerOpen = selection !== null && !discarding && saved.state !== null
  const notesCount = notes.filter((note) => note.status !== "resolved").length
  const syncError =
    saved.state?.syncError === "Notes are saved locally until Hub discovers this branch."
      ? null
      : saved.state?.syncError
  const active = canvas.active !== false
  const onInteractionChange = canvas.onInteractionChange

  useLayoutEffect(() => {
    onInteractionChange?.(capturingSource || annotating || selection !== null || threadInteraction)
  }, [onInteractionChange, capturingSource, annotating, selection, threadInteraction])

  const receiveSelection = useCallback(
    (anchor: ReviewAnchor) => {
      setSelection({
        identity: selectedSource?.identity ?? saved.state?.identity,
        sourceId: selectedSource?.sourceId,
        anchor,
      })
      setDraft("")
    },
    [saved.state?.identity, selectedSource],
  )
  const cancelPreviewSelection = useCallback(() => {
    captureGeneration.current++
    setCapturingSource(false)
    if (annotateRef.current?.getAttribute("aria-pressed") === "true") annotateRef.current.focus()
    setAnnotating(false)
  }, [])
  const preview = usePreviewSelection({
    frameRef: canvas.frameRef,
    prototypeUrl: canvas.prototypeUrl,
    previewUrl: canvas.previewUrl,
    notes,
    active,
    annotating,
    composing: selection !== null,
    onSelect: receiveSelection,
    onRoute: setRoute,
    onCancel: cancelPreviewSelection,
    onProblem: setMessage,
  })

  useLayoutEffect(() => {
    if (composerOpen) draftRef.current?.focus()
  }, [composerOpen])

  function openNotes() {
    if (canvas.selectionDisabled) return
    setPanelOpen(true)
    canvas.onOpenNotes()
  }

  async function beginSelection() {
    if (canvas.selectionDisabled) return
    canvas.onOpenNotes()
    const generation = ++captureGeneration.current
    setCapturingSource(true)
    const source = await saved.capture()
    if (generation !== captureGeneration.current) return
    setCapturingSource(false)
    setSelectedSource(source)
    setAnnotating(true)
    setPanelOpen(false)
    setMessage(copy.selectHint)
  }

  function closeComposer() {
    if (draft !== "") {
      setDiscarding(true)
      return
    }
    setSelection(null)
    cancelPreviewSelection()
  }

  async function save() {
    if (!selection || !draft.trim() || saved.busy || selectionChanged) return
    if (
      !(await saved.change("create", {
        identity: selection.identity,
        sourceId: selection.sourceId,
        body: draft.trim(),
        anchor: selection.anchor,
      }))
    )
      return
    openNotes()
    cancelPreviewSelection()
    setSelection(null)
    setMessage(copy.saved)
  }

  return (
    <section
      aria-label={copy.title}
      className="improvement-demo"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !selection)
          cancelPreviewSelection()
      }}
    >
      {canvas.toolbarTarget &&
        createPortal(
          <div role="group" aria-label={copy.title} className="improvement-demo__split">
            <Button
              ref={annotateRef}
              size="small"
              variant="secondary"
              className="canvas-toolbar-compact-button"
              title={copy.annotate}
              leadingVisual={<CrosshairsIcon />}
              aria-pressed={annotating}
              disabled={
                canvas.selectionDisabled || capturingSource || !preview.ready || !saved.state
              }
              onClick={() => {
                if (annotating) cancelPreviewSelection()
                else void beginSelection()
              }}
            >
              <span className="canvas-toolbar-button-label">{copy.annotate}</span>
            </Button>
            <Button
              ref={notesToggleRef}
              size="small"
              variant="secondary"
              aria-label={copy.openNotes(notesCount)}
              aria-expanded={panelOpen && active && !canvas.hubOpen}
              disabled={canvas.selectionDisabled}
              onClick={openNotes}
            >
              <HubCounter>{notesCount}</HubCounter>
            </Button>
          </div>,
          canvas.toolbarTarget,
        )}
      <ImprovementThreads
        identity={saved.state?.identity ?? ""}
        controls={false}
        returnFocusRef={notesToggleRef}
        open={panelOpen && active && !canvas.hubOpen && !selection}
        active={active && (panelOpen || annotating) && !canvas.hubOpen && !selection}
        onInteractionChange={setThreadInteraction}
        onOpen={openNotes}
        onClose={() => {
          setPanelOpen(false)
          notesToggleRef.current?.focus()
        }}
        threads={notes.map((note) => improvementThreadView(note, preview.resolutions.get(note.id)))}
        busy={saved.busy || !saved.state}
        activeBatch={Boolean(saved.state?.activeBatch)}
        error={
          saved.error ||
          syncError ||
          saved.state?.profileError ||
          (!saved.state ? copy.storageLoading : !preview.ready ? copy.bridgeUnavailable : "")
        }
        onSelect={(id) => {
          const note = notes.find((item) => item.id === id)
          if (note && note.route !== route)
            canvas.onNavigate(new URL(note.route, canvas.prototypeUrl).href)
        }}
        onFollowUp={(thread, body) =>
          saved.change("follow-up", {
            id: thread.id,
            expectedNoteRevision: thread.revision,
            body,
          })
        }
        onResolve={(thread) =>
          saved.change("status", {
            id: thread.id,
            expectedNoteRevision: thread.revision,
            status: "resolved",
          })
        }
        onDelete={(thread) =>
          saved.change("delete", {
            id: thread.id,
            expectedNoteRevision: thread.revision,
          })
        }
        onFix={() => saved.change("fix")}
        onRetry={(thread) =>
          saved.change("status", {
            id: thread.id,
            expectedNoteRevision: thread.revision,
            status: "open",
          })
        }
      />
      <p className="visually-hidden" role="status">
        {message}
      </p>
      {composerOpen ? (
        <CanvasDialog
          title={copy.add}
          closeLabel={copy.closeComposer}
          returnFocusRef={annotateRef}
          onClose={closeComposer}
          className="improvement-demo__composer"
        >
          {saved.error ? (
            <p role="alert" className="improvement-demo__notice">
              {saved.error}
            </p>
          ) : null}
          {selectionChanged ? (
            <p role="alert" className="improvement-demo__notice">
              {copy.branchChanged}
            </p>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <FormControl fullWidth>
              <FormControl.Label>{copy.label}</FormControl.Label>
              <Textarea
                ref={draftRef}
                value={draft}
                maxLength={10000}
                rows={4}
                placeholder={copy.placeholder}
                onChange={(event) => setDraft(event.target.value)}
                required
              />
            </FormControl>
            <div className="improvement-demo__dialog-actions">
              <Button
                type="submit"
                size="small"
                variant="primary"
                disabled={!draft.trim() || saved.busy || selectionChanged}
              >
                {copy.save}
              </Button>
            </div>
          </form>
        </CanvasDialog>
      ) : null}
      {discarding && saved.state ? (
        <CanvasDialog
          title={copy.discardTitle}
          closeLabel={copy.closeDiscard}
          returnFocusRef={annotateRef}
          onClose={() => setDiscarding(false)}
        >
          <p>{copy.discardBody}</p>
          <div className="improvement-demo__dialog-actions">
            <Button size="small" variant="secondary" onClick={() => setDiscarding(false)}>
              {copy.keep}
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={() => {
                setDiscarding(false)
                setSelection(null)
                setDraft("")
                cancelPreviewSelection()
              }}
            >
              {copy.discard}
            </Button>
          </div>
        </CanvasDialog>
      ) : null}
    </section>
  )
}
