import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { InboxPrototype } from "."

describe("InboxPrototype()", () => {
  it.each([false, true])(
    "places the hover panel 8 pixels from the actual Inbox button with collapsed=%s",
    (collapsed) => {
      vi.stubGlobal("innerWidth", 1200)
      vi.stubGlobal("innerHeight", 900)
      render(<InboxPrototype defaultNavigationCollapsed={collapsed} />)
      const link = screen.getByRole("link", { name: "Inbox, 6 unread items" })
      vi.spyOn(link, "getBoundingClientRect").mockReturnValue(
        new DOMRect(12, 200, collapsed ? 40 : 230, 40),
      )
      fireEvent.mouseEnter(link)
      const panel = document.querySelector<HTMLElement>(".repository-navigation__inbox-preview")
      expect(panel?.style.left).toBe(`${(collapsed ? 52 : 242) + 8}px`)
      expect(panel?.style.top).toBe("200px")
    },
  )

  it("places Inbox after Prototypes, previews unread items, and opens all activity without fetching", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    render(<InboxPrototype />)
    const navigation = screen.getByRole("navigation", { name: "Repository navigation" })
    const links = within(navigation).getAllByRole("link")
    expect(
      links.map((link) => link.querySelector(".repository-navigation-item__label")?.textContent),
    ).toEqual(["Create", "Prototypes", "Inbox"])
    const inbox = screen.getByRole("link", { name: "Inbox, 6 unread items" })
    expect(inbox).not.toHaveAttribute("title")
    expect(inbox.querySelector(".repository-navigation-item__count")).toHaveTextContent("6")
    expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument()
    fireEvent.mouseEnter(inbox)
    const preview = screen.getByRole("region", { name: "Inbox" })
    expect(within(preview).getAllByRole("listitem")).toHaveLength(6)
    expect(within(preview).queryByRole("button", { name: "All" })).not.toBeInTheDocument()
    expect(within(preview).queryByRole("button", { name: "Unread" })).not.toBeInTheDocument()
    expect(within(preview).queryByText("Latest conversation activity")).not.toBeInTheDocument()
    expect(within(preview).getByRole("button", { name: "View all" })).toBeInTheDocument()
    fireEvent.click(inbox)
    const page = screen.getByRole("region", { name: "Inbox" })
    expect(within(page).getAllByRole("listitem")).toHaveLength(16)
    expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent("Inbox")
    expect(
      within(page).queryByText("Keep up with the conversations you are part of."),
    ).not.toBeInTheDocument()
    fireEvent.click(within(page).getByRole("button", { name: "Unread" }))
    expect(within(page).getAllByRole("listitem")).toHaveLength(6)
    fireEvent.click(within(page).getByRole("button", { name: "All" }))
    expect(within(page).getAllByRole("listitem")).toHaveLength(16)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("opens on focus, dismisses with Escape, and shows the empty full-page state", () => {
    render(<InboxPrototype empty defaultNavigationCollapsed />)
    const inbox = screen.getByRole("link", { name: "Inbox" })
    fireEvent.focus(inbox)
    expect(screen.getByText("You are all caught up")).toBeInTheDocument()
    fireEvent.keyDown(inbox, { key: "Escape" })
    expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument()
    fireEvent.focus(inbox)
    fireEvent.click(screen.getByRole("button", { name: "View all" }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Inbox")
    expect(screen.getByText("No activity yet")).toBeInTheDocument()
  })

  it("removes read items from the hover panel", () => {
    render(<InboxPrototype />)
    fireEvent.mouseEnter(screen.getByRole("link", { name: "Inbox, 6 unread items" }))
    const preview = screen.getByRole("region", { name: "Inbox" })
    const first = within(preview).getAllByRole("listitem")[0]
    if (!first) throw new Error("Expected an unread activity row")

    fireEvent.click(within(first).getByRole("button", { name: "Mark as read: mona" }))
    expect(within(preview).getAllByRole("listitem")).toHaveLength(5)
    expect(screen.getByLabelText("5 unread items")).toBeInTheDocument()
    expect(
      screen
        .getByRole("link", { name: "Inbox, 5 unread items" })
        .querySelector(".repository-navigation-item__count"),
    ).toHaveTextContent("5")
  })

  it("shows older unread items in the preview independently of the page filter", () => {
    render(<InboxPrototype initialInbox />)
    const page = screen.getByRole("region", { name: "Inbox" })
    const last = within(page).getAllByRole("listitem").at(-1)
    if (!last) throw new Error("Expected an older activity row")

    fireEvent.click(within(last).getByRole("button", { name: /^Mark as unread:/ }))
    fireEvent.click(within(page).getByRole("button", { name: "Unread" }))
    expect(within(page).getAllByRole("listitem")).toHaveLength(7)
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Repository navigation" })).getByRole("link", {
        name: "Prototypes",
      }),
    )
    const inbox = screen.getByRole("link", { name: "Inbox, 7 unread items" })
    expect(inbox.querySelector(".repository-navigation-item__count")).toHaveTextContent("7")
    fireEvent.mouseEnter(inbox)
    const preview = screen.getByRole("region", { name: "Inbox" })
    expect(within(preview).getAllByRole("listitem")).toHaveLength(7)
    expect(within(preview).getByLabelText("7 unread items")).not.toHaveAttribute("title")
    expect(preview.querySelectorAll('[data-unread="true"]')).toHaveLength(7)
    fireEvent.click(within(preview).getByRole("button", { name: "View all" }))
    expect(
      within(screen.getByRole("region", { name: "Inbox" })).getAllByRole("listitem"),
    ).toHaveLength(7)
  })

  it.each([false, true])(
    "updates and clears the sidebar count with a collapsed sidebar=%s",
    (collapsed) => {
      render(<InboxPrototype defaultNavigationCollapsed={collapsed} />)
      const inbox = screen.getByRole("link", { name: "Inbox, 6 unread items" })
      expect(inbox.querySelector(".repository-navigation-item__count")).toHaveTextContent("6")
      expect(document.querySelector(".repository-navigation__unread")).not.toBeInTheDocument()
      fireEvent.mouseEnter(inbox)
      const preview = screen.getByRole("region", { name: "Inbox" })
      for (const button of within(preview).getAllByRole("button", { name: /^Mark as read:/ })) {
        fireEvent.click(button)
      }
      expect(
        screen
          .getByRole("link", { name: "Inbox" })
          .querySelector(".repository-navigation-item__count"),
      ).not.toBeInTheDocument()
      expect(within(preview).queryAllByRole("listitem")).toHaveLength(0)
      expect(within(preview).getByText("You are all caught up")).toBeInTheDocument()
      expect(within(preview).queryByLabelText(/unread items/)).not.toBeInTheDocument()
    },
  )

  it.each([false, true])(
    "shows the unread preview on the selected Inbox page with collapsed=%s",
    (collapsed) => {
      render(<InboxPrototype initialInbox defaultNavigationCollapsed={collapsed} />)
      const page = screen.getByRole("region", { name: "Inbox" })
      fireEvent.click(within(page).getByRole("button", { name: "Unread" }))
      fireEvent.mouseEnter(screen.getByRole("link", { name: "Inbox, 6 unread items" }))
      const preview = screen
        .getAllByRole("region", { name: "Inbox" })
        .find((region) => region.dataset.mode === "preview")
      if (!preview) throw new Error("Expected the selected Inbox page's hover preview")

      expect(within(preview).getAllByRole("listitem")).toHaveLength(6)
      expect(within(page).getAllByRole("listitem")).toHaveLength(6)
      expect(within(preview).queryByRole("button", { name: "Unread" })).not.toBeInTheDocument()
    },
  )

  it.each([false, true])(
    "opens the exact reply in its prototype from the full-page inbox=%s",
    (initialInbox) => {
      const fetch = vi.fn()
      vi.stubGlobal("fetch", fetch)
      render(<InboxPrototype initialInbox={initialInbox} />)
      if (!initialInbox) {
        fireEvent.mouseEnter(screen.getByRole("link", { name: "Inbox, 6 unread items" }))
      }
      const inbox = screen.getByRole("region", { name: "Inbox" })
      const row = within(inbox).getAllByRole("listitem")[1]
      if (!row) throw new Error("Expected a reply activity")

      fireEvent.click(within(row).getByRole("link"))
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Navigation refresh")
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Conversation")
      const target = document.querySelector('[data-review-message-id="1002"]')
      expect(target).toHaveAttribute("data-notification-target", "true")
      expect(target).toHaveFocus()
      expect(target).toHaveTextContent("I tried the narrower version.")
      expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole("button", { name: "Back to inbox" }))
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Inbox")
    },
  )

  it("keeps the card open during a long diagonal path and closes after leaving it", async () => {
    vi.useFakeTimers()
    render(<InboxPrototype />)
    const link = screen.getByRole("link", { name: "Inbox, 6 unread items" })
    fireEvent.mouseEnter(link)
    const panel = document.querySelector<HTMLElement>(".repository-navigation__inbox-preview")
    if (!panel) throw new Error("Expected an inbox hover panel")

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(300, 100, 300, 500))
    fireEvent.mouseLeave(link, { clientX: 100, clientY: 160 })
    await act(() => vi.advanceTimersByTime(250))
    fireEvent.mouseMove(document, { clientX: 150, clientY: 220 })
    await act(() => vi.advanceTimersByTime(250))
    fireEvent.mouseMove(document, { clientX: 200, clientY: 330 })
    await act(() => vi.advanceTimersByTime(250))
    expect(screen.getByRole("region", { name: "Inbox" })).toBeInTheDocument()
    fireEvent.mouseMove(document, { clientX: 310, clientY: 500 })
    await act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole("region", { name: "Inbox" })).toBeInTheDocument()
    fireEvent.mouseLeave(panel, { clientX: 650, clientY: 600 })
    fireEvent.mouseMove(document, { clientX: 700, clientY: 800 })
    await act(() => vi.advanceTimersByTime(301))
    expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument()
  })
})
