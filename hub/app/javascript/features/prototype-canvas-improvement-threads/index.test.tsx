import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { ImprovementThreads } from "."
import type { ImprovementThread } from "./types"
import { copy } from "./en"

function pointerDown(
  target: Element,
  { button = 0, isPrimary = true }: { button?: number; isPrimary?: boolean } = {},
) {
  const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button })
  Object.defineProperty(event, "isPrimary", { value: isPrimary })
  fireEvent(target, event)
  return event
}

describe("ImprovementThreads()", () => {
  it.each(["unchanged", "revision", "branch", "away-and-back", "busy"] as const)(
    "fixes only the open note from its menu after %s",
    async (change) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Keep the save action visible",
        target: "Save",
        path: "/projects",
        status: "open",
        originalPending: true,
        messages: [],
      }
      const props = {
        threads: [thread, { ...thread, id: 2, body: "Align the project cards" }],
        identity: "branch",
        open: true,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onFollowUp: vi.fn().mockResolvedValue(true),
        onResolve: vi.fn().mockResolvedValue(true),
        onDelete: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
        onFixSelected: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 1` }))
      const fix = screen.getByRole("menuitem", { name: copy.fixNow })
      expect(screen.getByRole("menuitem", { name: copy.delete })).toBeEnabled()
      if (change === "revision")
        view.rerender(
          <ImprovementThreads
            {...props}
            threads={[{ ...thread, revision: 2 }, props.threads[1]!]}
          />,
        )
      if (change === "branch" || change === "away-and-back")
        view.rerender(<ImprovementThreads {...props} identity="another branch" />)
      if (change === "away-and-back") view.rerender(<ImprovementThreads {...props} />)
      if (change === "busy") view.rerender(<ImprovementThreads {...props} busy />)
      await act(async () => {
        fireEvent.click(fix)
        await Promise.resolve()
      })
      if (change === "unchanged")
        expect(props.onFixSelected).toHaveBeenCalledExactlyOnceWith([thread])
      else expect(props.onFixSelected).not.toHaveBeenCalled()
      expect(props.onFix).not.toHaveBeenCalled()
      expect(props.onDelete).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    "resolves only ready notes in order and stops on failure: %s",
    async (success) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Keep the save action visible",
        target: "Save",
        path: "/projects",
        status: "ready",
        originalPending: false,
        messages: [],
      }
      let finish: (value: boolean) => void
      const onResolve = vi
        .fn<(thread: ImprovementThread) => Promise<boolean>>()
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValue(true)
      const threads: ImprovementThread[] = [
        thread,
        { ...thread, id: 2, status: "open", originalPending: true },
        { ...thread, id: 3, status: "sent" },
        { ...thread, id: 4, status: "blocked" },
        { ...thread, id: 5, status: "resolved" },
        { ...thread, id: 6 },
      ]
      const props = {
        threads,
        identity: "branch",
        open: true,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onFollowUp: vi.fn().mockResolvedValue(true),
        onResolve,
        onDelete: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      expect(screen.queryByRole("button", { name: copy.resolveAll })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
      fireEvent.click(screen.getByRole("menuitemradio", { name: copy.ready }))
      const resolveAll = screen.getByRole("button", { name: copy.resolveAll })
      expect(screen.queryByRole("button", { name: /Fix all/ })).not.toBeInTheDocument()
      fireEvent.click(resolveAll)
      expect(resolveAll).toBeDisabled()
      fireEvent.click(resolveAll)
      expect(onResolve).toHaveBeenCalledExactlyOnceWith(thread)
      await act(async () => {
        finish(success)
        await Promise.resolve()
      })
      await waitFor(() => expect(resolveAll).toBeEnabled())
      expect(onResolve.mock.calls.map(([item]) => item.id)).toEqual(success ? [1, 6] : [1])
      expect(props.onFix).not.toHaveBeenCalled()

      view.rerender(<ImprovementThreads {...props} threads={[]} />)
      expect(resolveAll).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
      fireEvent.click(screen.getByRole("menuitemradio", { name: copy.resolved }))
      expect(screen.queryByRole("button", { name: copy.resolveAll })).not.toBeInTheDocument()
    },
  )

  it.each(["fix", "resolve"] as const)(
    "applies %s only to selected notes eligible for that action",
    async (action) => {
      function makeThread(id: number, body: string, status: "open" | "ready"): ImprovementThread {
        return {
          id,
          revision: 1,
          author: "You",
          body,
          target: "Save",
          path: "/projects",
          status,
          originalPending: status === "open",
          messages: [],
        }
      }
      const open = makeThread(1, "First open note", "open")
      const anotherOpen = makeThread(2, "Second open note", "open")
      const ready = makeThread(3, "First ready note", "ready")
      const anotherReady = makeThread(4, "Second ready note", "ready")
      const unselectedOpen = makeThread(5, "Unselected open note", "open")
      const unselectedReady = makeThread(6, "Unselected ready note", "ready")
      const onFixSelected = vi
        .fn<(items: ImprovementThread[]) => Promise<boolean>>()
        .mockResolvedValue(true)
      const onResolve = vi
        .fn<(item: ImprovementThread) => Promise<boolean>>()
        .mockResolvedValue(true)
      render(
        <ImprovementThreads
          threads={[open, anotherOpen, ready, anotherReady, unselectedOpen, unselectedReady]}
          identity="branch"
          open
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onFollowUp={vi.fn().mockResolvedValue(true)}
          onResolve={onResolve}
          onDelete={vi.fn().mockResolvedValue(true)}
          onFixSelected={onFixSelected}
          onFix={vi.fn().mockResolvedValue(true)}
        />,
      )

      const openCard = screen.getByRole("button", { name: `Open note: ${open.body}` })
      fireEvent.mouseEnter(openCard)
      fireEvent.focus(openCard)
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${open.body}` }))
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${anotherOpen.body}` }))
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${ready.body}` }))
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${anotherReady.body}` }))

      const fix = screen.getByRole("button", { name: "Fix selected 2" })
      const resolve = screen.getByRole("button", { name: "Mark as resolved 2" })
      expect(fix).toBeVisible()
      expect(resolve).toBeVisible()
      expect(screen.getByRole("button", { name: copy.clearSelection })).toBeVisible()

      if (action === "fix") {
        fireEvent.click(fix)
        await waitFor(() =>
          expect(onFixSelected).toHaveBeenCalledExactlyOnceWith([open, anotherOpen]),
        )
        expect(onResolve).not.toHaveBeenCalled()
      } else {
        fireEvent.click(resolve)
        await waitFor(() =>
          expect(onResolve.mock.calls.map(([item]) => item.id)).toEqual([
            ready.id,
            anotherReady.id,
          ]),
        )
        expect(onFixSelected).not.toHaveBeenCalled()
      }
    },
  )

  it.each(["success", "failure", "branch", "away-and-back"] as const)(
    "deletes only the confirmed mixed selection and stops safely on %s",
    async (outcome) => {
      const first: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "First selected request",
        target: "Save",
        path: "/projects",
        status: "open",
        originalPending: true,
        messages: [],
      }
      const second: ImprovementThread = {
        ...first,
        id: 2,
        body: "Second selected request",
        status: "ready",
        originalPending: false,
      }
      const third: ImprovementThread = {
        ...first,
        id: 3,
        body: "Third selected request",
        status: "blocked",
        retryStatus: "blocked",
      }
      const unselected = { ...first, id: 4, body: "Unselected request" }
      let finish: (value: boolean) => void
      const onDelete = vi
        .fn<(item: ImprovementThread) => Promise<boolean>>()
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValue(true)
      const props = {
        threads: [first, second, third, unselected],
        identity: "first branch",
        open: true,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onFollowUp: vi.fn().mockResolvedValue(true),
        onResolve: vi.fn().mockResolvedValue(true),
        onDelete,
        onRetry: vi.fn().mockResolvedValue(true),
        onFixSelected: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      for (const item of [first, second, third]) {
        fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${item.body}` }))
      }
      fireEvent.click(screen.getByRole("button", { name: "Selected note actions" }))
      const menu = screen.getByRole("menu", { name: "Selected note actions" })
      fireEvent.click(within(menu).getByRole("menuitem", { name: copy.delete }))

      const confirmation = screen.getByRole("dialog", { name: "Delete these notes?" })
      for (const item of [first, second, third]) {
        expect(confirmation).toHaveTextContent(item.body)
      }
      expect(confirmation).not.toHaveTextContent(unselected.body)
      expect(onDelete).not.toHaveBeenCalled()
      fireEvent.click(within(confirmation).getByRole("button", { name: copy.delete }))
      await waitFor(() => expect(onDelete.mock.calls.map(([item]) => item.id)).toEqual([1, 2]))
      expect(screen.getByRole("checkbox", { name: `Select note: ${first.body}` })).not.toBeChecked()
      expect(screen.getByRole("checkbox", { name: `Select note: ${second.body}` })).toBeChecked()
      expect(screen.getByRole("checkbox", { name: `Select note: ${third.body}` })).toBeChecked()
      expect(within(confirmation).getByRole("button", { name: copy.delete })).toBeDisabled()

      if (outcome === "branch" || outcome === "away-and-back") {
        view.rerender(<ImprovementThreads {...props} identity="second branch" />)
        if (outcome === "away-and-back") view.rerender(<ImprovementThreads {...props} />)
      }
      await act(async () => {
        finish(outcome !== "failure")
        await Promise.resolve()
      })

      expect(onDelete.mock.calls.map(([item]) => item.id)).toEqual(
        outcome === "success" ? [1, 2, 3] : [1, 2],
      )
      expect(onDelete.mock.calls[0]?.[0]).toEqual(first)
      expect(onDelete.mock.calls[1]?.[0]).toEqual(second)
      expect(
        screen.getByRole("checkbox", { name: `Select note: ${unselected.body}` }),
      ).not.toBeChecked()
      if (outcome === "failure") {
        expect(screen.getByRole("checkbox", { name: `Select note: ${second.body}` })).toBeChecked()
        expect(screen.getByRole("checkbox", { name: `Select note: ${third.body}` })).toBeChecked()
      } else {
        expect(screen.queryByRole("region", { name: copy.selection })).not.toBeInTheDocument()
      }
      expect(props.onRetry).not.toHaveBeenCalled()
      expect(props.onFix).not.toHaveBeenCalled()
      expect(props.onFixSelected).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["blocked", "blocked", copy.retry],
    ["sent", "sent", copy.returnToActive],
    ["blocked", "sent", null],
    ["blocked", undefined, null],
    ["sent", undefined, null],
    [undefined, undefined, null],
  ] as const)(
    "offers recovery only for a homogeneous retry status: %s and %s",
    async (firstStatus, secondStatus, action) => {
      const first: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "First recovery request",
        target: "Save",
        path: "/projects",
        status: "open",
        retryStatus: firstStatus,
        originalPending: true,
        messages: [],
      }
      const second: ImprovementThread = {
        ...first,
        id: 2,
        body: "Second recovery request",
        status: "ready",
        retryStatus: secondStatus,
        originalPending: false,
      }
      const unselected = { ...first, id: 3, body: "Unselected recovery request" }
      const props = {
        threads: [first, second, unselected],
        identity: "branch",
        open: true,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onFollowUp: vi.fn().mockResolvedValue(true),
        onResolve: vi.fn().mockResolvedValue(true),
        onDelete: vi.fn().mockResolvedValue(true),
        onRetry: vi.fn().mockResolvedValue(true),
        onFixSelected: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      for (const item of [first, second]) {
        fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${item.body}` }))
      }
      fireEvent.click(screen.getByRole("button", { name: "Selected note actions" }))
      const menu = screen.getByRole("menu", { name: "Selected note actions" })
      expect(within(menu).getByRole("menuitem", { name: copy.delete })).toBeEnabled()
      for (const label of [copy.retry, copy.returnToActive]) {
        if (label === action) {
          expect(within(menu).getByRole("menuitem", { name: label })).toBeEnabled()
        } else {
          expect(within(menu).queryByRole("menuitem", { name: label })).not.toBeInTheDocument()
        }
      }
      if (action) {
        view.rerender(
          <ImprovementThreads {...props} threads={props.threads.map((item) => ({ ...item }))} />,
        )
        fireEvent.click(screen.getByRole("menuitem", { name: action }))
        await waitFor(() => expect(props.onRetry.mock.calls).toEqual([[first], [second]]))
        expect(screen.queryByRole("region", { name: copy.selection })).not.toBeInTheDocument()
      } else {
        expect(props.onRetry).not.toHaveBeenCalled()
      }
      expect(props.onDelete).not.toHaveBeenCalled()
      expect(props.onResolve).not.toHaveBeenCalled()
      expect(props.onFixSelected).not.toHaveBeenCalled()
      expect(props.onFix).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["blocked", copy.retry, "failure"],
    ["sent", copy.returnToActive, "failure"],
    ["blocked", copy.retry, "branch"],
    ["sent", copy.returnToActive, "branch"],
    ["blocked", copy.retry, "away-and-back"],
    ["sent", copy.returnToActive, "away-and-back"],
  ] as const)("stops selected %s recovery using %s on %s", async (status, action, outcome) => {
    const first: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "First recovery request",
      target: "Save",
      path: "/projects",
      status,
      retryStatus: status,
      originalPending: false,
      messages: [],
    }
    const second = { ...first, id: 2, body: "Failed recovery request" }
    const third = { ...first, id: 3, body: "Remaining recovery request" }
    let finish: (value: boolean) => void
    const onRetry = vi
      .fn<(item: ImprovementThread) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue(true)
    const props = {
      threads: [first, second, third],
      identity: "first branch",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onRetry,
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    for (const item of [first, second, third]) {
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${item.body}` }))
    }
    fireEvent.click(screen.getByRole("button", { name: "Selected note actions" }))
    fireEvent.click(screen.getByRole("menuitem", { name: action }))
    await waitFor(() => expect(onRetry.mock.calls).toEqual([[first], [second]]))
    expect(screen.getByRole("checkbox", { name: `Select note: ${first.body}` })).not.toBeChecked()
    if (outcome === "branch" || outcome === "away-and-back") {
      view.rerender(<ImprovementThreads {...props} identity="second branch" />)
      if (outcome === "away-and-back") view.rerender(<ImprovementThreads {...props} />)
    }
    await act(async () => {
      finish(outcome !== "failure")
      await Promise.resolve()
    })
    expect(onRetry.mock.calls).toEqual([[first], [second]])
    if (outcome === "failure") {
      for (const item of [second, third]) {
        expect(screen.getByRole("checkbox", { name: `Select note: ${item.body}` })).toBeChecked()
      }
      expect(screen.getByRole("button", { name: "Selected note actions" })).toBeEnabled()
    } else {
      expect(screen.queryByRole("region", { name: copy.selection })).not.toBeInTheDocument()
    }
    expect(props.onFix).not.toHaveBeenCalled()
  })

  it.each([
    ["menu", copy.delete, "selection"],
    ["menu", copy.retry, "revision"],
    ["menu", copy.returnToActive, "identity"],
    ["menu", copy.retry, "away-and-back"],
    ["confirmation", copy.delete, "selection"],
    ["confirmation", copy.delete, "revision"],
    ["confirmation", copy.delete, "identity"],
    ["confirmation", copy.delete, "away-and-back"],
  ] as const)(
    "rejects a stale selected-note %s for %s after %s changes",
    async (stage, action, change) => {
      const first: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "First selected request",
        target: "Save",
        path: "/projects",
        status: "blocked",
        retryStatus: action === copy.returnToActive ? "sent" : "blocked",
        originalPending: false,
        messages: [],
      }
      const second = { ...first, id: 2, body: "Second selected request" }
      const props = {
        threads: [first, second],
        identity: "first branch",
        open: true,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onFollowUp: vi.fn().mockResolvedValue(true),
        onResolve: vi.fn().mockResolvedValue(true),
        onDelete: vi.fn().mockResolvedValue(true),
        onRetry: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      for (const item of [first, second]) {
        fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${item.body}` }))
      }
      fireEvent.click(screen.getByRole("button", { name: "Selected note actions" }))
      if (stage === "confirmation") {
        fireEvent.click(screen.getByRole("menuitem", { name: copy.delete }))
        expect(screen.getByRole("dialog", { name: "Delete these notes?" })).toBeInTheDocument()
      }
      if (change === "selection") {
        fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${second.body}` }))
      } else if (change === "revision") {
        view.rerender(
          <ImprovementThreads {...props} threads={[first, { ...second, revision: 2 }]} />,
        )
      } else {
        view.rerender(<ImprovementThreads {...props} identity="second branch" />)
        if (change === "away-and-back") view.rerender(<ImprovementThreads {...props} />)
      }
      const staleAction = screen.queryByRole(stage === "menu" ? "menuitem" : "button", {
        name: action,
      })
      if (staleAction) {
        await act(async () => {
          fireEvent.click(staleAction)
          await Promise.resolve()
        })
      }
      expect(props.onDelete).not.toHaveBeenCalled()
      expect(props.onRetry).not.toHaveBeenCalled()
      if (stage === "menu") {
        expect(
          screen.queryByRole("dialog", { name: "Delete these notes?" }),
        ).not.toBeInTheDocument()
      }
    },
  )

  it.each(["busy", "draft"] as const)(
    "protects selected notes from deletion and recovery during %s",
    (blockedBy) => {
      const thread: ImprovementThread = {
        id: 1,
        revision: 1,
        author: "You",
        body: "Selected recovery request",
        target: "Save",
        path: "/projects",
        status: "blocked",
        retryStatus: "blocked",
        originalPending: false,
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
        onRetry: vi.fn().mockResolvedValue(true),
        onFix: vi.fn().mockResolvedValue(true),
      }
      const view = render(<ImprovementThreads {...props} />)
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${thread.body}` }))
      fireEvent.click(screen.getByRole("button", { name: "Selected note actions" }))
      if (blockedBy === "busy") {
        view.rerender(<ImprovementThreads {...props} busy />)
      } else {
        fireEvent.click(screen.getByRole("button", { name: `Open note: ${thread.body}` }))
        fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
          target: { value: "Unsaved recovery follow-up" },
        })
      }
      const button = screen.getByRole("button", { name: "Selected note actions" })
      expect(button).toBeDisabled()
      fireEvent.click(button)
      for (const label of [copy.delete, copy.retry]) {
        const item = screen.queryByRole("menuitem", { name: label })
        if (item) {
          fireEvent.click(item)
        }
      }
      expect(props.onDelete).not.toHaveBeenCalled()
      expect(props.onRetry).not.toHaveBeenCalled()
      expect(screen.queryByRole("dialog", { name: "Delete these notes?" })).not.toBeInTheDocument()
      if (blockedBy === "draft") {
        expect(screen.getByRole("textbox", { name: copy.comments.replyLabel })).toHaveValue(
          "Unsaved recovery follow-up",
        )
      }
    },
  )

  it("clears note selection when the filter, sidebar, or branch changes", () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Keep the save action visible",
      target: "Save",
      path: "/projects",
      status: "open",
      originalPending: true,
      messages: [],
    }
    const props = {
      threads: [thread],
      identity: "first branch",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve: vi.fn().mockResolvedValue(true),
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    function selection() {
      return screen.queryByRole("region", { name: copy.selection })
    }
    function selectNote() {
      fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${thread.body}` }))
      expect(selection()).toBeInTheDocument()
    }
    function chooseFilter(label: string) {
      fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
      fireEvent.click(screen.getByRole("menuitemradio", { name: label }))
    }

    selectNote()
    chooseFilter(copy.ready)
    expect(selection()).not.toBeInTheDocument()
    chooseFilter(copy.allActive)
    expect(selection()).not.toBeInTheDocument()

    selectNote()
    view.rerender(<ImprovementThreads {...props} open={false} />)
    expect(selection()).not.toBeInTheDocument()
    view.rerender(<ImprovementThreads {...props} />)
    expect(selection()).not.toBeInTheDocument()

    selectNote()
    view.rerender(<ImprovementThreads {...props} identity="second branch" />)
    expect(selection()).not.toBeInTheDocument()
  })

  it("stops resolving selected notes when the branch changes during a save", async () => {
    const first: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "First ready note",
      target: "Save",
      path: "/projects",
      status: "ready",
      originalPending: false,
      messages: [],
    }
    const second: ImprovementThread = { ...first, id: 2, body: "Second ready note" }
    let finish: ((success: boolean) => void) | undefined
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve
    })
    const onResolve = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(true)
    const props = {
      threads: [first, second],
      identity: "first branch",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve,
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)

    fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${first.body}` }))
    fireEvent.click(screen.getByRole("checkbox", { name: `Select note: ${second.body}` }))
    fireEvent.click(screen.getByRole("button", { name: "Mark as resolved 2" }))
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(first)

    view.rerender(<ImprovementThreads {...props} identity="second branch" />)
    await act(async () => {
      if (!finish) throw new Error("Expected the first selected note to be saving.")
      finish(true)
      await pending
    })

    expect(onResolve).toHaveBeenCalledExactlyOnceWith(first)
  })

  it("stops bulk resolution when the branch changes away and back while a note is saving", async () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Keep the save action visible",
      target: "Save",
      path: "/projects",
      status: "ready",
      originalPending: false,
      messages: [],
    }
    let finish: (value: boolean) => void
    const onResolve = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    const props = {
      threads: [thread, { ...thread, id: 2 }],
      identity: "first",
      open: true,
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onFollowUp: vi.fn().mockResolvedValue(true),
      onResolve,
      onDelete: vi.fn().mockResolvedValue(true),
      onFix: vi.fn().mockResolvedValue(true),
    }
    const view = render(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: copy.ready }))
    fireEvent.click(screen.getByRole("button", { name: copy.resolveAll }))
    view.rerender(<ImprovementThreads {...props} identity="second" />)
    view.rerender(<ImprovementThreads {...props} identity="first" />)
    await act(async () => {
      finish(true)
      await Promise.resolve()
    })
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(thread)
  })

  it("blocks bulk resolution during saving and protects an unsaved follow-up", () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Keep the save action visible",
      target: "Save",
      path: "/projects",
      status: "ready",
      originalPending: false,
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
    const view = render(<ImprovementThreads {...props} busy />)
    fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: copy.ready }))
    const resolveAll = screen.getByRole("button", { name: copy.resolveAll })
    expect(resolveAll).toBeDisabled()
    view.rerender(<ImprovementThreads {...props} />)
    expect(resolveAll).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: `Open note: ${thread.body}` }))
    const input = screen.getByRole("textbox", { name: copy.comments.replyLabel })
    fireEvent.change(input, { target: { value: "Keep this follow-up" } })
    expect(resolveAll).toBeDisabled()
    fireEvent.click(resolveAll)
    expect(props.onResolve).not.toHaveBeenCalled()
    expect(input).toHaveValue("Keep this follow-up")
  })

  it("names the conversation from the saved target", () => {
    const thread: ImprovementThread = {
      id: 1,
      revision: 1,
      author: "You",
      body: "Original request",
      target: "Save project",
      path: "/projects",
      status: "open",
      originalPending: true,
      messages: [],
      point: { x: 120, y: 100 },
    }
    render(
      <ImprovementThreads
        threads={[thread]}
        identity="branch"
        open
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onFollowUp={vi.fn().mockResolvedValue(true)}
        onResolve={vi.fn().mockResolvedValue(true)}
        onDelete={vi.fn().mockResolvedValue(true)}
        onFix={vi.fn().mockResolvedValue(true)}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: copy.point(1) }))
    const conversation = screen.getByRole("dialog", { name: thread.target })
    expect(within(conversation).getByRole("heading", { name: thread.target })).toBeVisible()
  })

  it("closes a selected conversation on an outside pointer without restoring its opener", () => {
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
    render(
      <>
        <button onPointerDown={(event) => event.currentTarget.focus()}>Canvas action</button>
        <ImprovementThreads
          threads={[thread]}
          identity="branch"
          open
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onFollowUp={vi.fn().mockResolvedValue(true)}
          onResolve={vi.fn().mockResolvedValue(true)}
          onDelete={vi.fn().mockResolvedValue(true)}
          onFix={vi.fn().mockResolvedValue(true)}
        />
      </>,
    )
    const opener = screen.getByRole("button", { name: copy.point(1) })
    const outside = screen.getByRole("button", { name: "Canvas action" })
    fireEvent.click(opener)

    const event = pointerDown(outside)

    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole("dialog", { name: thread.target })).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })

  it("keeps thread, menu, and deletion interactions open", () => {
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
      point: { x: 120, y: 100 },
    }
    render(
      <>
        <button>Canvas action</button>
        <ImprovementThreads
          threads={[thread]}
          identity="branch"
          open
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onFollowUp={vi.fn().mockResolvedValue(true)}
          onResolve={vi.fn().mockResolvedValue(true)}
          onDelete={vi.fn().mockResolvedValue(true)}
          onFix={vi.fn().mockResolvedValue(true)}
        />
      </>,
    )
    const card = screen.getByRole("button", { name: "Open note: Original request" })
    fireEvent.click(card)
    const conversation = screen.getByRole("dialog", { name: thread.target })

    pointerDown(card)
    expect(conversation).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Note actions: 1" }))
    const menuDelete = screen.getByRole("menuitem", { name: copy.delete })
    pointerDown(menuDelete)
    expect(conversation).toBeInTheDocument()
    fireEvent.click(menuDelete)

    const confirmation = screen.getByRole("dialog", { name: copy.deleteTitle })
    pointerDown(within(confirmation).getByRole("button", { name: copy.delete }))
    pointerDown(screen.getByRole("button", { name: "Canvas action" }))
    expect(confirmation).toBeInTheDocument()
    expect(conversation).toBeInTheDocument()
  })

  it("prompts before dismissing a nonblank draft and preserves Keep", () => {
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
    render(
      <>
        <button>Canvas action</button>
        <ImprovementThreads
          threads={[thread]}
          identity="branch"
          open
          onOpen={vi.fn()}
          onClose={vi.fn()}
          onFollowUp={vi.fn().mockResolvedValue(true)}
          onResolve={vi.fn().mockResolvedValue(true)}
          onDelete={vi.fn().mockResolvedValue(true)}
          onFix={vi.fn().mockResolvedValue(true)}
        />
      </>,
    )
    fireEvent.click(screen.getByRole("button", { name: copy.point(1) }))
    fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      target: { value: "Keep this draft" },
    })
    const outside = screen.getByRole("button", { name: "Canvas action" })

    pointerDown(outside)
    const prompt = screen.getByText(copy.comments.threadDiscardPromptLabel)
    expect(prompt).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: copy.comments.keepLabel }))
    expect(screen.getByRole("textbox", { name: copy.comments.replyLabel })).toHaveValue(
      "Keep this draft",
    )
    expect(screen.getByRole("dialog", { name: thread.target })).toBeInTheDocument()
  })

  it("keeps filter and sidebar close pointer sequences inside their guarded flows", () => {
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
    const onClose = vi.fn()
    render(
      <ImprovementThreads
        threads={[thread]}
        identity="branch"
        open
        onOpen={vi.fn()}
        onClose={onClose}
        onFollowUp={vi.fn().mockResolvedValue(true)}
        onResolve={vi.fn().mockResolvedValue(true)}
        onDelete={vi.fn().mockResolvedValue(true)}
        onFix={vi.fn().mockResolvedValue(true)}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Open note: Original request" }))
    const conversation = screen.getByRole("dialog", { name: thread.target })
    const filter = screen.getByRole("button", { name: /^Filter notes:/ })

    pointerDown(filter)
    fireEvent.click(filter)
    expect(conversation).toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitemradio", { name: copy.allActive }))

    fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      target: { value: "Keep this draft" },
    })
    const close = screen.getByRole("button", { name: copy.close })
    pointerDown(close)
    fireEvent.click(close)
    expect(screen.getByText(copy.comments.threadDiscardPromptLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: copy.comments.discardButtonLabel }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog", { name: thread.target })).not.toBeInTheDocument()
  })

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
      fireEvent.click(screen.getByRole("button", { name: "Open note: Original request" }))
      fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 1` }))
      fireEvent.click(screen.getByRole("menuitem", { name: copy.delete }))
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
        expect(screen.queryByRole("dialog", { name: thread.target })).not.toBeInTheDocument()
        expect(screen.queryByRole("dialog", { name: copy.deleteTitle })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: copy.point(1) })).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: copy.open })).toHaveFocus()
      } else {
        expect(screen.getByRole("dialog", { name: thread.target })).toBeInTheDocument()
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

  it("keeps open note actions disabled during mutations and over an unsaved draft", () => {
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
    view.rerender(<ImprovementThreads {...props} busy />)
    const deleteAction = screen.getByRole("button", { name: `${copy.actions}: 1` })
    expect(deleteAction).toBeDisabled()
    fireEvent.click(deleteAction)
    expect(screen.queryByRole("dialog", { name: copy.deleteTitle })).not.toBeInTheDocument()
    view.rerender(<ImprovementThreads {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Open note: Original request" }))
    fireEvent.change(screen.getByRole("textbox", { name: copy.comments.replyLabel }), {
      target: { value: "Unsaved follow-up" },
    })
    expect(screen.getByRole("button", { name: `${copy.actions}: 1` })).toBeDisabled()
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
        fireEvent.click(screen.getByRole("button", { name: /^Filter notes:/ }))
        fireEvent.click(screen.getByRole("menuitemradio", { name: copy.resolved }))
      }
      if (status !== "ready" && status !== "open") {
        expect(screen.queryByRole("button", { name: "Note actions: 1" })).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: `${copy.delete}: 1` })).toHaveClass(
          "thread-sample__single-delete",
        )
        expect(onResolve).not.toHaveBeenCalled()
        return
      }
      fireEvent.click(screen.getByRole("button", { name: "Note actions: 1" }))
      expect(screen.queryByRole("menuitem", { name: "Add follow-up" })).not.toBeInTheDocument()
      if (status === "open") {
        expect(screen.queryByRole("menuitem", { name: copy.markResolved })).not.toBeInTheDocument()
        expect(screen.getByRole("menuitem", { name: copy.delete })).toBeEnabled()
        expect(onResolve).not.toHaveBeenCalled()
        return
      }
      const resolve = screen.queryByRole("menuitem", { name: copy.markResolved })
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
      fireEvent.click(screen.getByRole("button", { name: "Note actions: 1" }))
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
    fireEvent.click(screen.getByRole("button", { name: "Note actions: 1" }))
    expect(
      screen.getByRole("menuitem", { name: action }).querySelector(".octicon-sync"),
    ).not.toBeNull()
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
    fireEvent.click(screen.getByRole("button", { name: "Note actions: 1" }))
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
    fireEvent.click(screen.getByRole("button", { name: "Open note: Original request" }))
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
    fireEvent.click(screen.getByRole("button", { name: `${copy.actions}: 1` }))
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
    fireEvent.click(screen.getByRole("button", { name: "Open note: Original request" }))
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
    expect(screen.queryByRole("dialog", { name: thread.target })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: copy.open })).toHaveFocus()
    expect(props.onFollowUp).not.toHaveBeenCalled()
  })
})
