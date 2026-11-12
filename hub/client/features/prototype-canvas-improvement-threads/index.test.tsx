import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { ImprovementThreads } from "."
import type { ImprovementThread } from "./types"
import { copy } from "./en"

describe("ImprovementThreads()", () => {
  it.each([true, false])(
    "only closes its own selected conversation after successful deletion: %s",
    async (success) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Original request",
        target: "Save",
        path: "/projects",
        status: "open",
        originalPending: true,
        messages: [],
        point: { x: 120, y: 100 },
      }
      const onDelete = vi
        .fn<(item: ImprovementThread) => Promise<boolean>>()
        .mockResolvedValue(success)
      function Harness() {
        const [threads, setThreads] = useState([thread])
        return (
          <ImprovementThreads
            threads={threads}
            identity="branch"
            open
            onOpen={vi.fn()}
            onClose={vi.fn()}
            onFollowUp={vi.fn().mockResolvedValue(true)}
            onResolve={vi.fn().mockResolvedValue(true)}
            onFix={vi.fn().mockResolvedValue(true)}
            error={success ? "" : "The improvement could not be deleted."}
            onDelete={async (item) => {
              const deleted: boolean = await onDelete(item)
              if (deleted) setThreads([])
              return deleted
            }}
          />
        )
      }
      render(<Harness />)
      fireEvent.click(screen.getByRole("button", { name: "Open improvement: Original request" }))
      fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
      const menuDelete = screen.getByRole("menuitem", { name: copy.delete })
      expect(menuDelete).toHaveAttribute("aria-disabled", "false")
      fireEvent.click(menuDelete)
      const confirmation = screen.getByRole("dialog", { name: copy.deleteTitle })
      expect(confirmation.querySelector("blockquote")).toHaveTextContent(thread.body)
      expect(confirmation).not.toHaveTextContent(
        "This improvement and its follow-ups will be removed",
      )
      await act(async () => {
        fireEvent.click(within(confirmation).getByRole("button", { name: copy.delete }))
        await Promise.resolve()
      })
      expect(onDelete).toHaveBeenCalledExactlyOnceWith(thread)
      if (success) {
        expect(screen.queryByRole("dialog", { name: copy.conversation })).not.toBeInTheDocument()
        expect(screen.queryByRole("dialog", { name: copy.deleteTitle })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: copy.point(1) })).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: copy.open })).toHaveFocus()
      } else {
        expect(screen.getByRole("dialog", { name: copy.conversation })).toBeInTheDocument()
        expect(screen.getByRole("dialog", { name: copy.deleteTitle })).toBeInTheDocument()
        expect(confirmation).toHaveTextContent("The improvement could not be deleted.")
        for (const alert of screen.getAllByRole("alert")) {
          expect(alert).toBeVisible()
        }
        expect(screen.getByRole("button", { name: copy.point(1) })).toHaveAttribute(
          "aria-expanded",
          "true",
        )
      }
    },
  )

  it("keeps Delete disabled during mutations and prevents opening its menu over an unsaved draft", () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save",
      path: "/projects",
      status: "open",
      originalPending: true,
      messages: [],
    }
    const props = {
      threads: [thread],
      identity: "branch",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
    view.rerender(<ImprovementThreads {...props} busy />)
    expect(screen.getByRole("menuitem", { name: copy.delete })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    fireEvent.click(screen.getByRole("menuitem", { name: copy.delete }))
    expect(screen.queryByRole("dialog", { name: copy.deleteTitle })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menuitem", { name: copy.delete }), { key: "Escape" })
    view.rerender(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Open improvement: Original request" }))
    fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      target: { value: "Unsaved follow-up" },
    })
    expect(screen.getByRole("button", { name: "Improvement actions: 1" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: copy.comments.replyLabel })).toHaveValue(
      "Unsaved follow-up",
    )
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it.each([0, 1, 3])(
    "always shows a counter for %i pending requests, excluding history",
    (count) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Original request",
        target: "Save",
        path: "/projects",
        status: count ? "open" : "ready",
        originalPending: count > 0,
        messages: [
          ...Array.from({ length: Math.max(0, count - 1) }, (_, id) => ({
            id: `pending-${id}`,
            role: "author" as const,
            body: "Follow-up",
            pending: true,
          })),
          { id: "answer", role: "copilot", body: "Earlier answer", pending: false },
          { id: "earlier-request", role: "author", body: "Earlier request", pending: false },
        ],
      }
      const onFix = vi.fn().mockResolvedValue(true)
      render(
        <ImprovementThreads
          threads={[
            thread,
            { ...thread, id: 2, status: "resolved", originalPending: false, messages: [] },
          ]}
          identity="branch"
          open
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onFollowUp={vi.fn().mockResolvedValue(true)}
          onDelete={vi.fn().mockResolvedValue(true)}
          onResolve={vi.fn().mockResolvedValue(true)}
          onFix={onFix}
        />,
      )
      const fix = screen.getByRole("button", { name: copy.simulate(count) })
      expect(fix).toHaveTextContent(String(count))
      if (count) expect(fix).toBeEnabled()
      else expect(fix).toBeDisabled()
      expect(onFix).not.toHaveBeenCalled()
    },
  )

  it.each(["open", "sent", "blocked", "ready", "resolved"] as const)(
    "only renders sidebar resolution for ready work, not %s",
    (status) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Original request",
        target: "Save",
        path: "/projects",
        status,
        originalPending: status === "open",
        messages: [],
      }
      const onResolve = vi.fn().mockResolvedValue(true)
      render(
        <ImprovementThreads
          threads={[thread]}
          identity="branch"
          open
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onFollowUp={vi.fn().mockResolvedValue(true)}
          onDelete={vi.fn().mockResolvedValue(true)}
          onResolve={onResolve}
          onFix={vi.fn().mockResolvedValue(true)}
        />,
      )
      if (status === "resolved") {
        fireEvent.click(screen.getByRole("button", { name: /^Filter improvement notes:/ }))
        fireEvent.click(screen.getByRole("menuitemradio", { name: copy.resolved }))
      }
      fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
      expect(screen.queryByRole("menuitem", { name: "Add follow-up" })).not.toBeInTheDocument()
      const resolve = screen.queryByRole("menuitem", { name: copy.markResolved })
      if (status !== "ready") {
        expect(resolve).not.toBeInTheDocument()
        expect(screen.getByRole("menuitem", { name: copy.delete })).toBeVisible()
        expect(onResolve).not.toHaveBeenCalled()
        return
      }
      if (!resolve) throw new Error("Expected the ready-work resolution action.")
      expect(resolve).toBeEnabled()
      fireEvent.click(resolve)
      expect(onResolve).toHaveBeenCalledExactlyOnceWith(thread)
    },
  )

  it.each(["identity", "revision", "busy"] as const)(
    "blocks a sidebar resolution after its captured %s changes",
    (change) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Original request",
        target: "Save",
        path: "/projects",
        status: "ready",
        originalPending: false,
        messages: [],
      }
      const props = {
        threads: [thread],
        identity: "first",
        open: true,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onFollowUp: vi.fn().mockResolvedValue(true),
        onResolve: vi.fn().mockResolvedValue(false),
        onDelete: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
      view.rerender(
        <ImprovementThreads
          {...props}
          identity={change === "identity" ? "second" : props.identity}
          threads={change === "revision" ? [{ ...thread, revision: 2 }] : props.threads}
          busy={change === "busy"}
        />,
      )
      fireEvent.click(screen.getByRole("menuitem", { name: copy.markResolved }))
      expect(props.onResolve).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["blocked", copy.retry],
    ["sent", copy.returnToActive],
  ] as const)("dispatches %s work from an unchanged menu", (status, action) => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save",
      path: "/projects",
      status,
      retryStatus: status,
      originalPending: false,
      messages: [],
    }
    const onRetry = vi.fn().mockResolvedValue(true)
    const props = {
      threads: [thread],
      identity: "branch",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
      onRetry,
    }
    const view = render(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
    view.rerender(<ImprovementThreads {...props} threads={[{ ...thread }]} />)
    fireEvent.click(screen.getByRole("menuitem", { name: action }))
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(thread)
  })

  it.each([
    ["identity", "blocked", copy.retry],
    ["revision", "sent", copy.returnToActive],
    ["busy", "blocked", copy.retry],
  ] as const)("blocks %s changes after opening a %s work menu", (change, status, action) => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save",
      path: "/projects",
      status,
      retryStatus: status,
      originalPending: false,
      messages: [],
    }
    const props = {
      threads: [thread],
      identity: "first",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
      onRetry: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
    view.rerender(
      <ImprovementThreads
        {...props}
        identity={change === "identity" ? "second" : props.identity}
        threads={change === "revision" ? [{ ...thread, revision: 2 }] : props.threads}
        busy={change === "busy"}
      />,
    )
    fireEvent.click(screen.getByRole("menuitem", { name: action }))
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it("keeps the focused composer and newer draft text while an earlier follow-up is saving", async () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save",
      path: "/projects",
      status: "open",
      originalPending: true,
      messages: [],
    }
    let complete: ((value: boolean) => void) | undefined
    const pending = new Promise<boolean>((resolve) => {
      complete = resolve
    })
    const onFollowUp = vi.fn(() => pending)
    render(
      <ImprovementThreads
        threads={[thread]}
        identity="branch"
        open
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onFollowUp={onFollowUp}
        onDelete={vi.fn().mockResolvedValue(true)}
        onResolve={vi.fn().mockResolvedValue(true)}
        onFix={vi.fn().mockResolvedValue(true)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open improvement: Original request" }))
    const input = screen.getByRole("textbox", { name: copy.comments.replyLabel })
    fireEvent.change(input, { target: { value: "First follow-up" } })
    fireEvent.click(screen.getByRole("button", { name: copy.comments.replySubmitLabel }))
    expect(input).toHaveFocus()
    expect(input).toBeEnabled()
    expect(screen.getByRole("button", { name: copy.comments.replySubmitLabel })).toBeDisabled()
    fireEvent.change(input, { target: { value: "A newer unsaved draft" } })
    await act(async () => {
      if (!complete) throw new Error("Expected a pending follow-up.")
      complete(true)
      await pending
    })
    expect(input).toHaveValue("A newer unsaved draft")
    expect(input).toHaveFocus()
    expect(onFollowUp).toHaveBeenCalledExactlyOnceWith(thread, "First follow-up")
  })

  it("blocks an opened deletion confirmation after the branch or author identity changes", () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save",
      path: "/projects",
      status: "open",
      originalPending: true,
      messages: [],
    }
    const props = {
      threads: [thread],
      identity: "first",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Improvement actions: 1" }))
    fireEvent.click(screen.getByRole("menuitem", { name: copy.delete }))
    view.rerender(<ImprovementThreads {...props} identity="second" />)
    expect(screen.getByRole("alert")).toHaveTextContent(copy.changedIdentity)
    const confirm = screen.getByRole("button", { name: copy.delete })
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it("keeps an unavailable thread and its draft dismissible after another panel deletes the note", () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save",
      path: "/projects",
      status: "open",
      originalPending: true,
      messages: [],
    }
    const props = {
      threads: [thread],
      identity: "first",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Open improvement: Original request" }))
    fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      target: { value: "Unsaved follow-up" },
    })
    view.rerender(<ImprovementThreads {...props} threads={[]} />)
    expect(screen.getByRole("alert")).toHaveTextContent(copy.removed)
    expect(screen.getByRole("textbox", { name: copy.comments.replyLabel })).toHaveValue(
      "Unsaved follow-up",
    )
    expect(screen.getByRole("button", { name: copy.back })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: copy.back }))
    fireEvent.click(screen.getByRole("button", { name: copy.comments.discardButtonLabel }))
    expect(screen.queryByRole("dialog", { name: copy.conversation })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: copy.open })).toHaveFocus()
    expect(props.onFollowUp).not.toHaveBeenCalled()
  })
})
