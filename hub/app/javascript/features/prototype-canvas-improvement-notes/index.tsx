import { CheckCircleIcon, CrosshairsIcon, PencilIcon, SparkleIcon } from "@primer/octicons-react"
import { ActionMenu, Button, FormControl, Textarea } from "@primer/react-brand"
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"

import { HubSidebar } from "@components/hub-sidebar"
import { HubCounter } from "@components/hub-counter"
import type { ReviewAnchor } from "@utils/review-anchor/types"
import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { capturePreview } from "./capture"
import { copy } from "./en"
import { sampleNotes, targets } from "./fixtures"
import { ImprovementPreview } from "./preview"
import type { Note, Rect, Route, Selection, Target } from "./types"
import { usePreviewSelection } from "./use-preview-selection"
import { useSavedNotes } from "./use-saved-notes"

import "./styles.css"

type Props = {
  initial?: "empty" | "single" | "multiple"
  canvas?: {
    token?: string
    frameRef: RefObject<HTMLIFrameElement | null>
    prototypeUrl: string
    previewUrl?: string
    branch: string
    hubOpen: boolean
    onOpenNotes: () => void
    onNavigate: (url: string) => void
  }
}
type Point = { x: number; y: number }

export function ImprovementNotesPrototype({ initial = "empty", canvas }: Props) {
  const [demoNotes, setNotes] = useState<Note[]>(() =>
    sampleNotes.slice(0, initial === "empty" ? 0 : initial === "single" ? 1 : 3).map((note) => {
      const document = new DOMParser().parseFromString(
        renderToStaticMarkup(<ImprovementPreview route={note.route} />),
        "image/svg+xml",
      )
      const svg = document.documentElement
      if (!(svg instanceof SVGSVGElement))
        throw new Error("The sample preview could not be captured.")
      return {
        ...note,
        capture: capturePreview(svg, note.rect),
      }
    }),
  )
  const saved = useSavedNotes(canvas?.token)
  const notes = canvas?.token ? (saved.state?.notes ?? []) : demoNotes
  const [route, setRoute] = useState<Route>("/projects")
  const [annotating, setAnnotating] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [discarding, setDiscarding] = useState(false)
  const [deleting, setDeleting] = useState<{
    id: number
    revision: number
    identity?: string
  } | null>(null)
  const [filter, setFilter] = useState("active")
  const [connection, setConnection] = useState<"offline" | "connected" | "failed">("offline")
  const [batch, setBatch] = useState<Note[]>([])
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [focused, setFocused] = useState<number | null>(null)
  const [regionMode, setRegionMode] = useState(false)
  const [corner, setCorner] = useState<Point>({ x: 160, y: 160 })
  const [firstCorner, setFirstCorner] = useState<Point | null>(null)
  const [toolbarTarget, setToolbarTarget] = useState<Element | null>(null)
  const [dragRect, setDragRect] = useState<Rect | null>(null)
  const drag = useRef<{ start: Point; target: Target | undefined; pointerId: number } | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const annotateRef = useRef<HTMLButtonElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const notesToggleRef = useRef<HTMLButtonElement>(null)
  const nextId = useRef(initial === "empty" ? 1 : initial === "single" ? 2 : 4)
  const eligible = notes.filter((note) => note.status === "open")
  const notesAvailable = !canvas?.token || saved.state !== null
  const composerOpen = selection !== null && !discarding && notesAvailable
  useLayoutEffect(() => {
    if (composerOpen) draftRef.current?.focus()
  }, [composerOpen])
  const selectionChanged =
    Boolean(canvas?.token) && selection !== null && selection.identity !== saved.state?.identity
  const notesCount = notes.filter((note) => note.status !== "resolved").length
  const filterLabel =
    filter === "ready"
      ? copy.readyFilter
      : filter === "resolved"
        ? copy.resolvedFilter
        : copy.allActive
  const visible = notes.filter((note) =>
    filter === "resolved"
      ? note.status === "resolved"
      : filter === "ready"
        ? note.status === "ready"
        : note.status !== "resolved",
  )
  const activeBatch =
    Boolean(saved.state?.activeBatch) ||
    batch.some((item) =>
      notes.some(
        (note) => note.id === item.id && note.revision === item.revision && note.status === "sent",
      ),
    )
  const currentNotes = notes.filter((note) => note.route === route && note.status !== "resolved")
  const focusedNote = notes.find((note) => note.id === focused && note.route === route)
  const receiveSelection = useCallback(
    (anchor: ReviewAnchor) => {
      const target =
        anchor.kind === "element" ? anchor.accessibleName || anchor.tagName : copy.regionTarget
      setSelection({
        identity: saved.state?.identity,
        anchor,
        route: anchor.route.pathname + anchor.route.search + anchor.route.hash,
        target,
        selector: anchor.kind === "element" ? anchor.selector : null,
        rect: anchor.rect,
        capture: "",
        capturePlaceholder: true,
      })
      setEditing(null)
      setDraft("")
    },
    [saved.state?.identity],
  )
  const cancelPreviewSelection = useCallback(() => {
    if (annotateRef.current?.getAttribute("aria-pressed") === "true") annotateRef.current.focus()
    setAnnotating(false)
  }, [])
  const canvasFrameRef = canvas?.frameRef
  const preview = usePreviewSelection({
    frameRef: canvasFrameRef,
    prototypeUrl: canvas?.prototypeUrl,
    previewUrl: canvas?.previewUrl,
    notes,
    annotating,
    composing: selection !== null,
    onSelect: receiveSelection,
    onRoute: setRoute,
    onCancel: cancelPreviewSelection,
    onProblem: setMessage,
  })
  const embedded = Boolean(canvas)
  useLayoutEffect(() => {
    if (!canvasFrameRef) return
    setToolbarTarget(
      canvasFrameRef.current
        ?.closest(".canvas-shell")
        ?.querySelector("#canvas-improvement-controls") ?? null,
    )
  }, [canvasFrameRef])

  function openNotes() {
    setPanelOpen(true)
    canvas?.onOpenNotes()
  }

  function select(rect: Rect, target?: Target) {
    const svg = previewRef.current?.querySelector("svg")
    if (!svg) {
      setMessage(copy.previewUnavailable)
      return
    }
    setSelection({
      route,
      target: target?.label ?? copy.regionTarget,
      selector: target ? `[data-improvement-target="${target.id}"]` : null,
      rect,
      capture: capturePreview(svg, rect),
    })
    setDraft("")
    setEditing(null)
    setDragRect(null)
    setFirstCorner(null)
    setRegionMode(false)
  }

  function rectangle(start: Point, end: Point): Rect {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  function point(event: PointerEvent<HTMLDivElement>): Point | null {
    const bounds = previewRef.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) {
      setMessage(copy.previewUnavailable)
      return null
    }
    return {
      x: Math.max(0, Math.min(960, ((event.clientX - bounds.left) / bounds.width) * 960)),
      y: Math.max(0, Math.min(560, ((event.clientY - bounds.top) / bounds.height) * 560)),
    }
  }

  function finishRegion(start: Point, end: Point) {
    const rect = rectangle(start, end)
    setDragRect(null)
    setFirstCorner(null)
    if (rect.width < 8 || rect.height < 8) {
      setMessage(copy.regionSmall)
      return
    }
    select(rect)
  }

  function closeComposer() {
    const original = selection?.originalBody ?? ""
    if (draft !== original) {
      setDiscarding(true)
      return
    }
    setSelection(null)
    setEditing(null)
  }

  async function save() {
    if (!selection || !draft.trim() || saved.busy || selectionChanged) return
    if (canvas?.token) {
      if (
        !(await saved.change(editing === null ? "create" : "edit", {
          id: editing,
          identity: selection.identity,
          expectedNoteRevision: selection.noteRevision,
          body: draft.trim(),
          anchor: selection.anchor,
          capture: selection.capturePlaceholder ? "" : selection.capture,
        }))
      )
        return
      setFilter("active")
      openNotes()
      setSelection(null)
      setEditing(null)
      setMessage(copy.saved)
      return
    }
    const sync =
      connection === "connected" ? "synced" : connection === "failed" ? "failed" : "local"
    if (editing !== null) {
      setNotes((items) =>
        items.map((note) =>
          note.id === editing
            ? { ...note, body: draft.trim(), revision: note.revision + 1, status: "open", sync }
            : note,
        ),
      )
    } else {
      const note: Note = {
        ...selection,
        id: nextId.current++,
        body: draft.trim(),
        kind: "improvement_note",
        author: "octocat",
        status: "open",
        sync,
        revision: 1,
      }
      setNotes((items) => [...items, note])
      setFocused(note.id)
    }
    setFilter("active")
    openNotes()
    setSelection(null)
    setEditing(null)
    setMessage(connection === "failed" ? copy.syncFailed : copy.saved)
  }

  async function fix() {
    if (!eligible.length || activeBatch) return
    if (canvas?.token) {
      if (await saved.change("fix")) setMessage(copy.productionSent)
      return
    }
    setBatch(eligible.map((note) => ({ ...note })))
    setNotes((items) =>
      items.map((note) => (note.status === "open" ? { ...note, status: "sent" } : note)),
    )
    setHandoffOpen(true)
    setMessage(copy.sent)
  }

  function result(status: "ready" | "blocked") {
    setNotes((items) =>
      items.map((note) =>
        batch.some((item) => item.id === note.id && item.revision === note.revision) &&
        note.status === "sent"
          ? { ...note, status }
          : note,
      ),
    )
    setHandoffOpen(false)
    setPanelOpen(true)
    setMessage(copy.finished)
  }

  async function changeStatus(selected: Note, status: Note["status"]) {
    if (canvas?.token) {
      if (
        await saved.change("status", {
          id: selected.id,
          status,
          identity: saved.state?.identity,
          expectedNoteRevision: selected.revision,
        })
      )
        notesToggleRef.current?.focus()
      return
    }
    setNotes((items) =>
      items.map((note) =>
        note.id === selected.id
          ? {
              ...note,
              status,
              sync:
                connection === "connected"
                  ? "synced"
                  : connection === "failed"
                    ? "failed"
                    : "local",
            }
          : note,
      ),
    )
    notesToggleRef.current?.focus()
  }

  const annotationControls = (
    <div className="improvement-demo__actions">
      <div role="group" aria-label={copy.title} className="improvement-demo__split">
        <Button
          ref={annotateRef}
          size="small"
          variant="secondary"
          leadingVisual={<CrosshairsIcon />}
          aria-pressed={annotating}
          disabled={embedded && (!preview.ready || (Boolean(canvas?.token) && !saved.state))}
          onClick={() => {
            setAnnotating(!annotating)
            if (!annotating) {
              setPanelOpen(false)
              setMessage(copy.selectHint)
            }
            setRegionMode(false)
            setFirstCorner(null)
            setDragRect(null)
          }}
        >
          {copy.annotate}
        </Button>
        <Button
          ref={notesToggleRef}
          size="small"
          variant="secondary"
          aria-label={copy.openNotes(notesCount)}
          aria-expanded={panelOpen && !canvas?.hubOpen}
          onClick={openNotes}
        >
          <HubCounter>{notesCount}</HubCounter>
        </Button>
      </div>
    </div>
  )

  return (
    <section
      aria-label={copy.title}
      className={`improvement-demo${embedded ? " improvement-demo--embedded" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || selection || deleting !== null || handoffOpen) return
        setAnnotating(false)
        setRegionMode(false)
        setFirstCorner(null)
        setDragRect(null)
        drag.current = null
        if (annotating) annotateRef.current?.focus()
      }}
    >
      {!embedded ? (
        <header className="improvement-demo__browser">
          <span className="improvement-demo__browser-dot" />
          <code>localhost:5173{route}</code>
          <span className="improvement-demo__badge">{copy.demo}</span>
        </header>
      ) : null}
      {embedded ? (
        toolbarTarget && createPortal(annotationControls, toolbarTarget)
      ) : (
        <header className="improvement-demo__toolbar">
          <div className="improvement-demo__identity">
            <strong>{copy.branch}</strong>
            <span>{copy.title}</span>
          </div>
          {annotationControls}
        </header>
      )}
      {!embedded ? <div className="improvement-demo__disclaimer">{copy.demoNotice}</div> : null}
      <div className="improvement-demo__workspace">
        {!embedded ? (
          <section className="improvement-demo__preview" aria-label="Prototype preview">
            <nav className="improvement-demo__pages" aria-label={copy.sampleScreens}>
              <span className="improvement-demo__app-name">{copy.sampleWorkspace}</span>
              {(["/projects", "/settings"] as const).map((page) => (
                <button
                  key={page}
                  type="button"
                  aria-current={route === page ? "page" : undefined}
                  onClick={() => {
                    setRoute(page)
                    setFocused(null)
                    setFirstCorner(null)
                    setDragRect(null)
                  }}
                >
                  {page === "/projects" ? copy.projects : copy.settings}
                </button>
              ))}
            </nav>
            <div
              ref={previewRef}
              className={`improvement-demo__stage${annotating ? " improvement-demo__stage--selecting" : ""}`}
              role={regionMode ? "button" : "group"}
              tabIndex={annotating ? 0 : -1}
              aria-describedby="improvement-selection-hint"
              aria-label={regionMode ? "Choose region corners" : "Selectable preview"}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  setAnnotating(false)
                  setRegionMode(false)
                  setFirstCorner(null)
                  setDragRect(null)
                  drag.current = null
                  annotateRef.current?.focus()
                } else if (annotating && event.shiftKey && event.key === "Enter") {
                  event.preventDefault()
                  setRegionMode(!regionMode)
                  setFirstCorner(null)
                  setDragRect(null)
                  setMessage(regionMode ? copy.selectHint : copy.regionHint)
                } else if (
                  regionMode &&
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault()
                  if (event.key === "Enter" || event.key === " ") {
                    if (firstCorner) finishRegion(firstCorner, corner)
                    else {
                      setFirstCorner(corner)
                      setMessage(copy.firstCorner)
                    }
                  } else {
                    const next = {
                      x: Math.max(
                        0,
                        Math.min(
                          960,
                          corner.x +
                            (event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0),
                        ),
                      ),
                      y: Math.max(
                        0,
                        Math.min(
                          560,
                          corner.y +
                            (event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0),
                        ),
                      ),
                    }
                    setCorner(next)
                    if (firstCorner) setDragRect(rectangle(firstCorner, next))
                  }
                }
              }}
              onPointerDown={(event) => {
                if (
                  !annotating ||
                  event.button !== 0 ||
                  (event.target instanceof Element && event.target.closest("[data-note-pin]"))
                )
                  return
                event.preventDefault()
                const start = point(event)
                if (!start) return
                if (regionMode) {
                  setCorner(start)
                  drag.current = { start, target: undefined, pointerId: event.pointerId }
                  event.currentTarget.setPointerCapture(event.pointerId)
                  return
                }
                const element =
                  event.target instanceof Element
                    ? event.target.closest("[data-improvement-target]")
                    : null
                drag.current = {
                  start,
                  target: targets.find(
                    (target) => target.id === element?.getAttribute("data-improvement-target"),
                  ),
                  pointerId: event.pointerId,
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                if (!drag.current || drag.current.pointerId !== event.pointerId) return
                const end = point(event)
                if (!end) return
                if (regionMode) {
                  setCorner(end)
                  if (firstCorner) setDragRect(rectangle(firstCorner, end))
                  return
                }
                const rect = rectangle(drag.current.start, end)
                if (Math.hypot(rect.width, rect.height) >= 8) setDragRect(rect)
              }}
              onPointerUp={(event) => {
                const active = drag.current
                if (!active || active.pointerId !== event.pointerId) return
                drag.current = null
                event.currentTarget.releasePointerCapture(event.pointerId)
                const end = point(event)
                if (!end) return
                if (regionMode) {
                  setCorner(end)
                  if (firstCorner) finishRegion(firstCorner, end)
                  else {
                    setFirstCorner(end)
                    setMessage(copy.firstCorner)
                  }
                  return
                }
                const rect = rectangle(active.start, end)
                if (Math.hypot(rect.width, rect.height) >= 8) finishRegion(active.start, end)
                else if (active.target) select(active.target.rect, active.target)
                setDragRect(null)
              }}
              onPointerCancel={() => {
                drag.current = null
                setDragRect(null)
              }}
              onLostPointerCapture={() => {
                drag.current = null
                setDragRect(null)
              }}
            >
              <ImprovementPreview route={route} />
              {annotating && !regionMode
                ? targets
                    .filter((target) => target.route === route)
                    .map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        data-improvement-target={target.id}
                        className="improvement-demo__element-target"
                        aria-label={target.label}
                        style={{
                          left: `${(target.rect.x / 960) * 100}%`,
                          top: `${(target.rect.y / 560) * 100}%`,
                          width: `${(target.rect.width / 960) * 100}%`,
                          height: `${(target.rect.height / 560) * 100}%`,
                        }}
                        onClick={() => {
                          if (!selection) select(target.rect, target)
                        }}
                      />
                    ))
                : null}
              {dragRect ? (
                <div
                  className="improvement-demo__outline"
                  style={{
                    left: `${(dragRect.x / 960) * 100}%`,
                    top: `${(dragRect.y / 560) * 100}%`,
                    width: `${(dragRect.width / 960) * 100}%`,
                    height: `${(dragRect.height / 560) * 100}%`,
                  }}
                />
              ) : null}
              {regionMode ? (
                <span
                  className="improvement-demo__corner"
                  style={{ left: `${(corner.x / 960) * 100}%`, top: `${(corner.y / 560) * 100}%` }}
                />
              ) : null}
              {currentNotes.map((note) => (
                <button
                  key={note.id}
                  data-note-pin
                  type="button"
                  className={`improvement-demo__pin${focused === note.id ? " improvement-demo__pin--selected" : ""}`}
                  style={{
                    left: `${(Math.min(note.rect.x + note.rect.width, 930) / 960) * 100}%`,
                    top: `${(note.rect.y / 560) * 100}%`,
                  }}
                  aria-label={`Open improvement note ${note.id}: ${note.target}`}
                  onClick={() => {
                    setFocused(note.id)
                    setPanelOpen(true)
                    setFilter("active")
                  }}
                >
                  {note.id}
                </button>
              ))}
              {focusedNote ? (
                <div
                  className="improvement-demo__outline improvement-demo__outline--saved"
                  style={{
                    left: `${(focusedNote.rect.x / 960) * 100}%`,
                    top: `${(focusedNote.rect.y / 560) * 100}%`,
                    width: `${(focusedNote.rect.width / 960) * 100}%`,
                    height: `${(focusedNote.rect.height / 560) * 100}%`,
                  }}
                />
              ) : null}
            </div>
            <footer className="improvement-demo__preview-footer">
              <span id="improvement-selection-hint">
                {annotating ? copy.keyboardHint : copy.navigationHint}
              </span>
              <span>960 × 560</span>
            </footer>
          </section>
        ) : null}
        {embedded ? (
          <div className="canvas-improvement-markers">
            {currentNotes.map((note) => {
              const resolution = preview.resolutions.get(note.id)
              if (
                !resolution ||
                (resolution.status !== "resolved" && resolution.status !== "moved")
              )
                return null
              return (
                <button
                  key={note.id}
                  type="button"
                  className="improvement-demo__pin"
                  style={{ left: resolution.point.x, top: resolution.point.y }}
                  aria-label={`Open improvement note ${note.id}: ${note.target}`}
                  onClick={() => {
                    setFocused(note.id)
                    setFilter(note.status === "ready" ? "ready" : "active")
                    openNotes()
                  }}
                >
                  {note.id}
                </button>
              )
            })}
          </div>
        ) : null}
        <HubSidebar
          className="improvement-notes-sidebar"
          contentClassName="improvement-demo__panel"
          title={copy.notes}
          open={panelOpen && !canvas?.hubOpen}
          closeLabel={copy.closeNotes}
          onClose={() => {
            setPanelOpen(false)
            notesToggleRef.current?.focus()
          }}
        >
          {saved.error && (!selection || !notesAvailable) ? (
            <p role="alert">{saved.error}</p>
          ) : null}
          {saved.state?.syncError ? <p role="status">{saved.state.syncError}</p> : null}
          {canvas?.token && !saved.state ? <p role="status">{copy.storageLoading}</p> : null}
          {embedded && !preview.ready ? <p role="status">{copy.bridgeUnavailable}</p> : null}
          <div className="improvement-demo__filters">
            <ActionMenu
              size="small"
              selectionVariant="single"
              menuAlignment="start"
              onSelect={setFilter}
            >
              <ActionMenu.Button
                size="small"
                variant="secondary"
                aria-label={`${copy.filter}: ${filterLabel}`}
              >
                {filterLabel}
              </ActionMenu.Button>
              <ActionMenu.Overlay aria-label={copy.filter}>
                {[
                  { value: "active", label: copy.allActive },
                  { value: "ready", label: copy.readyFilter },
                  { value: "resolved", label: copy.resolvedFilter },
                ].map((item) => (
                  <ActionMenu.Item
                    key={item.value}
                    value={item.value}
                    selected={filter === item.value}
                    role="menuitemradio"
                    onKeyDownCapture={(event) => {
                      if (event.key !== " " && event.key !== "Enter") return
                      event.preventDefault()
                      event.stopPropagation()
                      event.currentTarget.click()
                    }}
                  >
                    {item.label}
                  </ActionMenu.Item>
                ))}
              </ActionMenu.Overlay>
            </ActionMenu>
            {filter === "active" ? (
              <Button
                size="small"
                variant="primary"
                className="improvement-demo__fix-all"
                leadingVisual={<SparkleIcon />}
                aria-label={copy.fixAll(eligible.length)}
                disabled={!eligible.length || activeBatch || saved.busy}
                title={activeBatch ? (embedded ? copy.productionBusy : copy.fixBusy) : undefined}
                onClick={() => void fix()}
              >
                <span className="improvement-demo__fix-label">
                  {copy.fix}
                  <HubCounter>{eligible.length}</HubCounter>
                </span>
              </Button>
            ) : null}
          </div>
          <div className="improvement-demo__note-list">
            {!visible.length ? (
              <div className="improvement-demo__empty">
                <PencilIcon size={28} />
                <h2>{notes.length ? copy.emptyFilter : copy.empty}</h2>
                {!notes.length ? (
                  <>
                    <p>{copy.emptyBody}</p>
                    <Button
                      size="small"
                      variant="secondary"
                      leadingVisual={<CrosshairsIcon />}
                      disabled={embedded && (!preview.ready || !notesAvailable)}
                      onClick={() => {
                        setAnnotating(true)
                        setPanelOpen(false)
                        annotateRef.current?.focus()
                      }}
                    >
                      {copy.annotate}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
            {visible.map((note) => (
              <article
                key={note.id}
                aria-label={`Improvement note ${note.id}`}
                className={`improvement-demo__note${focused === note.id ? " improvement-demo__note--focused" : ""}`}
              >
                <div className="improvement-demo__note-meta">
                  <span className="improvement-demo__number">{note.id}</span>
                  <code>{note.route}</code>
                  <span
                    className={`improvement-demo__status improvement-demo__status--${note.status}`}
                  >
                    {copy.statuses[note.status]}
                  </span>
                </div>
                <button
                  className="improvement-demo__target"
                  type="button"
                  aria-label={`${copy.viewTarget}: ${note.target}`}
                  onClick={() => {
                    if (canvas && note.anchor) {
                      const destination = new URL(canvas.prototypeUrl)
                      destination.pathname = note.anchor.route.pathname
                      destination.search = note.anchor.route.search
                      destination.hash = note.anchor.route.hash
                      canvas.onNavigate(destination.href)
                    } else setRoute(note.route)
                    setFocused(note.id)
                  }}
                >
                  {note.target}
                  <span>{copy.viewTarget}</span>
                </button>
                <p className="improvement-demo__body">{note.body}</p>
                {note.result ? <p className="improvement-demo__result">{note.result}</p> : null}
                {note.capture && !note.capturePlaceholder ? (
                  <img
                    className="improvement-demo__thumbnail"
                    src={note.capture}
                    alt={`${note.capturePlaceholder ? copy.capturePlaceholder : copy.capture}: ${note.target}`}
                  />
                ) : null}
                {!embedded &&
                (note.status === "sent" || note.status === "ready" || note.status === "blocked") ? (
                  <p className="improvement-demo__result">
                    {note.status === "sent"
                      ? copy.noteSent
                      : note.status === "ready"
                        ? copy.noteReady
                        : copy.noteBlocked}
                  </p>
                ) : null}
                <div className="improvement-demo__note-actions">
                  {embedded && note.status === "sent" ? (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => void changeStatus(note, "open")}
                    >
                      {copy.returnToActive}
                    </Button>
                  ) : null}
                  {note.status === "ready" ? (
                    <Button
                      size="small"
                      variant="secondary"
                      leadingVisual={<CheckCircleIcon />}
                      onClick={() => changeStatus(note, "resolved")}
                    >
                      {copy.resolve}
                    </Button>
                  ) : null}
                  {note.status === "resolved" ? (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => changeStatus(note, "open")}
                    >
                      {copy.reopen}
                    </Button>
                  ) : null}
                  {note.status === "blocked" ? (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => changeStatus(note, "open")}
                    >
                      {copy.retryFix}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    variant="subtle"
                    onClick={() => {
                      setSelection({
                        ...note,
                        identity: saved.state?.identity,
                        noteRevision: note.revision,
                        originalBody: note.body,
                      })
                      setEditing(note.id)
                      setDraft(note.body)
                    }}
                  >
                    {copy.editAction}
                  </Button>
                  <Button
                    size="small"
                    variant="subtle"
                    onClick={() =>
                      setDeleting({
                        id: note.id,
                        revision: note.revision,
                        identity: saved.state?.identity,
                      })
                    }
                  >
                    {copy.deleteAction}
                  </Button>
                </div>
                {!embedded && note.status === "sent" ? (
                  <details className="improvement-demo__simulation">
                    <summary>{copy.perNoteResult}</summary>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => changeStatus(note, "ready")}
                    >
                      {copy.complete}
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => changeStatus(note, "blocked")}
                    >
                      {copy.block}
                    </Button>
                  </details>
                ) : null}
                {!embedded ? (
                  <small className={note.sync === "failed" ? "improvement-demo__sync-error" : ""}>
                    {copy.sync[note.sync]}
                  </small>
                ) : null}
              </article>
            ))}
          </div>
          {!embedded && activeBatch ? (
            <Button size="small" variant="secondary" onClick={() => setHandoffOpen(true)}>
              {copy.batchLabel(batch.length)}
            </Button>
          ) : null}
          {!embedded ? (
            <footer className="improvement-demo__connection">
              <label>
                {copy.syncControls}
                <select
                  value={connection}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value !== "offline" && value !== "connected" && value !== "failed") return
                    setConnection(value)
                    if (value !== "offline")
                      setNotes((items) =>
                        items.map((note) => ({
                          ...note,
                          sync: value === "connected" ? "synced" : "failed",
                        })),
                      )
                  }}
                >
                  <option value="offline">{copy.offline}</option>
                  <option value="connected">{copy.connected}</option>
                  <option value="failed">{copy.syncFailure}</option>
                </select>
              </label>
              {notes.some((note) => note.sync === "failed") ? (
                <>
                  <p>{copy.syncFailed}</p>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setConnection("connected")
                      setNotes((items) => items.map((note) => ({ ...note, sync: "synced" })))
                      setMessage(copy.syncSuccess)
                    }}
                  >
                    {copy.syncRetry}
                  </Button>
                </>
              ) : null}
            </footer>
          ) : null}
        </HubSidebar>
      </div>
      <p
        className={`improvement-demo__announcement${embedded ? " visually-hidden" : ""}`}
        role="status"
      >
        {message}
      </p>
      {composerOpen ? (
        <CanvasDialog
          title={editing === null ? copy.add : copy.edit}
          closeLabel={copy.closeComposer}
          returnFocusRef={annotateRef}
          onClose={closeComposer}
          className="improvement-demo__composer"
        >
          {saved.error ? <p role="alert">{saved.error}</p> : null}
          {selectionChanged ? <p role="alert">{copy.branchChanged}</p> : null}
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
                {editing === null ? copy.save : copy.saveEdit}
              </Button>
            </div>
          </form>
        </CanvasDialog>
      ) : null}
      {discarding && notesAvailable ? (
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
                setEditing(null)
                setDraft("")
              }}
            >
              {copy.discard}
            </Button>
          </div>
        </CanvasDialog>
      ) : null}
      {deleting !== null && notesAvailable ? (
        <CanvasDialog
          title={copy.deleteTitle}
          closeLabel={copy.closeDelete}
          returnFocusRef={notesToggleRef}
          onClose={() => setDeleting(null)}
        >
          <p>{copy.deleteBody}</p>
          <div className="improvement-demo__dialog-actions">
            <Button size="small" variant="secondary" onClick={() => setDeleting(null)}>
              {copy.cancel}
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={async () => {
                if (
                  canvas?.token &&
                  !(await saved.change("delete", {
                    id: deleting.id,
                    identity: deleting.identity,
                    expectedNoteRevision: deleting.revision,
                  }))
                )
                  return
                setNotes((items) => items.filter((note) => note.id !== deleting.id))
                setDeleting(null)
                setFocused(null)
              }}
            >
              {copy.deleteAction}
            </Button>
          </div>
        </CanvasDialog>
      ) : null}
      {handoffOpen ? (
        <CanvasDialog
          title={copy.handoff}
          closeLabel={copy.closeBatch}
          returnFocusRef={notesToggleRef}
          onClose={() => setHandoffOpen(false)}
          className="improvement-demo__handoff"
        >
          <p>{copy.handoffNotice}</p>
          <div className="improvement-demo__batch-context">
            <code>{canvas?.branch ?? copy.branch}</code>
            <span>
              {embedded ? copy.canvasBatchSource : copy.sampleBatchSource} · {batch.length} notes
            </span>
          </div>
          <ol>
            {batch.map((note) => (
              <li key={`${note.id}-${note.revision}`}>
                <strong>
                  #{note.id} · {note.target}
                </strong>
                <code>
                  {note.route} · revision {note.revision}
                </code>
                <p>{note.body}</p>
                <img
                  className="improvement-demo__thumbnail"
                  src={note.capture}
                  alt={`${note.capturePlaceholder ? copy.capturePlaceholder : copy.capture}: ${note.target}`}
                />
                <code>
                  {note.selector ??
                    `Region: ${note.rect.x}, ${note.rect.y}, ${note.rect.width} × ${note.rect.height}`}
                </code>
              </li>
            ))}
          </ol>
          <p className="improvement-demo__form-hint">{copy.batchHint}</p>
          <div className="improvement-demo__dialog-actions">
            <Button size="small" variant="secondary" onClick={() => setHandoffOpen(false)}>
              {copy.closeHandoff}
            </Button>
            <Button size="small" variant="secondary" onClick={() => result("blocked")}>
              {copy.block}
            </Button>
            <Button size="small" variant="primary" onClick={() => result("ready")}>
              {copy.complete}
            </Button>
          </div>
        </CanvasDialog>
      ) : null}
    </section>
  )
}
