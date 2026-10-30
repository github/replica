import { Button, Heading, Text } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useState, useSyncExternalStore } from "react"

import { createControls, type Declaration } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { validControlsValues } from "@utils/prototype-controls-protocol/valid-values"
import { ControlsPanel } from "../prototype-controls-panel"
import type { ControlsPanelLayout } from "../prototype-controls-panel/types"
import { ControlsFields } from "./index"

import "./stories.css"

const declaration: Declaration = {
  version: 1,
  scope: "canvasFieldsStory",
  groups: [{ id: "details", label: "Details", when: { control: "enabled", equals: true } }],
  controls: [
    { id: "enabled", label: "Show details", type: "boolean", default: true },
    { id: "count", label: "Item count", type: "number", default: 2, min: 0, max: 10 },
    { id: "layout", label: "Layout", type: "select", default: "list", options: ["list", "grid"] },
    {
      id: "detail",
      label: "Detail level",
      type: "radio",
      default: "low",
      options: ["low", "high"],
    },
    { id: "variant", label: "Variant", type: "segmented", default: "A", options: ["A", "B"] },
    { id: "opacity", label: "Opacity", type: "slider", default: 1, min: 0, max: 1, step: 0.1 },
    {
      id: "features",
      label: "Features",
      type: "checkboxGroup",
      default: [],
      options: ["badges", "dates"],
    },
    { id: "title", label: "Title", type: "text", default: "Preview", group: "details" },
    {
      id: "description",
      label: "Description",
      type: "textarea",
      default: "Working controls",
      group: "details",
    },
    { id: "accent", label: "Accent", type: "color", default: "#336699" },
    { id: "increment", label: "Add item", type: "button" },
  ],
}

const conditionalDeclaration: Declaration = {
  version: 1,
  scope: "conditionalFieldsStory",
  groups: [
    { id: "variantA", label: "Variant A", when: { control: "variant", equals: "A" } },
    { id: "variantB", label: "Variant B", when: { control: "variant", equals: "B" } },
  ],
  controls: [
    { id: "variant", label: "Variant", type: "segmented", options: ["A", "B"], default: "A" },
    { id: "heading", label: "Heading", type: "text", default: "Simple layout", group: "variantA" },
    { id: "title", label: "Title", type: "text", default: "Detailed layout", group: "variantB" },
    {
      id: "count",
      label: "Item count",
      type: "number",
      default: 3,
      min: 0,
      max: 10,
      group: "variantB",
    },
    { id: "badges", label: "Show badges", type: "boolean", default: true, group: "variantB" },
  ],
}

const actionDeclaration: Declaration = {
  version: 1,
  scope: "actionFieldsStory",
  controls: [
    { id: "fail", label: "Simulate an error", type: "boolean", default: false },
    { id: "result", label: "Result", type: "text", default: "Not run yet" },
    {
      id: "layout",
      label: "Layout",
      type: "select",
      default: "List",
      options: ["List", "Grid"],
    },
    { id: "simulate", label: "Run example action", type: "button" },
    { id: "unavailable", label: "Action without a handler", type: "button" },
  ],
}

const longLabelsDeclaration: Declaration = {
  version: 1,
  scope: "longLabelsFieldsStory",
  controls: [
    {
      id: "segments",
      label: "Long labels in segments (avoid)",
      type: "segmented",
      options: ["Comfortable reading layout", "Compact information layout"],
      default: "Comfortable reading layout",
    },
    {
      id: "dropdown",
      label: "Long labels in a dropdown (recommended)",
      type: "select",
      options: ["Comfortable reading layout", "Compact information layout"],
      default: "Comfortable reading layout",
    },
  ],
}

const numericLabelsDeclaration: Declaration = {
  version: 1,
  scope: "numericLabelsFieldsStory",
  controls: [
    { id: "count", label: "Item count", type: "number", default: 3, min: 0, max: 100 },
    {
      id: "longCount",
      label: "Maximum number of notes visible in the current preview",
      type: "number",
      default: 12,
      min: 0,
      max: 100,
    },
    { id: "opacity", label: "Opacity", type: "slider", default: 1, min: 0, max: 1, step: 0.1 },
    {
      id: "longOpacity",
      label: "Opacity of the cards displayed in the current preview",
      type: "slider",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
    },
  ],
}

const choiceRowsDeclaration: Declaration = {
  version: 1,
  scope: "choiceRowsFieldsStory",
  controls: [
    {
      id: "layout",
      label: "Layout",
      type: "select",
      options: ["List", "Grid"],
      default: "List",
    },
    {
      id: "longOption",
      label: "Layout options",
      type: "select",
      options: ["List", "A detailed grid with additional information"],
      default: "List",
    },
    {
      id: "longTitle",
      label: "Layout of the notes displayed in the current preview",
      type: "select",
      options: ["List", "Grid"],
      default: "List",
    },
    {
      id: "alignment",
      label: "Alignment",
      type: "radio",
      options: ["Left", "Center", "Center all the notes and their descriptions in the preview"],
      default: "Left",
    },
  ],
}

function FieldsExample({
  definition = declaration,
  description = "Try every control type. Changes immediately update the live values on the right.",
}: {
  definition?: Declaration
  description?: string
}) {
  const controller = createControls(definition)
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const [error, setError] = useState("")
  useEffect(
    () =>
      controller.mount(() => ({
        increment: () => {
          const count = controller.getSnapshot().values.count
          if (typeof count !== "number") throw new Error("Item count must be a number.")
          controller.update("count", count + 1)
        },
        simulate: async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
          if (controller.getSnapshot().values.fail)
            throw new Error("The example action failed. Turn off Simulate an error and try again.")
          controller.update("result", "Action completed")
        },
      })),
    [controller],
  )
  return (
    <div className="controls-example">
      <header className="controls-example__header">
        <Heading as="h2" size="5">
          Prototype controls
        </Heading>
        <Text as="p" size="100" variant="muted">
          {description}
        </Text>
        <Button
          type="button"
          size="small"
          variant="secondary"
          onClick={() => {
            controller.reset()
            setError("")
          }}
        >
          Reset example
        </Button>
        {error ? (
          <Text as="p" size="100" role="alert">
            {error}
          </Text>
        ) : null}
      </header>
      <div className="controls-example__columns">
        <div className="controls-example__fields">
          <ControlsFields
            scopes={[scopeProjection(controller)]}
            onCommand={async (operation, _scope, id, value) => {
              setError("")
              if (operation === "action") {
                try {
                  await controller.action(id)
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "The example action failed.")
                }
                return
              }
              const values = { [id]: value }
              if (!validControlsValues(values) || values[id] === undefined)
                throw new Error("Invalid story control value.")
              controller.update(id, values[id])
              return { value: controller.getSnapshot().values[id] }
            }}
          />
        </div>
        <aside className="controls-example__values" aria-label="Live prototype values">
          <Heading as="h3" size="6">
            Live prototype values
          </Heading>
          <Text as="p" size="100" variant="muted">
            Hidden fields reset to their defaults. Switching back does not restore their old values.
          </Text>
          <dl>
            {definition.controls
              .filter((control) => control.type !== "button")
              .map((control) => (
                <div key={control.id}>
                  <dt>
                    {control.label}
                    {!snapshot.visible[control.id] ? " (hidden, reset to default)" : ""}
                  </dt>
                  <dd>{JSON.stringify(snapshot.values[control.id])}</dd>
                </div>
              ))}
          </dl>
        </aside>
      </div>
    </div>
  )
}

const meta = {
  title: "Prototype canvas/Controls fields",
  component: ControlsFields,
  parameters: { layout: "padded" },
  render: () => <FieldsExample />,
} satisfies Meta<typeof ControlsFields>

export default meta
type Story = StoryObj<typeof meta>
export const AllFields: Story = {
  args: {
    scopes: [],
    onCommand: () => undefined,
  },
}

export const DarkAllFields: Story = {
  ...AllFields,
  globals: { colorMode: "night" },
}

export const ConditionalFields = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => (
    <FieldsExample
      definition={conditionalDeclaration}
      description="Choose A for one field or B for three. Edit a field, switch variants, then switch back to see its default restored."
    />
  ),
} satisfies Story

export const Actions = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => (
    <FieldsExample
      definition={actionDeclaration}
      description="Compare the action's smaller text, resting colors and subtle two-layer bottom shadow with Layout; Reset example keeps standard button styling. Run the one-second action to see its busy state, or toggle Simulate an error to see a failure. Actions without a handler are disabled."
    />
  ),
} satisfies Story

export const LongLabels = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => (
    <FieldsExample
      definition={longLabelsDeclaration}
      description="Prefer a dropdown for long labels. Segments stay on one line and truncate when needed; their full labels remain available to assistive technology and on hover."
    />
  ),
} satisfies Story

export const NumericLabels = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => (
    <FieldsExample
      definition={numericLabelsDeclaration}
      description="Small labels sit above number inputs and editable slider values. Try short and long titles at a narrow viewport."
    />
  ),
} satisfies Story

export const ChoiceRows = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => (
    <FieldsExample
      definition={choiceRowsDeclaration}
      description="Small labels sit above dropdowns sized to their widest option, not the selected value. Radio markers center against both short and multiline labels."
    />
  ),
} satisfies Story

function ScopeDividersExample({ inPanel = false }: { inPanel?: boolean }) {
  const [controllers] = useState(() => {
    const definitions: Declaration[] = [
      {
        version: 1,
        scope: "copilot",
        role: "shared",
        groups: [{ id: "copilot", label: "Copilot" }],
        controls: [
          {
            id: "previewTitle",
            label: "Preview title",
            type: "text",
            default: "Prototype preview",
          },
          {
            id: "milestone",
            label: "Milestone",
            type: "segmented",
            default: "GA",
            options: ["GA", "Universe", "Post Universe"],
            group: "copilot",
          },
        ],
      },
      {
        version: 1,
        scope: "copilot-onboarding",
        role: "shared",
        groups: [{ id: "onboarding", label: "Copilot onboarding" }],
        controls: [
          { id: "resetOnboarding", label: "Reset onboarding", type: "button", group: "onboarding" },
        ],
      },
      {
        version: 1,
        scope: "new-task-input",
        groups: [{ id: "composer", label: "Composer" }],
        controls: [
          {
            id: "selectorLoading",
            label: "Selector loading",
            type: "boolean",
            default: false,
            group: "composer",
          },
        ],
      },
      {
        version: 1,
        scope: "dashboard",
        groups: [{ id: "dashboard", label: "Dashboard preview" }],
        controls: [
          {
            id: "composerPlaceholder",
            label: "Composer placeholder",
            type: "text",
            default: "What do you want to build?",
            group: "dashboard",
          },
          {
            id: "greeting",
            label: "Greeting",
            type: "select",
            default: "Automatic",
            options: ["Automatic", "Good morning", "Good afternoon", "Good evening"],
            group: "dashboard",
          },
          {
            id: "sessionCount",
            label: "Session count",
            type: "slider",
            default: 3,
            min: 1,
            max: 10,
            group: "dashboard",
          },
        ],
      },
      { version: 1, scope: "empty", controls: [] },
    ]
    return definitions.map((definition) => createControls(definition))
  })
  const [scopes, setScopes] = useState(() => controllers.map(scopeProjection))
  const [hideDashboard, setHideDashboard] = useState(false)
  const [composerOnly, setComposerOnly] = useState(false)
  const [showUngroupedField, setShowUngroupedField] = useState(false)
  const [layout, setLayout] = useState<ControlsPanelLayout>({
    position: null,
    collapsed: false,
    collapsedGroups: {},
  })
  const visibleScopes = scopes
    .filter(
      (scope) =>
        (!hideDashboard || scope.declaration.scope !== "dashboard") &&
        (!composerOnly || scope.declaration.scope === "new-task-input"),
    )
    .map((scope) =>
      scope.declaration.scope === "copilot"
        ? {
            ...scope,
            snapshot: {
              ...scope.snapshot,
              visible: { ...scope.snapshot.visible, previewTitle: showUngroupedField },
            },
          }
        : scope,
    )
  function command(operation: "update" | "action", scope: string, id: string, value?: unknown) {
    const controller = controllers.find((controller) => controller.declaration.scope === scope)
    if (!controller) throw new Error("Unknown example scope.")
    if (operation !== "update") throw new Error("This example has no action handler.")
    const values = { [id]: value }
    if (!validControlsValues(values) || values[id] === undefined)
      throw new Error("Invalid example control value.")
    controller.update(id, values[id])
    setScopes(controllers.map(scopeProjection))
    return { value: controller.getSnapshot().values[id] }
  }
  return (
    <div className="controls-example">
      <header className="controls-example__header">
        <Text as="p" size="100">
          Four grouped scopes followed by an empty scope. Fold groups or hide Dashboard: each
          visible boundary has one divider and the final scope has no trailing divider. Every
          heading has the same top and bottom padding, including Composer on its own.
        </Text>
        <Button size="small" onClick={() => setHideDashboard(!hideDashboard)}>
          {hideDashboard ? "Show Dashboard" : "Hide Dashboard"}
        </Button>
        <Button size="small" onClick={() => setComposerOnly(!composerOnly)}>
          {composerOnly ? "Show all scopes" : "Show Composer only"}
        </Button>
        <Button
          size="small"
          disabled={composerOnly}
          onClick={() => setShowUngroupedField(!showUngroupedField)}
        >
          {showUngroupedField ? "Hide ungrouped field" : "Show ungrouped field"}
        </Button>
      </header>
      <div className={inPanel ? "controls-scope-panel-example" : "controls-example__fields"}>
        {inPanel ? (
          <ControlsPanel
            state={{
              runtimeAvailable: true,
              status: "ready",
              scopes: visibleScopes,
              loading: false,
              resetting: false,
              error: "",
              storageError: "",
              notice: "",
            }}
            layout={layout}
            onLayoutChange={setLayout}
            connection={{
              command: (operation, scope, id, value) => {
                if (!id) throw new Error("Missing example control ID.")
                if (operation === "reset")
                  throw new Error("Use Reset all controls in this example.")
                return Promise.resolve(command(operation, scope, id, value))
              },
              retry: () => undefined,
              resetAll: () => {
                controllers.forEach((controller) => controller.reset())
                setScopes(controllers.map(scopeProjection))
                return Promise.resolve()
              },
            }}
          />
        ) : (
          <ControlsFields scopes={visibleScopes} onCommand={command} />
        )}
      </div>
    </div>
  )
}

export const ScopeDividers = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => <ScopeDividersExample />,
} satisfies Story

export const ScopeDividersPanel = {
  args: { scopes: [], onCommand: () => undefined },
  render: () => <ScopeDividersExample inPanel />,
} satisfies Story
