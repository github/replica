import { createRef } from "react"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"

import { BrowserPrototypePreviewSurface } from "."
import type { BrowserPreviewSurfaceProps } from "./types"

describe("BrowserPrototypePreviewSurface()", () => {
  it("only shows Options when visible controls exist, without replacing the preview", () => {
    const controller = createControls({
      version: 1,
      scope: "browserVisibility",
      controls: [{ id: "title", label: "Title", type: "text", default: "Welcome" }],
    })
    const props: BrowserPreviewSurfaceProps = {
      name: "Welcome",
      source: "/preview",
      frameKey: 0,
      frameRef: createRef(),
      shellRef: createRef(),
      appearance: "light",
      state: {
        runtimeAvailable: true,
        status: "no-controls",
        scopes: [],
        loading: false,
        notice: "",
        error: "",
        storageError: "",
        resetting: false,
      },
      connection: { command: vi.fn(), retry: vi.fn(), resetAll: vi.fn() },
      layout: { position: null, collapsed: false, collapsedGroups: {} },
      onLayoutChange: vi.fn(),
    }
    const view = render(<BrowserPrototypePreviewSurface {...props} />)
    const frame = screen.getByTitle("Welcome prototype")
    expect(screen.queryByRole("complementary", { name: "Options" })).not.toBeInTheDocument()

    const ready = {
      ...props.state!,
      status: "ready" as const,
      scopes: [scopeProjection(controller)],
    }
    view.rerender(<BrowserPrototypePreviewSurface {...props} state={ready} />)
    expect(screen.getByRole("textbox", { name: "Title" })).toBeVisible()
    const handle = screen.getByRole("button", { name: "Move options" })
    expect(handle).not.toHaveFocus()
    act(() => handle.focus())
    expect(handle).toHaveFocus()
    expect(screen.getByTitle("Welcome prototype")).toBe(frame)

    const hidden = {
      ...ready,
      scopes: ready.scopes.map((scope) => ({
        ...scope,
        snapshot: { ...scope.snapshot, visible: { title: false } },
      })),
    }
    view.rerender(<BrowserPrototypePreviewSurface {...props} state={hidden} />)
    expect(screen.queryByRole("complementary", { name: "Options" })).not.toBeInTheDocument()
    expect(screen.getByTitle("Welcome prototype")).toBe(frame)
  })

  it("hides startup loading but keeps connection and storage failures visible", () => {
    const props: BrowserPreviewSurfaceProps = {
      name: "Welcome",
      frameKey: 0,
      frameRef: createRef(),
      shellRef: createRef(),
      appearance: "light",
      state: {
        runtimeAvailable: false,
        status: "missing-runtime",
        scopes: [],
        loading: true,
        notice: "",
        error: "",
        storageError: "",
        resetting: false,
      },
      connection: { command: vi.fn(), retry: vi.fn(), resetAll: vi.fn() },
      layout: { position: null, collapsed: false, collapsedGroups: {} },
      onLayoutChange: vi.fn(),
    }
    const view = render(<BrowserPrototypePreviewSurface {...props} />)
    expect(screen.queryByRole("complementary", { name: "Options" })).not.toBeInTheDocument()

    view.rerender(
      <BrowserPrototypePreviewSurface
        {...props}
        state={{ ...props.state!, loading: false, error: "Connection unavailable." }}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Connection unavailable.")
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeEnabled()

    view.rerender(
      <BrowserPrototypePreviewSurface
        {...props}
        state={{
          ...props.state!,
          loading: false,
          runtimeAvailable: true,
          status: "no-controls",
          storageError: "Could not save options.",
        }}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save options.")
    expect(screen.getByRole("button", { name: "Retry saving" })).toBeEnabled()
  })
})
