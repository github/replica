import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, it, vi } from "vitest"

import { HomeIndexPage } from "."
import type { HomeIndexPageData } from "./types"

const PAGE_DATA: HomeIndexPageData = {
  alert: null as string | null,
  authenticityToken: "token",
  badge: "Collaborative prototyping",
  badgeAlternate: "Built for feedback",
  description: "Turn GitHub branches into shareable prototypes.",
  heading: "Build and review prototypes with your team.",
  localMode: false,
  notice: null,
  footerNote: "\u00a9 2026 GitHub, Inc.",
  pageTitle: "Replica Hub",
  pauseAnimationLabel: "Pause animation",
  resumeAnimationLabel: "Resume animation",
  signInLabel: "Sign in with GitHub",
  signInPath: "/auth/github",
}

function renderHome(data = PAGE_DATA) {
  return render(<HomeIndexPage colorMode="dark" data={data} />)
}

describe("HomeIndexPage()", () => {
  beforeEach(() => {
    PAGE_DATA.alert = null
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
  })

  it("rotates the eyebrow every six seconds without changing the heading", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    renderHome()
    const heading = screen.getByRole("heading", { level: 1 })
    expect(screen.queryByText(PAGE_DATA.badgeAlternate)).not.toBeInTheDocument()

    await act(() => vi.advanceTimersByTime(6000))

    expect(screen.getByText(PAGE_DATA.badgeAlternate)).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1 })).toBe(heading)
    expect(screen.getByText(PAGE_DATA.badgeAlternate).closest("[aria-live]")).toBeNull()

    await act(() => vi.advanceTimersByTime(6000))

    expect(screen.getByText(PAGE_DATA.badge).closest("[aria-hidden]")).toBeNull()
  })

  it("uses the shared playback control to stop and resume eyebrow rotation", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    renderHome()
    fireEvent.click(screen.getByRole("button", { name: PAGE_DATA.pauseAnimationLabel }))

    await act(() => vi.advanceTimersByTime(12_000))

    expect(screen.getByText(PAGE_DATA.badge)).toBeInTheDocument()
    expect(screen.queryByText(PAGE_DATA.badgeAlternate)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: PAGE_DATA.resumeAnimationLabel }))

    await act(() => vi.advanceTimersByTime(6000))

    expect(screen.getByText(PAGE_DATA.badgeAlternate)).toBeInTheDocument()
  })

  it("suspends eyebrow rotation while the page is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false)
    renderHome()
    hidden.mockReturnValue(true)
    await act(() => document.dispatchEvent(new Event("visibilitychange")))

    await act(() => vi.advanceTimersByTime(12_000))

    expect(screen.queryByText(PAGE_DATA.badgeAlternate)).not.toBeInTheDocument()
    hidden.mockReturnValue(false)
    await act(() => document.dispatchEvent(new Event("visibilitychange")))

    await act(() => vi.advanceTimersByTime(6000))

    expect(screen.getByText(PAGE_DATA.badgeAlternate)).toBeInTheDocument()
  })

  it("clears the eyebrow rotation timer on unmount", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const intervals = vi.spyOn(window, "setInterval")
    const clearInterval = vi.spyOn(window, "clearInterval")
    const { unmount } = renderHome()
    const rotationCall = intervals.mock.calls.findIndex(([, delay]) => delay === 6000)
    expect(rotationCall).toBeGreaterThanOrEqual(0)
    const rotationTimer: unknown = intervals.mock.results[rotationCall]?.value

    unmount()

    expect(clearInterval).toHaveBeenCalledWith(rotationTimer)
  })

  it("keeps the eyebrow static for reduced motion", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const matchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      Object.assign(matchMedia(query), { matches: query === "(prefers-reduced-motion: reduce)" }),
    )
    renderHome()

    await act(() => vi.advanceTimersByTime(24_000))

    expect(screen.getByText(PAGE_DATA.badge)).toBeInTheDocument()
    expect(screen.queryByText(PAGE_DATA.badgeAlternate)).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("introduces Replica Hub without deployment details", () => {
    renderHome()

    expect(
      screen.getByRole("heading", { name: "Build and review prototypes with your team." }),
    ).toBeInTheDocument()
    expect(screen.getByText("Turn GitHub branches into shareable prototypes.")).toBeInTheDocument()
    expect(screen.getByText("Collaborative prototyping")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Replica" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
    expect(screen.getByText("\u00a9 2026 GitHub, Inc.")).toBeInTheDocument()
  })

  it("updates the illustration palette for light and dark modes", () => {
    const { container, rerender } = render(<HomeIndexPage colorMode="dark" data={PAGE_DATA} />)
    const artwork = container.querySelector<HTMLElement>(".ascii-gradient")!
    const background = artwork.querySelector("rect")!
    const base = artwork.querySelector<SVGPathElement>(
      ".ascii-gradient__base.ascii-gradient__palette-current",
    )!
    const highlights = artwork.querySelector<SVGPathElement>(
      ".ascii-gradient__highlights.ascii-gradient__palette-current",
    )!

    expect(background).toHaveAttribute("fill", "#000000")
    expect(base).toHaveAttribute("fill", "#258b48")
    expect(highlights).toHaveAttribute("fill", "#47b966")
    expect(artwork.style.getPropertyValue("--ascii-gradient-control")).toBe("#ffffff")

    rerender(<HomeIndexPage colorMode="light" data={PAGE_DATA} />)

    expect(background).toHaveAttribute("fill", "#f2f5f3")
    expect(base).toHaveAttribute("fill", "#08872b")
    expect(highlights).toHaveAttribute("fill", "#5fed83")
    expect(artwork.style.getPropertyValue("--ascii-gradient-control")).toBe("#0d3024")
    expect(artwork.style.getPropertyValue("--ascii-gradient-control-border")).toBe("#0d6731")
  })

  it("shows a clear repository access message", () => {
    PAGE_DATA.alert =
      "Your GitHub account does not have access to this Hub's prototype repositories."

    renderHome()

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your GitHub account does not have access to this Hub's prototype repositories.",
    )
  })

  it("preserves the GitHub sign-in action and CSRF token", () => {
    renderHome()

    const signIn = screen.getByRole("button", { name: "Sign in with GitHub" })
    const form = signIn.closest("form")

    expect(signIn).toHaveAttribute("type", "submit")
    expect(signIn.querySelector(".octicon-mark-github")).toBeInTheDocument()
    expect(form).toHaveAttribute("action", "/auth/github")
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("token")
  })

  it("shows the canvas verification result without submitting another action", () => {
    const notice =
      "GitHub authorization succeeded for this connection only. Return to the action and submit it again within five minutes."
    renderHome({ ...PAGE_DATA, notice })

    expect(screen.getByRole("status")).toHaveTextContent(notice)
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
  })

  it("offers local sign-in without a GitHub action", () => {
    renderHome({
      ...PAGE_DATA,
      localMode: true,
      signInLabel: "Open local Hub",
      signInPath: "/auth/local",
    })

    const signIn = screen.getByRole("button", { name: "Open local Hub" })
    expect(signIn.closest("form")).toHaveAttribute("action", "/auth/local")
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).not.toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Replica" })).toBeInTheDocument()
  })

  it("keeps one Hero with no layout switcher or old footer content", () => {
    const { container } = renderHome()

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByRole("heading", { level: 1 })).toHaveStyle({
      transitionDelay: "0ms",
      transitionDuration: "1000ms",
    })
    expect(screen.getByText(PAGE_DATA.description)).toHaveStyle({
      transitionDelay: "500ms",
      transitionDuration: "1000ms",
    })
    expect(container.querySelector(".home__actions")?.parentElement).toHaveStyle({
      transitionDelay: "750ms",
      transitionDuration: "1000ms",
    })
    expect(screen.queryByRole("group", { name: "Hero layout" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(2)
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeInTheDocument()
    expect(container.querySelector(".home__art svg")).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelector("footer")).toHaveTextContent(PAGE_DATA.footerNote)
    expect(screen.queryByText(/Testing a shared prototype/)).not.toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })
})
