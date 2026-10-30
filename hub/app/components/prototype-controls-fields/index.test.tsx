import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { ControlsFields } from "."
import styles from "./styles.css?inline"

const groupedScopes = ["Composer", "Dashboard preview"].map((label) =>
  createControls({
    version: 1,
    scope: label === "Composer" ? "composer" : "dashboard",
    label,
    groups: [{ id: "preview", label }],
    controls: [
      { id: "title", label: `${label} title`, type: "text", default: label, group: "preview" },
    ],
  }),
)

function dividerTargets(container: HTMLElement) {
  const borderSelectors = [...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].flatMap(
    ([, selector, body]) => (selector && body?.includes("border-top:") ? [selector.trim()] : []),
  )
  return [...container.querySelectorAll(borderSelectors.join(","))]
}

function authoredStyles(element: Element) {
  const properties: Record<string, string> = {}
  for (const [, selector, body] of styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    if (!selector || !body || selector.includes("::") || !element.matches(selector.trim())) continue
    for (const [, name, value] of body.matchAll(/([\w-]+):\s*([^;]+);/g)) {
      if (name && value) properties[name] = value.trim()
    }
  }
  return properties
}

function headingInsets(group: Element) {
  const properties = authoredStyles(group)
  return {
    "--controls-group-heading-inset": properties["--controls-group-heading-inset"],
    "--controls-group-heading-bottom-inset": properties["--controls-group-heading-bottom-inset"],
  }
}

describe("ControlsFields()", () => {
  it("allows retry after app rejection while disabling an unavailable binding", () => {
    const controller = createControls({
      version: 1,
      scope: "bindingAvailability",
      controls: [
        { id: "clamped", label: "Clamped", type: "text", default: "Actual" },
        { id: "missing", label: "Missing", type: "text", default: "Default" },
      ],
    })
    controller.bindingStatus("clamped", "The app adjusted this value.", false, true)
    controller.bindingStatus("missing", "The field is missing.")
    render(
      <ThemeProvider>
        <ControlsFields scopes={[scopeProjection(controller)]} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("textbox", { name: "Clamped" })).toBeEnabled()
    expect(screen.getByRole("textbox", { name: "Missing" })).toBeDisabled()
    expect(screen.getByText("Clamped could not be applied")).toBeVisible()
    expect(screen.getByText("Missing is unavailable")).toBeVisible()
  })
  it.each([false, true])(
    "keeps segmented labels muted unless selected and enabled when disabled is %s",
    (disabled) => {
      const controller = createControls({
        version: 1,
        scope: "segmentStylingTest",
        controls: [
          {
            id: "density",
            label: "Density",
            type: "segmented",
            options: ["Comfortable", "Compact"],
            default: "Comfortable",
          },
        ],
      })
      render(
        <ThemeProvider>
          <ControlsFields
            scopes={[scopeProjection(controller)]}
            disabled={disabled}
            onCommand={() => undefined}
          />
        </ThemeProvider>,
      )
      for (const name of ["Comfortable", "Compact"]) {
        const label = screen.getByRole("radio", { name }).closest(".controls-segment")
        const text = label?.querySelector(":scope > span:last-child")
        if (!label || !text) throw new Error("A segmented option needs a label and text.")
        const properties = authoredStyles(label)
        expect(properties["border"]).toBe("var(--brand-borderWidth-thin) solid transparent")
        expect(properties["color"]).toBe(
          name === "Comfortable" && !disabled ? "var(--hub-fg-default)" : "var(--hub-fg-muted)",
        )
        expect(authoredStyles(text)["color"]).toBe("inherit")
        expect(properties["border-color"]).toBe(
          name === "Comfortable" ? "var(--hub-border-muted)" : undefined,
        )
      }
    },
  )

  it("fills boundary gaps once without pulling the first header outside its layout", () => {
    render(
      <ThemeProvider colorMode="auto">
        <ControlsFields scopes={groupedScopes.map(scopeProjection)} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    const first = screen.getByRole("group", { name: "Composer" })
    const last = screen.getByRole("group", { name: "Dashboard preview" })
    expect(authoredStyles(first)["margin-top"]).toBeUndefined()
    expect(authoredStyles(last)["margin-top"]).toBe(
      "calc(-1 * var(--controls-group-heading-inset))",
    )
    for (const group of [first, last]) {
      const toggle = within(group).getByRole("button")
      const styles = authoredStyles(toggle)
      expect(styles["margin-top"]).toBeUndefined()
      expect(styles["padding-top"]).toBe("var(--controls-group-heading-inset)")
      expect(styles["padding-bottom"]).toBe("var(--controls-group-heading-bottom-inset)")
      expect(styles["margin-bottom"]).toBe("calc(-1 * var(--controls-group-heading-bottom-inset))")
      const legend = group.querySelector("legend")
      if (!legend) throw new Error("The group heading must have a legend.")
      expect(authoredStyles(legend)["padding"]).toBe("0")
      expect(authoredStyles(legend)["padding-top"]).toBeUndefined()
    }
  })

  it.each([false, true])(
    "gives first, last and single-scope headings uniform padding when collapsed is %s",
    (collapsed) => {
      const { container, rerender } = render(
        <ThemeProvider colorMode="auto">
          <ControlsFields
            scopes={groupedScopes.map(scopeProjection)}
            collapsedGroups={{ "composer/preview": collapsed, "dashboard/preview": collapsed }}
            onCommand={() => undefined}
          />
        </ThemeProvider>,
      )
      const expected = {
        "--controls-group-heading-inset": "var(--hub-space-8)",
        "--controls-group-heading-bottom-inset": "var(--hub-space-8)",
      }
      for (const group of container.querySelectorAll(".controls-group")) {
        expect(headingInsets(group)).toEqual(expected)
      }
      rerender(
        <ThemeProvider colorMode="auto">
          <ControlsFields
            scopes={groupedScopes.slice(0, 1).map(scopeProjection)}
            collapsedGroups={{ "composer/preview": collapsed }}
            onCommand={() => undefined}
          />
        </ThemeProvider>,
      )
      expect(headingInsets(screen.getByRole("group", { name: "Composer" }))).toEqual(expected)
      expect(dividerTargets(container)).toHaveLength(0)
    },
  )

  it("paints one boundary between grouped scopes and none after the last group", () => {
    const { container } = render(
      <ThemeProvider colorMode="auto">
        <ControlsFields scopes={groupedScopes.map(scopeProjection)} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    const painted = dividerTargets(container)
    expect(painted.map((element) => element.className || element.tagName)).toEqual([
      "controls-scope-divider",
    ])
  })

  it("omits empty scopes before, between and after visible scopes as visibility changes", () => {
    const empty = createControls({ version: 1, scope: "empty", role: "shared", controls: [] })
    const hiddenField = scopeProjection(
      createControls({
        version: 1,
        scope: "hiddenField",
        controls: [{ id: "show", label: "Show", type: "boolean", default: false }],
      }),
    )
    hiddenField.snapshot = {
      ...hiddenField.snapshot,
      visible: { show: false },
    }
    let hiddenGroup = scopeProjection(
      createControls({
        version: 1,
        scope: "hiddenGroup",
        groups: [{ id: "hidden", label: "Hidden" }],
        controls: [
          {
            id: "show",
            label: "Show hidden group",
            type: "boolean",
            default: false,
            group: "hidden",
          },
        ],
      }),
    )
    hiddenGroup = {
      ...hiddenGroup,
      snapshot: {
        ...hiddenGroup.snapshot,
        groups: { hidden: false },
        visible: { show: false },
      },
    }
    function example() {
      return (
        <ThemeProvider colorMode="auto">
          <ControlsFields
            scopes={[
              scopeProjection(empty),
              ...groupedScopes.flatMap((controller, index) => [
                scopeProjection(controller),
                index === 0 ? hiddenField : hiddenGroup,
              ]),
            ]}
            onCommand={() => undefined}
          />
        </ThemeProvider>
      )
    }
    const { container, rerender } = render(example())
    expect(
      [...container.querySelectorAll(".controls-scope")].map((scope) =>
        scope.getAttribute("aria-label"),
      ),
    ).toEqual(["Composer", "Dashboard preview"])
    expect(screen.getAllByRole("separator")).toHaveLength(1)
    expect(dividerTargets(container)).toEqual(screen.getAllByRole("separator"))
    const title = screen.getByRole("textbox", { name: "Dashboard preview title" })
    fireEvent.click(screen.getByRole("button", { name: "Collapse Dashboard preview" }))
    expect(title).not.toBeVisible()
    expect(screen.getAllByRole("separator")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Expand Dashboard preview" }))
    expect(title).toBeVisible()
    hiddenGroup = {
      ...hiddenGroup,
      snapshot: {
        ...hiddenGroup.snapshot,
        groups: { hidden: true },
        visible: { show: true },
      },
    }
    rerender(example())
    expect(screen.getAllByRole("separator")).toHaveLength(2)
    hiddenGroup = {
      ...hiddenGroup,
      snapshot: {
        ...hiddenGroup.snapshot,
        groups: { hidden: false },
        visible: { show: false },
      },
    }
    rerender(example())
    expect(screen.getAllByRole("separator")).toHaveLength(1)
    expect(container.querySelector(".controls-scope:last-child")?.lastElementChild).toHaveClass(
      "controls-group",
    )
  })

  it("shares boundaries between groups and ungrouped fields without a trailing group border", () => {
    const controller = createControls({
      version: 1,
      scope: "mixed",
      groups: [
        { id: "first", label: "First" },
        { id: "adjacent", label: "Adjacent" },
        { id: "last", label: "Last" },
      ],
      controls: [
        { id: "above", label: "Above", type: "text", default: "" },
        { id: "firstTitle", label: "First title", type: "text", default: "", group: "first" },
        {
          id: "adjacentTitle",
          label: "Adjacent title",
          type: "text",
          default: "",
          group: "adjacent",
        },
        { id: "between", label: "Between", type: "text", default: "" },
        { id: "lastTitle", label: "Last title", type: "text", default: "", group: "last" },
      ],
    })
    const { container } = render(
      <ThemeProvider colorMode="auto">
        <ControlsFields scopes={[scopeProjection(controller)]} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    expect(dividerTargets(container)).toEqual([
      screen.getByRole("group", { name: "First" }).querySelector("legend"),
      screen.getByRole("group", { name: "Adjacent" }).querySelector("legend"),
      screen.getByRole("textbox", { name: "Between" }).closest(".controls-field"),
      screen.getByRole("group", { name: "Last" }).querySelector("legend"),
    ])
    for (const group of container.querySelectorAll(".controls-group")) {
      expect(headingInsets(group)).toEqual({
        "--controls-group-heading-inset": "var(--hub-space-8)",
        "--controls-group-heading-bottom-inset": "var(--hub-space-8)",
      })
    }
  })

  it("keeps visible group headings with hidden fields and omits wholly empty collections", () => {
    const scope = scopeProjection(
      createControls({
        version: 1,
        scope: "headingOnly",
        groups: [{ id: "heading", label: "Heading only" }],
        controls: [
          { id: "title", label: "Hidden title", type: "text", default: "", group: "heading" },
        ],
      }),
    )
    scope.snapshot = { ...scope.snapshot, visible: { title: false } }
    const { container, rerender } = render(
      <ThemeProvider colorMode="auto">
        <ControlsFields scopes={[scope]} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    expect(screen.getByRole("button", { name: "Collapse Heading only" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(dividerTargets(container)).toHaveLength(0)
    rerender(
      <ThemeProvider colorMode="auto">
        <ControlsFields scopes={[]} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    expect(container.querySelectorAll(".controls-scope")).toHaveLength(0)
    expect(dividerTargets(container)).toHaveLength(0)
  })

  it("preserves toolbar and preview focus when a historically focused field disappears", () => {
    const controller = createControls({
      version: 1,
      scope: "outsideFocus",
      controls: [
        { id: "show", label: "Show title", type: "boolean", default: true },
        {
          id: "title",
          label: "Title",
          type: "text",
          default: "Title",
          when: { control: "show", equals: true },
        },
      ],
    })
    function example() {
      return (
        <ThemeProvider colorMode="auto">
          <button type="button">Toolbar</button>
          <iframe title="Preview" />
          <ControlsFields scopes={[scopeProjection(controller)]} onCommand={() => undefined} />
        </ThemeProvider>
      )
    }
    const { rerender } = render(example())
    const toolbar = screen.getByRole("button", { name: "Toolbar" })
    screen.getByRole("textbox", { name: "Title" }).focus()
    toolbar.focus()
    controller.update("show", false)
    rerender(example())
    expect(toolbar).toHaveFocus()
    controller.update("show", true)
    rerender(example())
    screen.getByRole("textbox", { name: "Title" }).focus()
    const preview = screen.getByTitle("Preview")
    preview.focus()
    controller.update("show", false)
    rerender(example())
    expect(preview).toHaveFocus()
    controller.update("show", true)
    rerender(example())
    screen.getByRole("textbox", { name: "Title" }).focus()
    controller.update("show", false)
    rerender(example())
    expect(screen.getByRole("region", { name: "Prototype controls" })).toHaveFocus()
  })

  it("puts shared controls first regardless of discovery order and separates scopes without headings", () => {
    const page = scopeProjection(
      createControls({
        version: 1,
        scope: "orderedPage",
        label: "Page",
        controls: [{ id: "title", label: "Page title", type: "text", default: "Page" }],
      }),
    )
    const shared = scopeProjection(
      createControls({
        version: 1,
        scope: "orderedShared",
        label: "Shared",
        role: "shared",
        controls: [{ id: "enabled", label: "Enabled", type: "boolean", default: true }],
      }),
    )
    render(
      <ThemeProvider colorMode="auto">
        <ControlsFields scopes={[page, shared]} onCommand={() => undefined} />
      </ThemeProvider>,
    )
    const sharedRegion = screen.getByRole("region", { name: "Shared" })
    const pageRegion = screen.getByRole("region", { name: "Page" })
    const separator = within(pageRegion).getByRole("separator")
    expect(
      sharedRegion.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)
    expect(
      separator.compareDocumentPosition(within(pageRegion).getByRole("textbox")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
  })
})
