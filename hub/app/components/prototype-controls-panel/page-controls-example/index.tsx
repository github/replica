import { Button, Text } from "@primer/react-brand"
import { useEffect, useState } from "react"

import {
  createControls,
  getControlsRuntime,
  validateControls,
} from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { validControlsValues } from "@utils/prototype-controls-protocol/valid-values"
import { nonDefaultValues } from "@utils/prototype-controls-url/non-default-values"
import { ControlsPanel } from ".."
import { ControlsToggle } from "../../prototype-controls-toggle"
import type { ControlsPanelLayout } from "../types"
import { MountedPreview } from "./mounted-preview"

const document = {
  version: 1,
  sets: [
    {
      version: 1,
      scope: "pageExampleShared",
      label: "Shared",
      role: "shared",
      panel: { width: 480 },
      controls: [
        { id: "showNavigation", label: "Show navigation", type: "boolean", default: true },
        {
          id: "navigationLabel",
          label: "Navigation label",
          type: "text",
          default: "Primary navigation",
        },
      ],
    },
    {
      version: 1,
      scope: "pageExampleDashboard",
      label: "Dashboard",
      role: "page",
      panel: { width: 320 },
      groups: [
        { id: "content", label: "Content" },
        { id: "appearance", label: "Appearance" },
      ],
      controls: [
        { id: "title", label: "Dashboard title", type: "text", default: "My dashboard" },
        {
          id: "itemCount",
          label: "Item count",
          type: "number",
          default: 3,
          min: 1,
          max: 12,
          group: "content",
        },
        {
          id: "showBadges",
          label: "Show badges",
          type: "boolean",
          default: true,
          group: "content",
        },
        {
          id: "layout",
          label: "Layout",
          type: "select",
          options: ["list", "grid"],
          default: "list",
          group: "appearance",
        },
        {
          id: "density",
          label: "Density",
          type: "segmented",
          options: ["comfortable", "compact"],
          default: "comfortable",
          group: "appearance",
        },
        { id: "footer", label: "Footer", type: "text", default: "Dashboard footer" },
        { id: "showChangelog", label: "Show changelog", type: "boolean", default: true },
      ],
    },
    {
      version: 1,
      scope: "pageExampleDetails",
      label: "Details",
      role: "page",
      panel: { width: 440 },
      controls: [{ id: "title", label: "Details title", type: "text", default: "Item details" }],
    },
  ],
} as const
for (const declaration of document.sets) validateControls(declaration)
const shared = createControls(document.sets[0])
const dashboard = createControls(document.sets[1])
const details = createControls(document.sets[2])
const controllers = [shared, dashboard, details]

export function PageControlsExample() {
  const [page, setPage] = useState<"dashboard" | "details">("dashboard")
  const [open, setOpen] = useState(true)
  const [, refresh] = useState(0)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  useEffect(() => {
    function update() {
      refresh((revision) => revision + 1)
    }
    const releases = [
      getControlsRuntime().subscribe(update),
      ...controllers.map((controller) => controller.subscribe(update)),
    ]
    update()
    return () => {
      for (const release of releases) release()
    }
  }, [])
  const scopes = controllers
    .filter((controller) => controller.mountedCount > 0)
    .map(scopeProjection)
  return (
    <div className="controls-panel-example">
      <header className="controls-panel-example__toolbar">
        <Button size="small" variant="subtle" onClick={() => setPage("dashboard")}>
          Dashboard page
        </Button>
        <Button size="small" variant="subtle" onClick={() => setPage("details")}>
          Details page
        </Button>
        <ControlsToggle open={open} onToggle={() => setOpen(!open)} />
      </header>
      <div className="controls-panel-example__preview">
        <div className="controls-panel-example__content">
          <Text as="p" size="100" variant="muted">
            Page buttons mount different page components; the shared layout stays mounted. Dashboard
            requests 320px, Details 440px, and both override the shared 480px width.
          </Text>
          <MountedPreview controller={shared} />
          <MountedPreview key={page} controller={page === "dashboard" ? dashboard : details} />
        </div>
        {open ? (
          <ControlsPanel
            layout={layout}
            onLayoutChange={setLayout}
            state={{
              runtimeAvailable: true,
              status: scopes.length ? "ready" : "no-controls",
              scopes,
              loading: false,
              resetting: false,
              error: "",
              storageError: "",
              notice: "",
              hasResettableValues: controllers.some(
                (controller) =>
                  Object.keys(nonDefaultValues(scopeProjection(controller))).length > 0,
              ),
            }}
            connection={{
              retry: () => refresh((revision) => revision + 1),
              resetAll: () => {
                for (const controller of controllers) controller.reset()
                return Promise.resolve()
              },
              command: (operation, scope, id, value) => {
                const controller = controllers.find(
                  (controller) => controller.declaration.scope === scope,
                )
                if (operation !== "update" || !controller || !id)
                  return Promise.reject(new Error("Unknown page example control command."))
                const values = { [id]: value }
                if (!validControlsValues(values) || values[id] === undefined)
                  return Promise.reject(new Error("Invalid page example value."))
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
