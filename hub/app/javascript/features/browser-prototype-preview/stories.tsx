import { useRef, useState, useSyncExternalStore } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import type { ControlsPanelLayout } from "@components/prototype-controls-panel/types"
import { createControls } from "@utils/prototype-controls/controls.mjs"
import type { PanelState } from "@utils/prototype-controls-connection"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"

import { BrowserPrototypePreviewSurface } from "."
import "@application/prototype-canvas/styles.css"

function BrowserPreviewExample({
  minimized = false,
  status = "ready",
}: {
  minimized?: boolean
  status?: PanelState["status"]
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const shellRef = useRef<HTMLElement>(null)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: minimized,
    collapsedGroups: {},
  })
  const [controller] = useState(() =>
    createControls({
      version: 1,
      scope: "signalRoom",
      controls: [
        { id: "title", label: "Headline", type: "text", default: "A room for ideas in motion." },
      ],
    }),
  )
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  function applyHeadline() {
    const heading = frameRef.current?.contentDocument?.querySelector("h1")
    if (heading) heading.textContent = String(controller.getSnapshot().values.title)
  }
  return (
    <BrowserPrototypePreviewSurface
      name="Signal room"
      source="/prototype-preview/templates/signal-room.html"
      frameKey={0}
      frameRef={frameRef}
      shellRef={shellRef}
      onFrameLoad={applyHeadline}
      appearance="light"
      state={{
        runtimeAvailable: currentStatus === "ready",
        status: currentStatus,
        scopes: currentStatus === "ready" ? [scopeProjection(controller)] : [],
        loading: currentStatus === "missing-runtime",
        notice: "",
        error:
          currentStatus === "unsupported-runtime"
            ? "The preview Options runtime is incompatible."
            : "",
        storageError: "",
        resetting: false,
      }}
      connection={{
        command: (operation, _scope, id, value) => {
          if (operation !== "update" || id !== "title" || typeof value !== "string")
            return Promise.reject(new Error("This preview only supports headline edits."))
          controller.update(id, value)
          applyHeadline()
          return Promise.resolve({
            value: controller.getSnapshot().values.title,
          })
        },
        retry: () => setCurrentStatus("ready"),
        resetAll: () => {
          controller.reset()
          applyHeadline()
          return Promise.resolve()
        },
      }}
      layout={layout}
      onLayoutChange={setLayout}
    />
  )
}

const meta = {
  title: "Prototype canvas/Browser preview",
  component: BrowserPreviewExample,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BrowserPreviewExample>

export default meta
type Story = StoryObj<typeof meta>

export const Expanded: Story = {}
export const Minimized: Story = { args: { minimized: true } }
export const NoOptions: Story = { args: { status: "no-controls" } }
export const ConnectionFailure: Story = {
  args: { status: "unsupported-runtime" },
}
