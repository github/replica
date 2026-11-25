import { SparkleIcon } from "@primer/octicons-react"
import { ActionMenu, Button, Checkbox } from "@primer/react-brand/esm"
import { useState } from "react"

import { HubCounter } from "@components/hub-counter"
import { HubSidebar } from "@components/hub-sidebar"
import { HubUserAvatar } from "@components/hub-user-avatar"

import { copy } from "./en"
import { notes as initialNotes } from "./fixtures"

import "../styles.css"
import "@features/review-comment-row/styles.css"
import "./styles.css"

export function ImprovementSelectionDemo() {
  const [notes, setNotes] = useState(() => structuredClone(initialNotes))
  const [selected, setSelected] = useState<number[]>([])
  const [filter, setFilter] = useState("active")
  const [open, setOpen] = useState(true)
  const filters = [
    { value: "active", label: copy.allActive },
    { value: "ready", label: copy.ready },
    { value: "resolved", label: copy.resolved },
  ]
  const visible = notes.filter((note) =>
    filter === "active" ? note.status !== "resolved" : note.status === filter,
  )
  const pending = notes.filter((note) => note.status === "open")
  const ready = notes.filter((note) => note.status === "ready")
  const selectedOpen = pending.filter((note) => selected.includes(note.id))
  const selectedReady = ready.filter((note) => selected.includes(note.id))

  function change(ids: number[], status: "ready" | "resolved") {
    setNotes((items) =>
      items.map((item) =>
        ids.includes(item.id) ? { ...item, status, originalPending: false } : item,
      ),
    )
    setSelected((items) => items.filter((id) => !ids.includes(id)))
  }

  return (
    <>
      <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
        {copy.title}
      </Button>
      <HubSidebar
        title={copy.title}
        open={open}
        closeLabel={copy.close}
        onClose={() => {
          setOpen(false)
          setSelected([])
        }}
        className="thread-sample note-selection-demo"
        contentClassName="thread-sample__content"
      >
        <div className="thread-sample__toolbar">
          <div className="thread-sample__filters">
            <ActionMenu
              size="small"
              selectionVariant="single"
              menuAlignment="start"
              onSelect={(value) => {
                setFilter(value)
                setSelected([])
              }}
            >
              <ActionMenu.Button
                size="small"
                variant="secondary"
                aria-label={`${copy.filter}: ${filters.find((item) => item.value === filter)!.label}`}
              >
                {filters.find((item) => item.value === filter)!.label}
              </ActionMenu.Button>
              <ActionMenu.Overlay aria-label={copy.filter}>
                {filters.map((item) => (
                  <ActionMenu.Item
                    key={item.value}
                    value={item.value}
                    role="menuitemradio"
                    selected={filter === item.value}
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
                leadingVisual={<SparkleIcon size={16} />}
                disabled={!pending.length}
                aria-label={copy.simulate(pending.length)}
                onClick={() =>
                  change(
                    pending.map((note) => note.id),
                    "ready",
                  )
                }
              >
                <span className="thread-sample__fix-label">
                  {copy.fix}
                  <HubCounter aria-hidden="true">{pending.length}</HubCounter>
                </span>
              </Button>
            ) : filter === "ready" ? (
              <Button
                size="small"
                variant="secondary"
                disabled={!ready.length}
                onClick={() =>
                  change(
                    ready.map((note) => note.id),
                    "resolved",
                  )
                }
              >
                {copy.resolveAll}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="thread-sample__list">
          {!visible.length ? <p className="thread-sample__empty">{copy.empty}</p> : null}
          {visible.map((note) => (
            <article
              key={note.id}
              aria-label={note.body}
              className={`review-comment-row thread-sample__card note-selection-demo__card${selected.includes(note.id) ? " review-comment-row--selected" : ""}${note.status === "resolved" ? " thread-sample__card--resolved" : ""}`}
            >
              <div className="note-selection-demo__row">
                {filter === "active" ? (
                  <span
                    className="note-selection-demo__select"
                    data-selecting={selected.length > 0}
                  >
                    <HubUserAvatar src={note.avatarUrl ?? null} size={20} />
                    <span className="note-selection-demo__checkbox">
                      <Checkbox
                        aria-label={copy.select(note.body)}
                        checked={selected.includes(note.id)}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setSelected((items) =>
                            checked ? [...items, note.id] : items.filter((id) => id !== note.id),
                          )
                        }}
                      />
                    </span>
                  </span>
                ) : (
                  <HubUserAvatar src={note.avatarUrl ?? null} size={20} />
                )}
                <div className="review-comment-row__content">
                  <div className="thread-sample__heading">
                    <strong className="review-comment-row__author">{note.author}</strong>
                    {note.status === "ready" ? (
                      <span className="thread-sample__status thread-sample__status--ready">
                        {copy.ready}
                      </span>
                    ) : null}
                  </div>
                  <p className="note-selection-demo__body">{note.body}</p>
                </div>
              </div>
              <div className="thread-sample__metadata">
                <span>{note.target}</span>
                <span aria-hidden="true">·</span>
                <code>{note.path}</code>
              </div>
            </article>
          ))}
        </div>
        {selected.length ? (
          <section className="note-selection-demo__footer" aria-label={copy.selection}>
            <div className="note-selection-demo__summary">
              <span role="status">{copy.selected(selected.length)}</span>{" "}
              <span className="note-selection-demo__clear-group">
                (
                <button
                  type="button"
                  className="note-selection-demo__clear"
                  onClick={() => setSelected([])}
                >
                  {copy.clear}
                </button>
                )
              </span>
            </div>
            <div className="note-selection-demo__actions">
              {selectedOpen.length ? (
                <Button
                  size="small"
                  variant="primary"
                  onClick={() =>
                    change(
                      selectedOpen.map((note) => note.id),
                      "ready",
                    )
                  }
                >
                  <span className="thread-sample__fix-label">
                    {copy.fixSelected}
                    <HubCounter>{selectedOpen.length}</HubCounter>
                  </span>
                </Button>
              ) : null}
              {selectedReady.length ? (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    change(
                      selectedReady.map((note) => note.id),
                      "resolved",
                    )
                  }
                >
                  <span className="thread-sample__fix-label">
                    {copy.markResolved}
                    <HubCounter>{selectedReady.length}</HubCounter>
                  </span>
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </HubSidebar>
    </>
  )
}
