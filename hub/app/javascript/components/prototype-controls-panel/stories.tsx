import { Button, Text } from "@primer/react-brand"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState, useSyncExternalStore } from "react"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { validControlsValues } from "@utils/prototype-controls-protocol/valid-values"
import type { PanelState } from "@utils/prototype-controls-connection"
import { ControlsPanel } from "."
import type { ControlsPanelLayout } from "./types"
import { PageControlsExample } from "./page-controls-example"
import { AllControlsExample } from "./all-controls-example"
import { ControlsToggle } from "../prototype-controls-toggle"
import { copy } from "@utils/prototype-canvas/en"

import "./stories.css"

const declaration = {
  version: 1,
  scope: "floatingPanelStory",
  groups: [
    { id: "details", label: "Details" },
    { id: "appearance", label: "Appearance" },
  ],
  controls: [
    { id: "title", label: "Title", type: "text", default: "Interactive prototype" },
    { id: "showNotes", label: "Show notes", type: "boolean", default: true },
    {
      id: "note",
      label: "Note",
      type: "textarea",
      default: "The preview remains usable while controls are open.",
      group: "details",
    },
    {
      id: "layout",
      label: "Layout",
      type: "select",
      options: ["list", "grid"],
      default: "list",
      group: "appearance",
    },
    { id: "footer", label: "Footer", type: "text", default: "Ungrouped field below both groups" },
  ],
} as const

function PanelExample({
  failure = false,
  scopeFailure = false,
  storageFailure = false,
  collapsed = false,
  controlFailure = false,
  loading = false,
  status,
  reconnectRequired = false,
  resetting = false,
  diagnosis = "success",
}: {
  failure?: boolean
  scopeFailure?: boolean
  storageFailure?: boolean
  collapsed?: boolean
  controlFailure?: boolean
  loading?: boolean
  status?: PanelState["status"]
  reconnectRequired?: boolean
  resetting?: boolean
  diagnosis?: "success" | "pending" | "failed"
}) {
  const controller = createControls(declaration)
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [open, setOpen] = useState(true)
  const [clicks, setClicks] = useState(0)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed,
    collapsedGroups: {},
  })
  const [failed, setFailed] = useState(failure)
  const [storageFailed, setStorageFailed] = useState(storageFailure)
  const [controlFailed, setControlFailed] = useState(controlFailure)
  const scope = scopeProjection(controller)
  if (controlFailed)
    scope.snapshot = {
      ...scope.snapshot,
      bindings: {
        title: {
          error: 'The app API "headerPreview" is unavailable.',
          available: false,
          busy: false,
        },
        showNotes: { error: "The binding target is missing.", available: false, busy: false },
      },
    }
  const state: PanelState = {
    runtimeAvailable: !failed,
    status: status ?? (failed ? "missing-runtime" : "ready"),
    scopes: failed || status ? [] : [scope],
    scopeErrors: scopeFailure
      ? [{ scope: "brokenPage", error: "The title default exceeds maxLength." }]
      : [],
    loading,
    resetting,
    reconnectRequired,
    error: failed
      ? copy.controlsLocalConnectionFailed
      : reconnectRequired
        ? "The controls command limit was reached. Retry the connection to continue."
        : "",
    storageError: storageFailed ? copy.controlsLocalStorageFailed : "",
    notice: "",
  }
  return (
    <div className="controls-panel-example">
      <header className="controls-panel-example__toolbar">
        <Text size="100">Prototype preview</Text>
        <ControlsToggle open={open} onToggle={() => setOpen(!open)} />
      </header>
      <div className="controls-panel-example__preview">
        <div className="controls-panel-example__content">
          <Text as="strong" size="300">
            {snapshot.values.title}
          </Text>
          {snapshot.values.showNotes ? (
            <Text as="p" size="100" variant="muted">
              {snapshot.values.note}
            </Text>
          ) : null}
          <Text as="p" size="100">
            Layout: {snapshot.values.layout}
          </Text>
          <Text as="p" size="100" variant="muted">
            {snapshot.values.footer}
          </Text>
          <Button size="small" onClick={() => setClicks(clicks + 1)}>
            Preview clicks: {clicks}
          </Button>
          {controlFailed ? (
            <Button size="small" onClick={() => setControlFailed(false)}>
              Recover bindings
            </Button>
          ) : null}
          <Text as="p" size="100" variant="muted">
            Drag the handle, collapse the panel or its group, and use the preview button. Dismiss
            and reopen through the toolbar icon.
          </Text>
        </div>
        {open ? (
          <ControlsPanel
            state={state}
            layout={layout}
            onLayoutChange={setLayout}
            onDiagnose={() => {
              if (diagnosis === "pending") return new Promise(() => {})
              if (diagnosis === "failed")
                return Promise.reject(new Error("Could not reach Copilot. Try again."))
              return Promise.resolve({ requested: true })
            }}
            connection={{
              retry: () => {
                setFailed(false)
                setStorageFailed(false)
              },
              resetAll: () => {
                controller.reset()
                return Promise.resolve()
              },
              command: (operation, _scope, id, value) => {
                if (operation !== "update" || !id)
                  return Promise.reject(new Error("This example only declares value controls."))
                const values = { [id]: value }
                if (!validControlsValues(values) || values[id] === undefined)
                  return Promise.reject(new Error("Invalid example control value."))
                controller.restore(values)
                return Promise.resolve({ value: scopeProjection(controller).snapshot.values[id] })
              },
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

const meta = {
  title: "Prototype canvas/Controls panel",
  component: PanelExample,
  parameters: { layout: "padded" },
  args: { failure: false },
} satisfies Meta<typeof PanelExample>

export default meta
type Story = StoryObj<typeof meta>

export const Movable: Story = {}
export const Empty: Story = {
  args: { status: "no-controls" },
  parameters: {
    docs: {
      description: {
        story:
          "The empty panel keeps its explanation above a left-aligned green Learn more link with an external-link icon. The link is vertically centered in the gray footer and retains its keyboard focus outline in both themes.",
      },
    },
  },
}
export const Collapsed: Story = { args: { collapsed: true } }
export const ConnectionFailure: Story = { args: { failure: true } }
export const StorageFailure: Story = { args: { storageFailure: true } }
export const ScopeFailure: Story = { args: { scopeFailure: true } }
export const ControlFailure: Story = { args: { controlFailure: true } }
export const Loading: Story = { args: { controlFailure: true, loading: true } }
export const UnsupportedRuntime: Story = {
  args: { status: "unsupported-runtime", failure: true },
}
export const InvalidConfiguration: Story = { args: { status: "invalid-config" } }
export const ReconnectionRequired: Story = { args: { reconnectRequired: true } }
export const Resetting: Story = { args: { resetting: true } }
export const DiagnosisPending: Story = {
  args: { failure: true, diagnosis: "pending" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Diagnose with Copilot" }))
  },
}
export const DiagnosisRequested: Story = {
  args: { failure: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Diagnose with Copilot" }))
    await canvas.findByRole("button", { name: "Requested in chat" })
  },
}
export const DiagnosisFailed: Story = {
  args: { failure: true, diagnosis: "failed" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Diagnose with Copilot" }))
    await canvas.findByText("Could not reach Copilot. Try again.")
  },
}
export const PageSpecific: Story = { render: () => <PageControlsExample /> }
export const AllControls: Story = {
  render: () => <AllControlsExample />,
  parameters: {
    docs: {
      description: {
        story:
          "Editable fields stay flat; dropdowns and action buttons have a soft raised shadow. Reset stays visible in the header, including when collapsed, and is disabled until controls or saved settings can be reset. Segmented controls share the muted input and dropdown border, with muted unselected labels and matching light borders on the selected segment and slider thumb. Ghost disclosures stay flat and focused controls retain their normal focus treatment.",
      },
    },
  },
}
