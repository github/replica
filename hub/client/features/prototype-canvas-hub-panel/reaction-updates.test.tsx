import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"

import { renderPrototypeCanvasHubPanel } from "./test-support/render-prototype-canvas-hub-panel"

describe("PrototypeCanvasHubPanel() reactions", () => {
  it.each([true, false])(
    "retains optimistic reactions through invalidation and reconciles a successful save %s",
    async (successful) => {
      const initial = {
        ...octocatRootComment,
        viewerLastSeenActivityVersion: octocatRootComment.activityVersion,
        reactions: [],
      }
      const saved = {
        ...initial,
        reactions: [{ content: "+1" as const, count: 1, viewerHasReacted: true }],
      }
      let finishSave: ((response: Response) => void) | undefined
      let finishStaleLoad: ((response: Response) => void) | undefined
      let events: ReadableStreamDefaultController<Uint8Array> | undefined
      let loads = 0
      let settled = false
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, options) => {
        if (input === "/api/hub/events") {
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start: (controller) => {
                  events = controller
                },
              }),
            ),
          )
        }
        if (input === "/api/hub/comments/1/reactions" && options?.method === "POST") {
          return new Promise<Response>((resolve) => {
            finishSave = resolve
          })
        }
        loads += 1
        if (loads === 2) {
          return new Promise<Response>((resolve) => {
            finishStaleLoad = resolve
          })
        }
        return Promise.resolve(
          Response.json({
            comments: [successful && settled ? saved : initial],
            hasMore: false,
            nextCursor: null,
          }),
        )
      })
      vi.stubGlobal("fetch", fetchMock)
      const view = renderPrototypeCanvasHubPanel({
        config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
        status: { ...publicationHub, state: "connected", prototype: importedPrototype },
        open: false,
      })
      fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
      fireEvent.click(screen.getByRole("button", { name: /Please align this control/ }))
      await act(async () => {
        events?.enqueue(new TextEncoder().encode("event: comments\ndata: {}\n\n"))
        await Promise.resolve()
      })
      expect(loads).toBe(2)
      const picker = screen.getByRole("button", { name: "Add reaction" })
      fireEvent.click(picker)
      fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ }))
      const reaction = screen.getByRole("button", { name: "Thumbs up, 1 reaction" })
      expect(reaction).toHaveAttribute("aria-pressed", "true")
      expect(picker).toBeEnabled()
      expect(screen.getByRole("button", { name: "Actions for comment by @octocat" })).toBeEnabled()
      await act(async () => {
        finishStaleLoad?.(Response.json({ comments: [initial], hasMore: false, nextCursor: null }))
        await Promise.resolve()
      })
      expect(screen.getByRole("button", { name: "Thumbs up, 1 reaction" })).toBe(reaction)
      await act(async () => {
        settled = true
        finishSave?.(
          successful
            ? Response.json({ comments: [saved] })
            : Response.json({ error: "Reaction failed" }, { status: 500 }),
        )
        await Promise.resolve()
      })
      await waitFor(() => expect(loads).toBe(3))
      if (successful) {
        expect(screen.getByRole("button", { name: "Thumbs up, 1 reaction" })).toBe(reaction)
        expect(reaction).toHaveAttribute("aria-busy", "false")
      } else {
        expect(
          screen.queryByRole("button", { name: "Thumbs up, 1 reaction" }),
        ).not.toBeInTheDocument()
        expect(screen.getByText("The reaction could not be changed.")).toBeVisible()
      }
      expect(screen.getByRole("button", { name: "Add reaction" })).toBe(picker)
      view.unmount()
      await act(async () => {
        events?.close()
        await Promise.resolve()
      })
    },
  )
})
