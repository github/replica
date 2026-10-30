import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useScrollFade } from "."

describe("useScrollFade()", () => {
  it("fades only edges with remaining content, including exact boundaries and overscroll", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200)
    function Example() {
      const ref = useScrollFade<HTMLDivElement>()
      return (
        <div ref={ref} data-testid="viewport">
          <div>Content</div>
        </div>
      )
    }
    render(<Example />)
    const viewport = screen.getByTestId("viewport")
    expect(viewport).not.toHaveAttribute("data-scroll-start")
    expect(viewport).toHaveAttribute("data-scroll-end")

    fireEvent.scroll(viewport, { target: { scrollTop: 50 } })
    expect(viewport).toHaveAttribute("data-scroll-start")
    expect(viewport).toHaveAttribute("data-scroll-end")

    fireEvent.scroll(viewport, { target: { scrollTop: 99.5 } })
    expect(viewport).toHaveAttribute("data-scroll-end")
    fireEvent.scroll(viewport, { target: { scrollTop: 100 } })
    expect(viewport).toHaveAttribute("data-scroll-start")
    expect(viewport).not.toHaveAttribute("data-scroll-end")

    fireEvent.scroll(viewport, { target: { scrollTop: 110 } })
    expect(viewport).not.toHaveAttribute("data-scroll-end")
    fireEvent.scroll(viewport, { target: { scrollTop: -10 } })
    expect(viewport).not.toHaveAttribute("data-scroll-start")
    expect(viewport).toHaveAttribute("data-scroll-end")
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } })
    expect(viewport).not.toHaveAttribute("data-scroll-start")
  })

  it("keeps fitting content unmasked and updates on viewport or content resize with cleanup", () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let resize: ResizeObserverCallback | undefined
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    let viewportHeight = 200
    let contentHeight = 100
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => viewportHeight)
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => contentHeight)
    function Example({ content }: { content: string }) {
      const ref = useScrollFade<HTMLDivElement>()
      return (
        <div ref={ref} data-testid="viewport">
          <div>{content}</div>
        </div>
      )
    }
    const { rerender, unmount } = render(<Example content="Short content" />)
    const viewport = screen.getByTestId("viewport")
    const listener = vi.spyOn(viewport, "removeEventListener")
    expect(observe).toHaveBeenCalledWith(viewport)
    expect(observe).toHaveBeenCalledWith(viewport.firstElementChild)
    expect(viewport).not.toHaveAttribute("data-scroll-start")
    expect(viewport).not.toHaveAttribute("data-scroll-end")

    viewportHeight = 50
    resize?.([], {} as ResizeObserver)
    expect(viewport).toHaveAttribute("data-scroll-end")
    fireEvent.scroll(viewport, { target: { scrollTop: 50 } })
    expect(viewport).toHaveAttribute("data-scroll-start")
    expect(viewport).not.toHaveAttribute("data-scroll-end")

    contentHeight = 300
    rerender(<Example content="Longer results and selected users" />)
    resize?.([], {} as ResizeObserver)
    expect(viewport).toHaveAttribute("data-scroll-start")
    expect(viewport).toHaveAttribute("data-scroll-end")
    expect(observe).toHaveBeenCalledTimes(2)

    contentHeight = 50
    rerender(<Example content="Fits exactly" />)
    resize?.([], {} as ResizeObserver)
    expect(viewport).not.toHaveAttribute("data-scroll-start")
    expect(viewport).not.toHaveAttribute("data-scroll-end")

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith("scroll", expect.any(Function))
  })
})
