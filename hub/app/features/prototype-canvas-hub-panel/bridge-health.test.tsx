import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createRef } from "react"
import { expect, it, vi } from "vitest"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import type { ReviewAnchor } from "@utils/review-anchor/types"
import { importedPrototype, publicationHub } from "@utils/resolve-prototype-publication/fixtures"

import { renderPrototypeCanvasHubPanel } from "./test-support/render-prototype-canvas-hub-panel"

it("waits for loading, validates compatibility, recovers from late responses, and clears readiness on reload", async () => {
  vi.useFakeTimers()
  const nonce = "00000000-0000-4000-8000-000000000001"
  vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  const frameRef = createRef<HTMLIFrameElement>()
  const view = renderPrototypeCanvasHubPanel(
    {
      config: {
        name: "Welcome",
        prototypeUrl: "http://localhost:4321",
        previewUrl: "http://127.0.0.1:12345",
        token: "local",
      },
      frameRef,
      status: {
        state: "undiscovered",
        repositoryAuthorized: true,
        repository: "github/prototype",
        branch: "prototype/welcome",
      },
      open: false,
    },
    <iframe ref={frameRef} title="Prototype" />,
  )
  function respond(
    protocolVersion?: number,
    origin = "http://127.0.0.1:12345",
    source: MessageEventSource | null = frameRef.current?.contentWindow ?? null,
  ) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source,
        data: {
          type: "replica:canvas:ready",
          nonce,
          protocolVersion,
          route: { pathname: "/", search: "", hash: "" },
        },
      }),
    )
  }
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByRole("button", { name: "Fix with Copilot" })).not.toBeInTheDocument()
  act(() => respond(99))
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  act(() => respond(1, "https://untrusted.example"))
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  act(() => respond(1, "http://localhost:4321"))
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  act(() => respond(1, "http://127.0.0.1:12345", window))
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  act(() => respond(1, "http://127.0.0.1:12345", null))
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  act(() => respond())
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  act(() => respond(1))
  expect(screen.queryByRole("button", { name: "Fix with Copilot" })).not.toBeInTheDocument()
  act(() => {
    if (frameRef.current) fireEvent.load(frameRef.current)
  })
  await act(() => vi.advanceTimersByTimeAsync(20_000))
  expect(screen.getByRole("dialog", { name: "Commenting needs attention" })).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
  act(() => respond(1))
  expect(screen.queryByRole("button", { name: "Fix with Copilot" })).not.toBeInTheDocument()
  view.unmount()
})

it.each([
  { type: "replica:canvas:selected", anchor: octocatRootComment.anchor },
  { type: "replica:canvas:selection-failed", reason: "element-unavailable" },
  { type: "replica:canvas:selection-failed", reason: "area-too-small" },
  { type: "replica:canvas:selection-failed", reason: "area-unavailable" },
  { type: "replica:canvas:selection-cancelled" },
])(
  "ignores incompatible targeting messages until a compatible ready response: $type $reason",
  async (message) => {
    const nonce = "00000000-0000-4000-8000-000000000002"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/api/hub/events")
          return Promise.reject(new Error("Live connection unavailable"))
        if (path === "/api/hub/status")
          return Promise.resolve(
            Response.json({
              ...publicationHub,
              state: "connected",
              prototype: importedPrototype,
            }),
          )
        return Promise.resolve(
          new Response(JSON.stringify({ comments: [], hasMore: false, nextCursor: null })),
        )
      }),
    )
    const frameRef = createRef<HTMLIFrameElement>()
    const onFrameLoad = vi.fn()
    const view = renderPrototypeCanvasHubPanel(
      {
        config: { name: "Welcome", prototypeUrl: "http://localhost:4321", token: "local" },
        frameRef,
        status: { ...publicationHub, state: "connected", prototype: importedPrototype },
        open: false,
      },
      <iframe ref={frameRef} title="Prototype" src="about:blank" onLoad={onFrameLoad} />,
    )
    function respond(data: Record<string, unknown>) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://localhost:4321",
            source: frameRef.current?.contentWindow,
            data: { nonce, ...data },
          }),
        )
      })
    }
    const ready = {
      type: "replica:canvas:ready",
      protocolVersion: 1,
      route: { pathname: "/", search: "", hash: "" },
    }
    await waitFor(() => expect(onFrameLoad).toHaveBeenCalled())
    respond(ready)
    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    fireEvent.click(
      await screen.findByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
    )
    expect(
      await screen.findByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
    ).toBeVisible()

    respond({ ...ready, protocolVersion: 99 })
    respond(message)
    expect(
      screen.getByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
    ).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: reviewCommentsCopy.composerLabel }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    respond(ready)
    respond(message)
    expect(
      screen.queryByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
    ).not.toBeInTheDocument()
    if (message.type === "replica:canvas:selection-failed") {
      expect(screen.getByRole("alert")).toHaveTextContent(
        message.reason === "area-too-small"
          ? reviewCommentsCopy.areaTooSmallLabel
          : message.reason === "area-unavailable"
            ? reviewCommentsCopy.areaUnavailableLabel
            : reviewCommentsCopy.selectionFailedLabel,
      )
    }
    if (message.type !== "replica:canvas:selected") {
      fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
      fireEvent.click(
        await screen.findByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
      )
      await screen.findByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
      respond({ type: "replica:canvas:selected", anchor: octocatRootComment.anchor })
    }
    expect(screen.getByRole("textbox", { name: reviewCommentsCopy.composerLabel })).toBeVisible()
    view.unmount()
  },
)

it.each(["area", "element"] as const)(
  "clears a rejected $0 selection, shows its failure, and allows a valid retry",
  async (kind) => {
    const nonce = "00000000-0000-4000-8000-000000000003"
    vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/api/hub/events")
          return Promise.reject(new Error("Live connection unavailable"))
        if (path === "/api/hub/status")
          return Promise.resolve(
            Response.json({
              ...publicationHub,
              state: "connected",
              prototype: importedPrototype,
            }),
          )
        return Promise.resolve(
          new Response(JSON.stringify({ comments: [], hasMore: false, nextCursor: null })),
        )
      }),
    )
    const frameRef = createRef<HTMLIFrameElement>()
    const onFrameLoad = vi.fn()
    const view = renderPrototypeCanvasHubPanel(
      {
        config: { name: "Welcome", prototypeUrl: "http://localhost:4321", token: "local" },
        frameRef,
        status: { ...publicationHub, state: "connected", prototype: importedPrototype },
        open: false,
      },
      <iframe ref={frameRef} title="Prototype" src="about:blank" onLoad={onFrameLoad} />,
    )
    function respond(data: Record<string, unknown>, origin = "http://localhost:4321") {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin,
            source: frameRef.current?.contentWindow,
            data: { nonce, ...data },
          }),
        )
      })
    }
    const elementAnchor = octocatRootComment.anchor
    if (elementAnchor.kind !== "element") throw new Error("Expected an element anchor fixture")
    const validAnchor: ReviewAnchor =
      kind === "area"
        ? {
            schemaVersion: 1,
            kind: "area",
            route: { pathname: "/", search: "", hash: "" },
            path: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
            rect: { x: 20, y: 30, width: 100, height: 50 },
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
            elements: [
              {
                selector: "#content",
                accessibleName: "",
                tagName: "main",
                role: "",
                textExcerpt: `${"a".repeat(498)}\u00b7`,
                rect: { x: 10, y: 20, width: 200, height: 100 },
              },
            ],
          }
        : {
            ...elementAnchor,
            selectedText: `${"a".repeat(1998)}\u00b7`,
          }
    const invalidAnchor =
      validAnchor.kind === "area"
        ? {
            ...validAnchor,
            elements: [{ ...validAnchor.elements[0], textExcerpt: `${"a".repeat(499)}\u00b7` }],
          }
        : { ...validAnchor, selectedText: `${"a".repeat(1999)}\u00b7` }
    const selectionLabel =
      kind === "area"
        ? reviewCommentsCopy.highlightRegionLabel
        : reviewCommentsCopy.commentOnElementLabel
    await waitFor(() => expect(onFrameLoad).toHaveBeenCalled())
    const post = vi.spyOn(frameRef.current!.contentWindow!, "postMessage")
    respond({
      type: "replica:canvas:ready",
      protocolVersion: 1,
      route: validAnchor.route,
    })
    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    fireEvent.click(await screen.findByRole("menuitem", { name: selectionLabel }))
    await screen.findByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })

    respond({ type: "replica:canvas:selected", anchor: invalidAnchor }, "https://untrusted.example")
    respond({ type: "replica:canvas:selected", anchor: invalidAnchor, nonce: "stale" })
    expect(
      screen.getByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
    ).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    respond({ type: "replica:canvas:selected", anchor: invalidAnchor })
    expect(post).toHaveBeenCalledWith(
      { type: "replica:canvas:cancel-selection", nonce },
      "http://localhost:4321",
    )
    expect(post).toHaveBeenCalledWith(
      { type: "replica:canvas:clear-selection", nonce },
      "http://localhost:4321",
    )
    expect(
      screen.queryByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
    ).toBeNull()
    expect(screen.queryByRole("textbox", { name: reviewCommentsCopy.composerLabel })).toBeNull()
    expect(screen.getByRole("alert")).toHaveTextContent(
      kind === "area"
        ? reviewCommentsCopy.areaUnavailableLabel
        : reviewCommentsCopy.selectionFailedLabel,
    )

    fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
    fireEvent.click(await screen.findByRole("menuitem", { name: selectionLabel }))
    await screen.findByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    respond({ type: "replica:canvas:selected", anchor: validAnchor })
    expect(screen.getByRole("textbox", { name: reviewCommentsCopy.composerLabel })).toBeVisible()
    const composer = screen.getByRole("dialog", { name: reviewCommentsCopy.composerHeading })
    fireEvent.click(within(composer).getByLabelText(reviewCommentsCopy.closeComposerLabel))
    expect(screen.queryByRole("dialog", { name: reviewCommentsCopy.composerHeading })).toBeNull()
    view.unmount()
  },
)
