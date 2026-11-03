import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { inboxActivities, inboxCopy } from "@/storybook/fixtures/inbox-activity"

import { ConversationInbox } from "."

describe("ConversationInbox()", () => {
  it("puts the actual reaction after the quote and retains the reaction icon", () => {
    const item = inboxActivities[2]
    if (!item) throw new Error("Expected a reaction notification fixture")

    const { container } = render(
      <ConversationInbox
        items={[
          { ...item, reactionContent: "heart" },
          { ...item, id: 99, reactionContent: "rocket" },
        ]}
        copy={inboxCopy}
        mode="page"
        unreadOnly={false}
        onFilter={() => {}}
        onToggleRead={() => {}}
      />,
    )
    const badges = container.querySelectorAll('.conversation-inbox__kind[data-kind="reaction"]')
    expect(badges[0]?.querySelector("svg")).not.toBeNull()
    const excerpts = container.querySelectorAll(".conversation-inbox__excerpt")
    expect(excerpts[0]).toHaveAttribute("data-reaction", "true")
    expect(excerpts[0]?.textContent).toBe(`${item.excerpt} ❤️`)
    expect(excerpts[1]?.textContent).toBe(`${item.excerpt} 🚀`)
    expect(excerpts[0]?.querySelector(".conversation-inbox__excerpt-text")?.textContent).toBe(
      item.excerpt,
    )
  })

  it("uses one persistent dot control per row and omits native title tooltips", () => {
    const unread = inboxActivities[0]
    const read = inboxActivities[6]
    if (!unread || !read) throw new Error("Expected read and unread notification fixtures")

    const onToggleRead = vi.fn()
    const { container } = render(
      <ConversationInbox
        items={[unread, read]}
        copy={inboxCopy}
        mode="page"
        unreadOnly={false}
        onFilter={() => {}}
        onToggleRead={onToggleRead}
      />,
    )
    const markRead = screen.getByRole("button", { name: `Mark as read: ${unread.actor.login}` })
    const markUnread = screen.getByRole("button", { name: `Mark as unread: ${read.actor.login}` })
    expect(markRead).toHaveAttribute("type", "button")
    expect(markRead).toHaveAttribute("data-read", "false")
    expect(markUnread).toHaveAttribute("data-read", "true")
    expect(markRead.querySelectorAll(".conversation-inbox__dot")).toHaveLength(1)
    expect(markUnread.querySelectorAll(".conversation-inbox__dot")).toHaveLength(1)
    expect(container.querySelectorAll("[title]")).toHaveLength(0)
    const context = container.querySelector(".conversation-inbox__context")
    expect(context).toHaveTextContent(unread.repository)
    expect(context?.querySelector("time")).toHaveAttribute("datetime", unread.createdAt)
    expect(context?.nextElementSibling).toHaveClass("conversation-inbox__excerpt")
    fireEvent.click(markRead)
    expect(onToggleRead).toHaveBeenCalledExactlyOnceWith(unread.id)
  })

  it("allows the dot control to be activated with the keyboard", async () => {
    const item = inboxActivities[0]
    if (!item) throw new Error("Expected a notification fixture")

    const user = userEvent.setup()
    const onToggleRead = vi.fn()
    render(
      <ConversationInbox
        items={[item]}
        copy={inboxCopy}
        unreadOnly
        onFilter={() => {}}
        onToggleRead={onToggleRead}
      />,
    )
    screen.getByRole("button", { name: `Mark as read: ${item.actor.login}` }).focus()
    await user.keyboard(" ")
    expect(onToggleRead).toHaveBeenCalledExactlyOnceWith(item.id)
  })
})
