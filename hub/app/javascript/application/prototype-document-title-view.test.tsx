import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import prototypeStories from "@pages/prototypes-show-page/stories"

import PrototypesShowView from "../../views/prototypes/show"
import type { PrototypesShowViewData } from "../../views/prototypes/types"

const state = vi.hoisted(() => ({
  data: undefined as PrototypesShowViewData | undefined,
}))

vi.mock("@hooks/use-page-data", () => ({ usePageData: () => state.data }))
vi.mock("@hooks/use-hub-theme", () => ({
  useHubTheme: () => ({ resolvedColorMode: "light" }),
  useOptionalHubTheme: () => null,
}))
vi.mock("@hooks/use-prototype-viewer-url", () => ({
  usePrototypeViewerUrl: () => ({ viewerUrl: "/preview", minimized: false, setMinimized: vi.fn() }),
}))
vi.mock("@hooks/use-prototype-review", () => ({
  usePrototypeReview: () => prototypeStories.args.review,
}))

describe("PrototypesShowView() document title", () => {
  it("follows prototype navigation and restores the Hub title when leaving the viewer", () => {
    document.title = "Replica Hub"
    const first: PrototypesShowViewData = {
      ...prototypeStories.args.data,
      prototypeName: "Welcome redesign",
      defaultDocumentTitle: "Replica Hub",
    }
    state.data = first
    const view = render(<PrototypesShowView />)

    expect(document.title).toBe("Welcome redesign")

    state.data = { ...first, prototypeId: 2, prototypeName: "Search exploration" }
    view.rerender(<PrototypesShowView />)

    expect(document.title).toBe("Search exploration")

    state.data = first
    view.rerender(<PrototypesShowView />)

    expect(document.title).toBe("Welcome redesign")

    view.unmount()

    expect(document.title).toBe("Replica Hub")
  })

  it("updates the title when refreshed data renames the same prototype", () => {
    document.title = "Replica Hub"
    state.data = {
      ...prototypeStories.args.data,
      prototypeName: "Original name",
      defaultDocumentTitle: "Replica Hub",
    }
    const view = render(<PrototypesShowView />)

    expect(document.title).toBe("Original name")

    state.data = { ...state.data, prototypeName: 'Design & "research" <next>' }
    view.rerender(<PrototypesShowView />)

    expect(document.title).toBe('Design & "research" <next>')

    view.unmount()

    expect(document.title).toBe("Replica Hub")
  })
})
