import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import story from "./stories"

describe("PublicationDemo()", () => {
  it("shows the updated comments in the complete canvas sidebar without contacting Hub", async () => {
    const externalFetch = vi.fn(() => Promise.reject(new Error("Unexpected external request.")))
    vi.stubGlobal("fetch", externalFetch)
    const Demo = story.component
    const view = render(
      <Demo scenario="Published" prototypeUrl="http://localhost:4321/" withComments />,
      { wrapper: HubThemeProvider },
    )
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 3/ }, { timeout: 5_000 }))
    const sidebar = screen.getByRole("complementary", { name: "Comments" })
    expect(sidebar).toHaveClass("hub-sidebar")
    expect(within(sidebar).getByRole("link", { name: "build 1" })).toHaveAttribute(
      "href",
      "https://hub.example.com/repositories/2001/prototypes/1?build=1",
    )
    expect(within(sidebar).getByText("1 reply")).toBeVisible()
    expect(within(sidebar).getByText("2 replies")).toBeVisible()
    expect(within(sidebar).getAllByRole("button", { pressed: false })).toHaveLength(3)
    expect(within(sidebar).queryByRole("link", { name: "build 2" })).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Checking")).not.toBeInTheDocument()
    expect(externalFetch).not.toHaveBeenCalled()
    view.unmount()
  })

  it("shows the Publish/Share group and opens fixture management without contacting Hub", async () => {
    const externalFetch = vi.fn(() => Promise.reject(new Error("Unexpected external request.")))
    vi.stubGlobal("fetch", externalFetch)
    const Demo = story.component
    const view = render(
      <Demo scenario="Published" prototypeUrl="http://localhost:4321/" withShareLinks />,
      { wrapper: HubThemeProvider },
    )
    const group = await screen.findByRole("group", { name: "Publish and share" })
    await screen.findByRole("button", { name: "Published" })
    expect(screen.queryByText(/^Demo only/)).not.toBeInTheDocument()
    expect(view.container.querySelector(".publication-demo-notice")).toBeNull()
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([null, "Share prototype"])
    const frame = screen.getByTitle("Welcome prototype prototype")
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }))
    fireEvent.click(within(group).getByRole("button", { name: "Share prototype" }))
    await screen.findByRole("textbox", { name: "Usability review, Build #1 URL" })
    expect(
      screen.getByRole("main", { name: "Share prototype" }).closest("[data-color-mode]"),
    ).toHaveAttribute("data-color-mode", "dark")
    expect(screen.getByRole("textbox", { name: "Label" })).toBeRequired()
    expect(screen.queryByRole("button", { name: "Load more links" })).not.toBeInTheDocument()
    expect(externalFetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Back to preview" }))
    expect(screen.getByTitle("Welcome prototype prototype")).toBe(frame)
    expect(frame).toHaveStyle({ colorScheme: "dark" })
    expect(screen.getByRole("button", { name: "Share prototype" })).toHaveFocus()
    view.unmount()
  })

  it("creates, opens, and deletes only in-memory fixture links", async () => {
    const externalFetch = vi.fn(() => Promise.reject(new Error("Unexpected external request.")))
    vi.stubGlobal("fetch", externalFetch)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    const Demo = story.component
    const view = render(
      <Demo scenario="Published" prototypeUrl="http://localhost:4321/" withShareLinks />,
      { wrapper: HubThemeProvider },
    )
    await screen.findByRole("button", { name: "Published" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    const label = await screen.findByRole("textbox", { name: "Label" })
    await screen.findByRole("textbox", { name: "Usability review, Build #1 URL" })
    fireEvent.change(label, { target: { value: "Partner review" } })
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "never" } })
    fireEvent.click(screen.getByRole("button", { name: "Create share link" }))
    const url = await screen.findByRole("textbox", { name: "Partner review, Build #1 URL" })
    expect(url).toHaveValue("https://hub.example.com/share/12345678-1234-1234-1234-000000000003")
    expect(screen.queryByText("Share link created.")).not.toBeInTheDocument()
    expect(url.closest("li")).not.toHaveClass("share-link-item--created")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open Partner review, Build #1" })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole("button", { name: "Open Partner review, Build #1" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete Partner review, Build #1" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Partner review, Build #1 URL" }),
      ).not.toBeInTheDocument(),
    )
    expect(externalFetch).not.toHaveBeenCalled()
    view.unmount()
  })
})
