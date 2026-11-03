import { Button, Heading, Text } from "@primer/react-brand"
import { useEffect, useState, useSyncExternalStore } from "react"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { validControlsValues } from "@utils/prototype-controls-protocol/valid-values"
import { ControlsPanel } from ".."
import { ControlsToggle } from "../../prototype-controls-toggle"
import type { ControlsPanelLayout } from "../types"

const declaration = {
  version: 1,
  scope: "allControlsPanelStory",
  groups: [
    { id: "content", label: "Content" },
    { id: "appearance", label: "Appearance" },
  ],
  controls: [
    {
      id: "title",
      label: "Title",
      type: "text",
      default: "Field notes",
    },
    {
      id: "description",
      label: "Description",
      type: "textarea",
      default: "A simple page for trying every prototype control.",
    },
    {
      id: "count",
      label: "Item count",
      type: "number",
      default: 3,
      min: 0,
      max: 8,
      group: "content",
    },
    {
      id: "showDescription",
      label: "Show description",
      type: "boolean",
      default: true,
      group: "content",
    },
    {
      id: "features",
      label: "Card details",
      type: "checkboxGroup",
      options: ["Badges", "Notes"],
      default: ["Badges", "Notes"],
      group: "content",
    },
    {
      id: "layout",
      label: "Layout",
      type: "select",
      options: ["List", "Grid"],
      default: "List",
      group: "appearance",
    },
    {
      id: "notePresentation",
      label: "Presentation of the notes in each card",
      type: "select",
      options: ["Short summaries of each note", "Detailed descriptions of each note"],
      default: "Detailed descriptions of each note",
      group: "appearance",
    },
    {
      id: "alignment",
      label: "Text alignment",
      type: "radio",
      options: ["Left", "Center"],
      default: "Left",
      group: "appearance",
    },
    {
      id: "density",
      label: "Density",
      type: "segmented",
      options: ["Comfortable", "Compact"],
      default: "Comfortable",
      group: "appearance",
    },
    {
      id: "opacity",
      label: "Card opacity",
      type: "slider",
      default: 1,
      min: 0.2,
      max: 1,
      step: 0.1,
      group: "appearance",
    },
    {
      id: "accent",
      label: "Accent color",
      type: "color",
      default: "#336699",
      group: "appearance",
    },
    { id: "shuffle", label: "Shuffle notes", type: "button" },
  ],
} as const

export function AllControlsExample() {
  const controller = createControls(declaration)
  const { values } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [open, setOpen] = useState(true)
  const [round, setRound] = useState(0)
  const [error, setError] = useState("")
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  useEffect(
    () => controller.mount(() => ({ shuffle: () => setRound((previous) => previous + 1) })),
    [controller],
  )
  return (
    <div className="controls-panel-example controls-panel-example--all-controls">
      <header className="controls-panel-example__toolbar">
        <Text size="100">All control types</Text>
        <ControlsToggle open={open} onToggle={() => setOpen(!open)} />
      </header>
      <div className="controls-panel-example__preview">
        <section
          className="controls-panel-example__content controls-panel-example__notes"
          aria-label="Live example page"
          style={{ textAlign: values.alignment === "Center" ? "center" : "left" }}
        >
          <Heading as="h1" size="4">
            {values.title}
          </Heading>
          {values.showDescription ? <Text as="p">{values.description}</Text> : null}
          <div
            className="controls-panel-example__cards"
            data-layout={values.layout}
            data-density={values.density}
          >
            {Array.from({ length: values.count }, (_, index) => (
              <article
                key={index}
                className="controls-panel-example__card"
                style={{ borderColor: values.accent, opacity: values.opacity }}
              >
                <Heading as="h2" size="6">
                  Note {((index + round) % 8) + 1}
                </Heading>
                {values.features.includes("Badges") ? (
                  <Text as="span" size="100" style={{ color: values.accent }}>
                    Ready to explore
                  </Text>
                ) : null}
                {values.features.includes("Notes") ? (
                  <Text as="p" size="100" variant="muted">
                    {values.notePresentation === "Short summaries of each note"
                      ? "A short note to explore."
                      : "Try changing the content, layout, density, and color."}
                  </Text>
                ) : null}
              </article>
            ))}
          </div>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setRound((previous) => previous + 1)}
          >
            Shuffle from the page
          </Button>
          <Text as="p" size="100" variant="muted" role="status">
            Notes shuffled: {round}
          </Text>
        </section>
        {open ? (
          <ControlsPanel
            layout={layout}
            onLayoutChange={setLayout}
            state={{
              runtimeAvailable: true,
              status: "ready",
              scopes: [scopeProjection(controller)],
              loading: false,
              resetting: false,
              error,
              storageError: "",
              notice: "",
            }}
            connection={{
              retry: () => setError(""),
              resetAll: () => {
                controller.reset()
                setRound(0)
                setError("")
                return Promise.resolve()
              },
              command: async (operation, scope, id, value) => {
                setError("")
                try {
                  if (scope !== declaration.scope || !id)
                    throw new Error("Unknown example control command.")
                  if (operation === "action") {
                    if (id !== "shuffle") throw new Error("Unknown example action.")
                    await controller.action(id)
                    return
                  }
                  const next = { [id]: value }
                  if (!validControlsValues(next) || next[id] === undefined)
                    throw new Error("Invalid example control value.")
                  controller.restore(next)
                  return { value: scopeProjection(controller).snapshot.values[id] }
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "The example command failed.")
                  if (operation !== "action") throw cause
                }
              },
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
