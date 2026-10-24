import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { ScrollingScreenshot } from "."

const disconnect = vi.fn()
let resize: ResizeObserverCallback

describe("ScrollingScreenshot()", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    vi.spyOn(HTMLImageElement.prototype, "clientWidth", "get").mockReturnValue(360)
    vi.spyOn(HTMLDivElement.prototype, "clientHeight", "get").mockReturnValue(200)
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1440)
  })

  it("calculates the full scroll distance from the loaded image height", () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(3600)

    const { container, unmount } = render(<ScrollingScreenshot src="/desktop.png" alt="Desktop" />)
    const image = screen.getByRole("img", { name: "Desktop" })
    const preview = container.querySelector<HTMLElement>(".scrolling-screenshot")!

    fireEvent.load(image)

    expect(preview).not.toHaveAttribute("data-fits")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-ramp-offset")).toBe("-40px")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-linear-offset")).toBe("-660px")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-ramp-duration")).toBe("1s")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-linear-duration")).toBe("8.25s")

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("does not move an image that fits, and recalculates when the preview resizes", () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(900)
    vi.spyOn(HTMLDivElement.prototype, "clientHeight", "get").mockReturnValue(250)
    const { container } = render(<ScrollingScreenshot src="/desktop.png" alt="Desktop" />)
    const preview = container.querySelector<HTMLElement>(".scrolling-screenshot")!

    fireEvent.load(screen.getByRole("img", { name: "Desktop" }))
    expect(preview).toHaveAttribute("data-fits")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-linear-offset")).toBe("0px")

    vi.spyOn(HTMLDivElement.prototype, "clientHeight", "get").mockReturnValue(100)
    resize([], {} as ResizeObserver)

    expect(preview).not.toHaveAttribute("data-fits")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-ramp-offset")).toBe("-40px")
    expect(preview.style.getPropertyValue("--scrolling-screenshot-linear-offset")).toBe("-85px")
  })

  it("recalculates the scroll distance when the dark screenshot loads at a different height", () => {
    const height = vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(900)
    const screenshot = (
      <ScrollingScreenshot src="/desktop" darkSrc="/desktop?theme=dark" alt="Desktop" />
    )
    const { container, rerender } = render(
      <HubThemeProvider colorMode="light">{screenshot}</HubThemeProvider>,
    )
    const image = screen.getByRole("img", { name: "Desktop" })
    fireEvent.load(image)
    const preview = container.querySelector<HTMLElement>(".scrolling-screenshot")!
    expect(preview.style.getPropertyValue("--scrolling-screenshot-linear-offset")).toBe("0px")

    rerender(<HubThemeProvider colorMode="dark">{screenshot}</HubThemeProvider>)
    expect(image).toHaveAttribute("src", "/desktop?theme=dark")
    height.mockReturnValue(3600)
    fireEvent.load(image)
    expect(preview.style.getPropertyValue("--scrolling-screenshot-linear-offset")).toBe("-660px")
  })
})
