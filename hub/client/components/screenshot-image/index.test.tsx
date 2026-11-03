import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider, useHubTheme } from "@hooks/use-hub-theme"

import { ScreenshotImage } from "."

describe("ScreenshotImage()", () => {
  it("uses Hub's explicit theme even when the system preference differs", () => {
    const ref = createRef<HTMLImageElement>()
    function Preview() {
      const { setColorMode } = useHubTheme()
      return (
        <>
          <button onClick={() => setColorMode("dark")}>Dark</button>
          <button onClick={() => setColorMode("light")}>Light</button>
          <ScreenshotImage ref={ref} src="/desktop" darkSrc="/desktop?theme=dark" alt="Prototype" />
        </>
      )
    }
    render(
      <HubThemeProvider colorMode="light">
        <Preview />
      </HubThemeProvider>,
    )
    const image = screen.getByRole("img", { name: "Prototype" })
    expect(image).toHaveAttribute("src", "/desktop")
    expect(ref.current).toBe(image)

    fireEvent.click(screen.getByRole("button", { name: "Dark" }))
    expect(image).toHaveAttribute("src", "/desktop?theme=dark")
    fireEvent.click(screen.getByRole("button", { name: "Light" }))
    expect(image).toHaveAttribute("src", "/desktop")
  })

  it("follows the system preference in automatic mode", () => {
    const preference = Object.assign(window.matchMedia("(prefers-color-scheme: dark)"), {
      matches: true,
    })
    vi.spyOn(window, "matchMedia").mockReturnValue(preference)
    render(
      <HubThemeProvider>
        <ScreenshotImage src="/desktop" darkSrc="/desktop?theme=dark" alt="Prototype" />
      </HubThemeProvider>,
    )
    expect(screen.getByRole("img")).toHaveAttribute("src", "/desktop?theme=dark")
  })

  it("keeps the light image when no dark source is supplied", () => {
    render(
      <HubThemeProvider colorMode="dark">
        <ScreenshotImage src="/legacy.png" alt="Prototype" />
      </HubThemeProvider>,
    )
    expect(screen.getByRole("img")).toHaveAttribute("src", "/legacy.png")
  })
})
