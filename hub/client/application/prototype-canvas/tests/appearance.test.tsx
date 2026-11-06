import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import tokenStyles from "@/tokens/base.css?inline"
import fieldStyles from "@components/prototype-controls-fields/styles.css?inline"
import composerStyles from "@features/review-comment-composer/styles.css?inline"
import conversationStyles from "@components/review-conversation-frame/styles.css?inline"
import markerStyles from "@features/review-comment-markers/styles.css?inline"

import { sharingFixture } from "./sharing-fixture"
import { App } from ".."
import canvasStyles from "../styles.css?inline"

describe("App()", () => {
  it("uses theme-aware thumb surfaces and selection and review shadows", () => {
    for (const selector of [
      ".controls-native-slider::-webkit-slider-thumb",
      ".controls-native-slider::-moz-range-thumb",
    ]) {
      const rule = [...fieldStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
        ([, candidate]) => candidate?.trim() === selector,
      )
      expect(rule?.[2]).toContain("background: var(--hub-canvas-default);")
      expect(rule?.[2]).toContain("solid var(--hub-border-default);")
    }
    expect(fieldStyles).toContain("--controls-selection-shadow: var(--hub-shadow-selection);")
    expect(composerStyles).toContain("box-shadow: var(--hub-shadow-review-overlay);")
    expect(conversationStyles).toContain("box-shadow: var(--hub-shadow-review-overlay);")
    expect(markerStyles).toContain("box-shadow: var(--hub-shadow-review-marker);")
    const rules = [...tokenStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    const defaults = rules.find(
      ([, selector, body]) =>
        selector?.includes(":root") && body?.includes("--hub-shadow-selection:"),
    )
    const dark = rules.find(
      ([, selector, body]) =>
        selector?.trim() === '[data-color-mode="dark"]' &&
        body?.includes("--hub-shadow-selection:"),
    )
    for (const token of [
      "--hub-shadow-selection",
      "--hub-shadow-review-overlay",
      "--hub-shadow-review-marker",
    ]) {
      function value(body: string | undefined) {
        return body?.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]
      }
      expect(value(defaults?.[2])).toBeDefined()
      expect(value(dark?.[2])).toBeDefined()
      expect(value(dark?.[2])).not.toBe(value(defaults?.[2]))
    }
  })

  it("resends the canvas accent to its own bridge on theme changes, readiness, and frame reload", async () => {
    sharingFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled()
    const frame = screen.getByTitle<HTMLIFrameElement>("Demo prototype")
    const theme = view.container.querySelector<HTMLElement>(".canvas-base")!
    const post = vi.spyOn(frame.contentWindow!, "postMessage")
    theme.style.setProperty("--hub-accent", "#58a6ff")
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }))
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:canvas:theme", accent: "#58a6ff" }),
      "http://localhost:4321",
    )
    theme.style.setProperty("--hub-accent", "#0969da")
    fireEvent.click(screen.getByRole("button", { name: "Light appearance" }))
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "replica:canvas:theme", accent: "#0969da" }),
      "http://localhost:4321",
    )
    post.mockClear()
    const ready = { type: "replica:canvas:ready", nonce: "theme", protocolVersion: 1 }
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "http://localhost:9999",
        source: frame.contentWindow,
        data: ready,
      }),
    )
    expect(post).not.toHaveBeenCalled()
    fireEvent(
      window,
      new MessageEvent("message", { origin: "http://localhost:4321", source: window, data: ready }),
    )
    expect(post).not.toHaveBeenCalled()
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "http://localhost:4321",
        source: frame.contentWindow,
        data: ready,
      }),
    )
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:canvas:theme", accent: "#0969da" }),
      "http://localhost:4321",
    )
    post.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }))
    const replacement = screen.getByTitle<HTMLIFrameElement>("Demo prototype")
    expect(replacement).not.toBe(frame)
    const replacementPost = vi.spyOn(replacement.contentWindow!, "postMessage")
    fireEvent.load(replacement)
    expect(replacementPost).toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:canvas:theme", accent: "#0969da" }),
      "http://localhost:4321",
    )
    expect(post).not.toHaveBeenCalled()
    view.unmount()
  })
  it.each(["light", "dark"] as const)(
    "starts the canvas and preview in the system's %s appearance independently of the host theme",
    async (appearance) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query === "(prefers-color-scheme: dark)" && appearance === "dark",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      )
      sharingFixture()
      const hostAppearance = appearance === "light" ? "dark" : "light"
      const view = render(
        <div data-color-mode={hostAppearance}>
          <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />
        </div>,
      )
      await screen.findByRole("button", { name: "Publish" })
      expect(view.container.querySelector(".canvas-base")).toHaveAttribute(
        "data-color-mode",
        appearance,
      )
      expect(screen.getByTitle("Demo prototype")).toHaveStyle({ colorScheme: appearance })
      view.unmount()
    },
  )
  it("themes canvas controls and dialogs with the preview without reloading it", async () => {
    sharingFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Publish" })
    const frame = screen.getByTitle("Demo prototype")
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    const controls = screen.getByRole("complementary", { name: "Controls" })
    const theme = view.container.querySelector(".canvas-base")
    const browserTheme = screen
      .getByRole("navigation", { name: "Prototype navigation" })
      .closest("[data-color-mode]")
    const browserMode = browserTheme?.getAttribute("data-color-mode")
    const instantButtonRule = [...canvasStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
      ([, selector, body]) =>
        selector?.trim() === ".canvas-base button" && body?.includes("transition: none;"),
    )
    if (!instantButtonRule?.[1]) throw new Error("Canvas buttons must switch appearance instantly.")
    expect(instantButtonRule[2]).toContain("backdrop-filter: none;")
    expect(instantButtonRule[2]).toContain("-webkit-backdrop-filter: none;")
    for (const button of view.container.querySelectorAll("button")) {
      expect(button.matches(instantButtonRule[1].trim())).toBe(true)
    }
    for (const appearance of ["dark", "light"] as const) {
      fireEvent.click(
        screen.getByRole("button", {
          name: appearance === "dark" ? "Dark appearance" : "Light appearance",
        }),
      )
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
      const dialog = screen.getByRole("dialog", { name: "Publish before sharing" })
      expect(theme).toHaveAttribute("data-color-mode", appearance)
      expect(dialog.closest("[data-color-mode]")).toBe(theme)
      for (const button of within(dialog).getAllByRole("button")) {
        expect(button.matches(instantButtonRule[1].trim())).toBe(true)
      }
      expect(controls.closest("[data-color-mode]")).toBe(theme)
      expect(browserTheme).not.toBe(theme)
      expect(browserTheme).toHaveAttribute("data-color-mode", browserMode)
      expect(frame).toHaveStyle({ colorScheme: appearance })
      expect(screen.getByTitle("Demo prototype")).toBe(frame)
      expect(frame).toHaveAttribute("src", "http://localhost:4321/")
      fireEvent.click(screen.getByRole("button", { name: "Close sharing readiness" }))
    }
    view.unmount()
  })
})
