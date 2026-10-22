import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"

import { renderPrototypeCanvasHubPanel } from "./test-support/render-prototype-canvas-hub-panel"

describe("PrototypeCanvasHubPanel()", () => {
  it("opens an earlier comment Build on the selected Hub rather than the loopback canvas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input) => {
        if (input === "/api/hub/events") return Promise.reject(new Error("Offline"))
        return Promise.resolve(
          Response.json({ comments: [octocatRootComment], hasMore: false, nextCursor: null }),
        )
      }),
    )
    renderPrototypeCanvasHubPanel({
      config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
      status: {
        ...publicationHub,
        state: "connected",
        prototype: {
          ...importedPrototype,
          build: { ...importedPrototype.build!, number: 2 },
        },
      },
      open: false,
    })
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))

    const buildLink = screen.getByRole("link", { name: "build 1" })
    expect(buildLink).toHaveAttribute(
      "href",
      `https://hub.example.com${octocatRootComment.buildPath}`,
    )
    expect(buildLink).toHaveAttribute("target", "_blank")
    expect(buildLink).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("persists unread through the canvas proxy, keeps the draft open, and reads on reopening", async () => {
    let lastSeen: number | null = octocatRootComment.activityVersion
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, options) => {
      if (input === "/api/hub/events") return Promise.reject(new Error("Offline"))
      if (input === "/api/hub/comments/1/read") {
        lastSeen = options?.method === "DELETE" ? null : octocatRootComment.activityVersion
      }
      return Promise.resolve(
        Response.json({
          comments: [{ ...octocatRootComment, viewerLastSeenActivityVersion: lastSeen }],
          hasMore: false,
          nextCursor: null,
        }),
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    renderPrototypeCanvasHubPanel({
      config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
      status: { ...publicationHub, state: "connected", prototype: importedPrototype },
      open: false,
    })
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
    fireEvent.click(screen.getByRole("button", { name: /Please align this control/ }))
    const dialog = screen.getByRole("dialog", { name: reviewCommentsCopy.threadHeading })
    const reply = within(dialog).getByRole("textbox", { name: "Reply" })
    fireEvent.change(reply, { target: { value: "Keep this draft." } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Actions for comment by @octocat" }))
    fireEvent.click(screen.getByRole("menuitem", { name: reviewCommentsCopy.markUnreadLabel }))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Please align this control/ }),
      ).toHaveAccessibleName(/Unread/),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/comments/1/read",
      expect.objectContaining({ method: "DELETE" }),
    )
    expect(dialog).toBeInTheDocument()
    expect(reply).toHaveValue("Keep this draft.")
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/hub/comments/1/read",
      expect.objectContaining({ method: "POST" }),
    )
    fireEvent.change(reply, { target: { value: "" } })
    fireEvent.click(
      within(dialog).getByRole("button", { name: reviewCommentsCopy.backToCommentsLabel }),
    )
    expect(dialog).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Please align this control/ }))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Please align this control/ }),
      ).not.toHaveAccessibleName(/Unread/),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hub/comments/1/read",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("keeps throttled comments and the draft until the Hub changes", async () => {
    const message = "Too many requests. No changes were made. Wait 60 seconds, then try again."
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, options) => {
      if (input === "/api/hub/events") return Promise.reject(new Error("Offline"))
      if (input === "/api/hub/comments/1/replies" && options?.method === "POST")
        return Promise.resolve(Response.json({ error: message }, { status: 429 }))
      return Promise.resolve(
        Response.json({ comments: [octocatRootComment], hasMore: false, nextCursor: null }),
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
    const dialog = screen.getByRole("dialog", { name: reviewCommentsCopy.threadHeading })
    const reply = within(dialog).getByRole("textbox", { name: "Reply" })
    fireEvent.change(reply, { target: { value: "Keep this draft." } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Reply" }))
    expect(await screen.findByText(message)).toBeVisible()
    expect(reply).toHaveValue("Keep this draft.")
    expect(dialog).toHaveTextContent(/Please align this control/)
    expect(
      fetchMock.mock.calls.filter(
        ([input, options]) => input === "/api/hub/comments/1/replies" && options?.method === "POST",
      ),
    ).toHaveLength(1)
    view.rerender({
      config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
      status: {
        ...publicationHub,
        state: "connected",
        hubOrigin: "https://other-hub.example.test",
        prototype: importedPrototype,
      },
      open: false,
    })
    await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument())
    expect(
      fetchMock.mock.calls.filter(
        ([input, options]) => input === "/api/hub/comments/1/replies" && options?.method === "POST",
      ),
    ).toHaveLength(1)
    view.unmount()
  })

  it.each([false, true])(
    "keeps comments open state %s when opening a pin and posting a new thread",
    async (commentsOpen) => {
      const nonce = "00000000-0000-4000-8000-000000000010"
      vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
      const frameRef = createRef<HTMLIFrameElement>()
      const onFrameLoad = vi.fn()
      const created = {
        ...octocatRootComment,
        id: 2,
        body: "Please update this heading.",
        viewerLastSeenActivityVersion: 2,
      }
      let commentCreated = false
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, options) => {
        if (input === "/api/hub/events") return Promise.reject(new Error("Offline"))
        if (input === "/api/hub/status")
          return Promise.resolve(
            Response.json({ ...publicationHub, state: "connected", prototype: importedPrototype }),
          )
        if (input === "/api/hub/comments" && options?.method === "POST") {
          commentCreated = true
          return Promise.resolve(Response.json({ comments: [created] }, { status: 201 }))
        }
        return Promise.resolve(
          Response.json({
            comments: [octocatRootComment, ...(commentCreated ? [created] : [])],
            hasMore: false,
            nextCursor: null,
          }),
        )
      })
      vi.stubGlobal("fetch", fetchMock)
      const view = renderPrototypeCanvasHubPanel(
        {
          config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
          frameRef,
          status: { ...publicationHub, state: "connected", prototype: importedPrototype },
          open: false,
        },
        <iframe ref={frameRef} title="Prototype" src="about:blank" onLoad={onFrameLoad} />,
      )
      const toggle = await screen.findByRole("button", { name: /^Comments, 1/ })
      await waitFor(() => expect(onFrameLoad).toHaveBeenCalled())
      Object.defineProperties(frameRef.current, {
        clientWidth: { value: 800 },
        clientHeight: { value: 600 },
      })
      const postMessage = vi.spyOn(frameRef.current!.contentWindow!, "postMessage")
      fireEvent.load(frameRef.current!)
      await waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          {
            type: "replica:canvas:resolve",
            nonce,
            anchors: [{ id: octocatRootComment.id, anchor: octocatRootComment.anchor }],
          },
          "http://localhost:4321",
        ),
      )
      function receive(data: Record<string, unknown>) {
        act(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: frameRef.current?.contentWindow,
              origin: "http://localhost:4321",
              data: { nonce, ...data },
            }),
          )
        })
      }
      function resolveMarkers(ids: number[]) {
        receive({
          type: "replica:canvas:resolved",
          protocolVersion: 1,
          route: { pathname: "/", search: "", hash: "" },
          results: ids.map((id) => ({
            id,
            x: 180,
            y: 180,
            rect: { x: 120, y: 160, width: 120, height: 40 },
          })),
        })
      }
      resolveMarkers([1])
      if (commentsOpen) fireEvent.click(toggle)
      fireEvent.click(
        await screen.findByRole("button", { name: "Unread thread started by @octocat" }),
      )

      const dialog = screen.getByRole("dialog", { name: reviewCommentsCopy.threadHeading })
      expect(dialog).toHaveClass("review-thread-conversation--anchored")
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))
      expect(document.querySelector(".canvas-comments-sidebar-shell")).toHaveAttribute(
        "aria-hidden",
        String(!commentsOpen),
      )
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/hub/comments/1/read",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ review_thread_read: { activity_version: 2 } }),
          }),
        ),
      )
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Reply" }), {
        target: { value: "I will update it." },
      })
      expect(toggle).toBeDisabled()
      fireEvent.click(within(dialog).getByRole("button", { name: "Reply" }))
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/hub/comments/1/replies",
          expect.objectContaining({ method: "POST" }),
        ),
      )
      await waitFor(() =>
        expect(within(dialog).getByRole("textbox", { name: "Reply" })).toHaveValue(""),
      )
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))
      receive({ type: "replica:canvas:conversation-dismiss-requested", nonce: "wrong-frame" })
      expect(dialog).toBeInTheDocument()
      receive({ type: "replica:canvas:conversation-dismiss-requested" })
      expect(dialog).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))

      resolveMarkers([1])
      fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
      fireEvent.click(
        await screen.findByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
      )
      await screen.findByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
      expect(
        screen.queryByRole("button", { name: "Unread thread started by @octocat" }),
      ).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))
      receive({ type: "replica:canvas:selected", anchor: created.anchor })
      fireEvent.change(screen.getByRole("textbox", { name: reviewCommentsCopy.composerLabel }), {
        target: { value: created.body },
      })
      fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.submitLabel }))
      let createdDialog = await screen.findByRole("dialog", {
        name: reviewCommentsCopy.threadHeading,
      })
      resolveMarkers([1, 2])
      expect(createdDialog).toHaveClass("review-thread-conversation--anchored")
      expect(within(createdDialog).getByText(created.body)).toBeInTheDocument()
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))
      expect(document.querySelector(".canvas-comments-sidebar-shell")).toHaveAttribute(
        "aria-hidden",
        String(!commentsOpen),
      )
      receive({ type: "replica:canvas:conversation-dismiss-requested" })
      expect(createdDialog).not.toBeInTheDocument()
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false)
      fireEvent.click(screen.getByRole("button", { name: "Thread started by @octocat" }))
      createdDialog = screen.getByRole("dialog", { name: reviewCommentsCopy.threadHeading })
      fireEvent.click(
        within(createdDialog).getByRole("button", { name: reviewCommentsCopy.resolveLabel }),
      )
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/hub/comments/2/resolution",
          expect.objectContaining({ method: "POST" }),
        ),
      )
      expect(toggle).toHaveAttribute("aria-expanded", String(commentsOpen))
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute("aria-expanded", String(!commentsOpen))
      if (commentsOpen)
        expect(
          screen.queryByRole("dialog", { name: reviewCommentsCopy.threadHeading }),
        ).not.toBeInTheDocument()
      view.unmount()
    },
  )
})
