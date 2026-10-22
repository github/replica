import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { resolvePublication } from "@utils/resolve-prototype-publication"
import type { HubStatus } from "@utils/prototype-canvas/types"

import { renderPrototypeCanvasHubPanel } from "./test-support/render-prototype-canvas-hub-panel"

it.each(["undiscovered", "unregistered", "no-build", "disconnected"] as const)(
  "hides publishing Settings for a %s prototype",
  (state) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ comments: [], hasMore: false, nextCursor: null })),
      ),
    )
    const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const view = renderPrototypeCanvasHubPanel({
      status: {
        ...publicationHub,
        state: state === "undiscovered" || state === "disconnected" ? state : "connected",
        prototype:
          state === "undiscovered" || state === "disconnected"
            ? undefined
            : {
                ...importedPrototype,
                registered: state !== "unregistered",
                build: state === "no-build" ? null : importedPrototype.build,
              },
      },
      publishPreference: {
        remember: false,
        loading: false,
        saving: false,
        error: "",
        save,
        retry: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    })
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Publishing preferences" })).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    view.unmount()
  },
)

it.each(["unavailable", "denied"] as const)(
  "shows one warning banner and a combined retry when Hub verification is %s",
  (state) => {
    const onStatusChange = vi.fn().mockResolvedValue(undefined)
    const onRetryPublication = vi.fn()
    const status: HubStatus = {
      ...publicationHub,
      state,
      message: "Hub status unavailable: Load failed",
    }
    const props = {
      status,
      onStatusChange,
      onPublish: vi.fn(),
      onRetryPublication,
      publication: {
        kind: "unknown" as const,
        detail: "Remote branch status is unknown. Load failed",
        label: "Retry status",
        action: "retry" as const,
      },
    }
    const view = renderPrototypeCanvasHubPanel({ ...props })
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByRole("alert")).toHaveTextContent(status.message!)
    expect(screen.getByRole("alert")).toHaveClass("hub-alert--warning", "hub-alert--compact")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.queryByText(props.publication.detail)).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Branch publication" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry connection" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry status" }))
    expect(onRetryPublication).toHaveBeenCalledOnce()
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(props.onPublish).not.toHaveBeenCalled()

    view.rerender({ ...props, publicationBusy: true })
    const retry = screen.getByRole("button", { name: "Retry status" })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute("aria-busy", "true")
    fireEvent.click(retry)
    expect(onRetryPublication).toHaveBeenCalledOnce()

    view.rerender({ ...props, status: { ...status, state: "undiscovered", message: undefined } })
    expect(screen.getByRole("region", { name: "Branch publication" })).toHaveTextContent(
      props.publication.detail,
    )
    expect(screen.queryByText(status.message!)).not.toBeInTheDocument()
    view.unmount()
  },
)

it("offers a Hub-only retry with fallback copy when no publication callback is provided", () => {
  const onStatusChange = vi.fn().mockResolvedValue(undefined)
  const view = renderPrototypeCanvasHubPanel({
    status: { ...publicationHub, state: "unavailable" },
    onStatusChange,
  })
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Hub verification is unavailable. Restore access and retry.",
  )
  fireEvent.click(screen.getByRole("button", { name: "Retry status" }))
  expect(onStatusChange).toHaveBeenCalledOnce()
  view.unmount()
})

it("replaces automatic publication progress with editable metadata once published", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ comments: [], hasMore: false, nextCursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  )
  const props = { onPublish: () => {}, onRetryPublication: () => {} }
  const waiting = {
    ...publicationHub,
    state: "connected" as const,
    prototype: { ...importedPrototype, registered: false, published: false },
  }
  const view = renderPrototypeCanvasHubPanel({
    ...props,
    status: waiting,
    publication: resolvePublication(publicationState, waiting),
  })
  expect(screen.queryByRole("button", { name: "Register prototype" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Refresh publication" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument()
  expect(screen.getByText(/publishing it automatically/)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "https://hub.example.com" })).toHaveAttribute(
    "href",
    "https://hub.example.com/repositories/1/prototypes/1",
  )

  const failed = {
    ...waiting,
    registrationError: "Automatic prototype registration failed: Hub returned HTTP 404.",
  }
  view.rerender({
    ...props,
    status: failed,
    publication: resolvePublication(publicationState, failed),
  })
  expect(screen.getByText(failed.registrationError)).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Build #1" })).toBeInTheDocument()
  expect(screen.getByText(importedPrototype.build!.commitSha.slice(0, 7)).parentElement).toBe(
    screen.getByRole("link", { name: "Build #1" }).parentElement,
  )
  expect(screen.getByText(importedPrototype.build!.commitSha.slice(0, 7))).toHaveAttribute(
    "title",
    importedPrototype.build!.commitSha,
  )
  expect(screen.getByRole("link", { name: "Show build history" })).toHaveAttribute(
    "href",
    "https://hub.example.com/repositories/1/prototypes/1/builds",
  )
  expect(screen.queryByText(/versions?/)).not.toBeInTheDocument()
  expect(await screen.findByRole("button", { name: /^Comments, 0/ })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "Connect to the Hub" })).not.toBeInTheDocument()

  const published = { ...waiting, prototype: importedPrototype }
  view.rerender({
    ...props,
    status: published,
    publication: resolvePublication(publicationState, published),
  })
  expect(screen.queryByText(/publishing it automatically/)).not.toBeInTheDocument()
  expect(screen.queryByRole("region", { name: "Branch publication" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Edit details" })).toBeEnabled()
  const hubSection = screen.getByRole("region", { name: "Hub" })
  expect(hubSection).toBe(hubSection.parentElement?.lastElementChild)
  expect(
    screen.getByRole("region", { name: "Latest Build" }).compareDocumentPosition(hubSection),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  expect(screen.getByRole("button", { name: "Edit details" }).className).toBe(
    within(hubSection).getByRole("button", { name: "Disconnect Hub" }).className,
  )
  expect(screen.getByRole("link", { name: "https://hub.example.com" })).toHaveAttribute(
    "href",
    "https://hub.example.com/repositories/1/prototypes/1",
  )
  await screen.findByRole("button", { name: /^Comments, 0/ })
  view.unmount()
})

it.each([
  {
    scenario: "a linked account with a display name",
    name: "The Octocat",
    login: "octocat",
    label: "The Octocat",
    href: "https://github.com/octocat",
  },
  {
    scenario: "a linked account without a display name",
    name: null,
    login: "octocat",
    label: "octocat",
    href: "https://github.com/octocat",
  },
  {
    scenario: "a blank display name",
    name: " ",
    login: "octocat",
    label: "octocat",
    href: "https://github.com/octocat",
  },
  {
    scenario: "a bot account",
    name: null,
    login: "dependabot[bot]",
    label: "dependabot[bot]",
    href: "https://github.com/dependabot%5Bbot%5D",
  },
  {
    scenario: "a name without an associated account",
    name: "octocat",
    login: null,
    label: "octocat",
    href: null,
  },
  {
    scenario: "missing author data",
    name: null,
    login: null,
    label: "Unknown",
    href: null,
  },
  {
    scenario: "a display name with an invalid account path",
    name: "The Octocat",
    login: "octocat/../settings",
    label: "The Octocat",
    href: null,
  },
  {
    scenario: "an invalid login without a display name",
    name: null,
    login: "javascript:alert(1)",
    label: "Unknown",
    href: null,
  },
])("shows the commit author accurately for $scenario", async ({ name, login, label, href }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ comments: [], hasMore: false, nextCursor: null }))),
  )
  const view = renderPrototypeCanvasHubPanel({
    status: {
      ...publicationHub,
      state: "connected",
      prototype: {
        ...importedPrototype,
        build: {
          ...importedPrototype.build!,
          author: { name, login, avatarUrl: null },
        },
      },
    },
  })
  const build = within(screen.getByRole("region", { name: "Latest Build" }))
  expect(build.getByText(label)).toBeInTheDocument()
  expect(build.queryByText(/^Commit author:/)).not.toBeInTheDocument()
  expect(build.queryByText(/creator|Published by/i)).not.toBeInTheDocument()
  if (href) {
    expect(build.getByRole("link", { name: label })).toHaveAttribute("href", href)
    expect(build.getByRole("link", { name: label })).toHaveClass("canvas-hub-build__author")
    expect(build.getByRole("link", { name: label })).toHaveAttribute("target", "_blank")
    expect(build.getByRole("link", { name: label })).toHaveAttribute("rel", "noopener noreferrer")
  } else {
    expect(build.queryByRole("link", { name: label })).not.toBeInTheDocument()
  }
  await screen.findByRole("button", { name: /^Comments, 0/ })
  view.unmount()
})

it("derives Build history from the selected Hub and current prototype only with a successful Build", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ comments: [], hasMore: false, nextCursor: null }))),
  )

  const status = {
    ...publicationHub,
    state: "connected" as const,
    prototype: { ...importedPrototype, id: 53, repositoryId: 2001, versionCount: 12 },
  }
  const view = renderPrototypeCanvasHubPanel({
    status,
  })
  expect(screen.getByRole("link", { name: "Show build history" })).toHaveAttribute(
    "href",
    "https://hub.example.com/repositories/2001/prototypes/53/builds",
  )
  expect(screen.queryByText(/versions?/)).not.toBeInTheDocument()
  await screen.findByRole("button", { name: /^Comments, 0/ })
  view.rerender({
    status: {
      ...status,
      hubOrigin: "https://other-hub.example.com/",
      prototype: { ...status.prototype, id: 62, repositoryId: 4003 },
    },
  })
  expect(screen.getByRole("link", { name: "Show build history" })).toHaveAttribute(
    "href",
    "https://other-hub.example.com/repositories/4003/prototypes/62/builds",
  )
  for (const buildState of ["queued", "building", "failed", null]) {
    view.rerender({
      status: {
        ...status,
        prototype: { ...status.prototype, build: null, buildState },
      },
    })
    expect(screen.queryByRole("link", { name: "Show build history" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Build #1" })).not.toBeInTheDocument()
    expect(screen.getByText(/No successful imported Build yet/)).toBeInTheDocument()
  }
  await screen.findByRole("button", { name: /^Comments, 0/ })
  view.unmount()
})

it("keeps the Hub heading and root link before discovery with only concise unpublished copy", () => {
  const status = { ...publicationHub, repositoryAuthorized: true }
  const state = {
    ...publicationState,
    stats: {
      ...publicationState.stats,
      remoteBranch: { ...publicationState.stats.remoteBranch!, state: "absent" as const },
    },
  }
  const view = renderPrototypeCanvasHubPanel({
    status,
    publication: resolvePublication(state, status),
    dirty: true,
    onPublish: () => {},
    onRetryPublication: () => {},
  })
  const heading = screen.getByRole("heading", { name: "Hub" })
  expect(heading.className).toContain("Heading--subhead-medium")
  const link = screen.getByRole("link", { name: "https://hub.example.com" })
  expect(heading.compareDocumentPosition(link)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  expect(link).toHaveAttribute("href", "https://hub.example.com")
  expect(screen.getByRole("region", { name: "Branch publication" })).toHaveTextContent(
    "This branch won't appear in the hub until you publish.",
  )
  expect(screen.queryByText(/Local commenting readiness/)).not.toBeInTheDocument()
  expect(screen.queryByText(/matching HEAD/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Uncommitted files stay local/)).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Change Hub" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Disconnect Hub" })).toBeEnabled()
  view.unmount()
})

it("offers only the shared dialog action when disconnected status arrives after loading", () => {
  const view = renderPrototypeCanvasHubPanel({
    status: null,
  })
  view.rerender({
    status: { ...publicationHub, state: "disconnected" },
  })
  expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
  expect(
    screen.getByText("Connect to the hub before publishing this prototype."),
  ).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Connect to the Hub" })).toBeEnabled()
  view.unmount()
})

it("reports disconnect failures and keeps reconnecting to the saved Hub available", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: "Hub could not revoke the connection." }, { status: 503 }),
    )
    .mockResolvedValueOnce(Response.json({ state: "disconnected" }))
  vi.stubGlobal("fetch", fetch)
  const onStatusChange = vi.fn().mockResolvedValue(undefined)
  const onConnect = vi.fn()
  const props = { onStatusChange, onConnect }
  const view = renderPrototypeCanvasHubPanel({ ...props, status: publicationHub })
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Hub could not revoke the connection.")
  expect(onStatusChange).not.toHaveBeenCalled()
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The previous connection may still be active.",
  )
  expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue("https://hub.example.com")

  fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledOnce())
  view.rerender({ ...props, status: { ...publicationHub, state: "disconnected" } })
  expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Connect to the Hub" }))
  expect(onConnect).toHaveBeenCalledOnce()
  view.rerender({ ...props, status: publicationHub })
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument(),
  )
  view.unmount()
})

it("keeps a repository connection when configuration differs and requires an explicit switch", async () => {
  const onSelectHub = vi.fn().mockResolvedValue(undefined)
  const onStatusChange = vi.fn().mockResolvedValue(undefined)
  const fetch = vi.fn().mockResolvedValue(Response.json({ state: "disconnected" }))
  vi.stubGlobal("fetch", fetch)
  const view = renderPrototypeCanvasHubPanel({
    config: { name: "New prototype", prototypeUrl: "http://localhost:4321/", token: "local" },
    status: {
      state: "undiscovered",
      repository: "github/prototype",
      branch: "prototype/uncommitted",
      hubOrigin: "https://previous.example.com",
      discovery: { state: "valid", origin: "https://configured.example.com", mismatch: true },
    },
    onStatusChange,
    onSelectHub,
  })
  expect(screen.getByText(/Your repository connection is ready/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Disconnect Hub" })).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent("Your connection has not changed")
  expect(onSelectHub).not.toHaveBeenCalled()
  expect(screen.queryByRole("button", { name: "Change Hub" })).not.toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Hub" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "https://previous.example.com" })).toHaveAttribute(
    "href",
    "https://previous.example.com",
  )
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenCalledWith(
    "/api/hub/disconnect",
    expect.objectContaining({ method: "POST" }),
  )
  expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue(
    "https://configured.example.com",
  )
  expect(onSelectHub).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  await waitFor(() => expect(onSelectHub).toHaveBeenCalledWith("https://configured.example.com"))
  view.unmount()
})

it("keeps pending approval and configuration out of the sidebar", () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ state: "disconnected" }))
  vi.stubGlobal("fetch", fetch)
  const onStatusChange = vi.fn().mockResolvedValue(undefined)
  const onSelectHub = vi.fn().mockResolvedValue(undefined)
  const view = renderPrototypeCanvasHubPanel({
    status: {
      ...publicationHub,
      state: "pairing",
      pairing: {
        verificationUrl: "https://hub.example.com/canvas/pair/123",
        userCode: "123",
      },
    },
    onStatusChange,
    onSelectHub,
  })
  expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
  expect(screen.queryByRole("textbox", { name: "Approval URL" })).not.toBeInTheDocument()
  expect(screen.queryByRole("link", { name: "Connect to the Hub" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Disconnect Hub" })).not.toBeInTheDocument()
  expect(screen.queryByText(/One approval/)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Connect to the Hub" })).toBeEnabled()
  expect(fetch).not.toHaveBeenCalled()
  view.unmount()
})

it("offers an explicit local switch with a warning when the selected Hub cannot revoke", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ error: "Hub is offline." }, { status: 503 })),
  )
  const onSelectHub = vi.fn().mockResolvedValue(undefined)
  const view = renderPrototypeCanvasHubPanel({
    status: { ...publicationHub, state: "unavailable" },
    onSelectHub,
  })
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
  expect(await screen.findByText(/The previous connection may still be active/)).toHaveAttribute(
    "role",
    "alert",
  )
  expect(onSelectHub).not.toHaveBeenCalled()
  expect(screen.getByRole("link", { name: "https://hub.example.com" })).toBeInTheDocument()
  fireEvent.change(screen.getByRole("textbox", { name: "Hub URL" }), {
    target: { value: "https://other.example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  await waitFor(() => expect(onSelectHub).toHaveBeenCalledWith("https://other.example.com"))
  expect(screen.getByText(/The previous connection may still be active/)).toHaveAttribute(
    "role",
    "alert",
  )
  view.unmount()
})

it("retains every preview pin for collections larger than 200 threads", async () => {
  const comments = Array.from({ length: 201 }, (_, index) => ({
    ...octocatRootComment,
    id: index + 1,
  }))
  const nonce = "00000000-0000-4000-8000-000000000000"
  vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ comments, hasMore: false, nextCursor: null }))),
  )
  const frameRef = createRef<HTMLIFrameElement>()
  const view = renderPrototypeCanvasHubPanel(
    {
      status: { ...publicationHub, state: "connected", prototype: importedPrototype },
      frameRef,
      open: false,
    },
    <iframe ref={frameRef} title="Prototype preview" src="about:blank" />,
  )
  await screen.findByRole("button", { name: /^Comments, 201/ })
  const post = vi.spyOn(frameRef.current!.contentWindow!, "postMessage")
  fireEvent.load(frameRef.current!)
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "replica:canvas:resolve",
      anchors: comments.toReversed().map(({ id, anchor }) => ({ id, anchor })),
    }),
    "http://localhost:4321",
  )
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frameRef.current?.contentWindow,
        origin: "http://localhost:4321",
        data: {
          type: "replica:canvas:resolved",
          protocolVersion: 1,
          nonce,
          route: { pathname: "/", search: "", hash: "" },
          results: comments.map(({ id }) => ({ id, x: 0, y: 0 })),
        },
      }),
    )
  })
  expect(
    screen.queryAllByRole("button", { name: "Unread thread started by @octocat" }),
  ).toHaveLength(comments.length)
  view.unmount()
})

it("creates Hub conversations and supports existing-thread actions", async () => {
  const paths: { path: string; method: string }[] = []
  const recoveryDetail = "Hub is temporarily unavailable. Retry saving your comment."
  let saveUnavailable = true
  let savedRoot: typeof octocatRootComment | null = null
  let finishReply!: (response: Response) => void
  const nonce = "00000000-0000-4000-8000-000000000000"
  vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
  const frameRef = createRef<HTMLIFrameElement>()
  const onClose = vi.fn()
  const resolvedRootComment = {
    ...octocatRootComment,
    id: 3,
    resolvedAt: "2026-09-14T16:00:00Z",
    resolvedBy: octocatRootComment.author,
    activityVersion: 3,
    viewerLastSeenActivityVersion: 3,
  }
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      paths.push({ path, method: options?.method || "GET" })
      if (path === "/api/hub/events") throw new Error("Live connection unavailable")
      if (path === "/api/hub/status")
        return Promise.resolve(
          Response.json({
            ...publicationHub,
            state: "connected",
            repository: "github/prototype",
            branch: "prototype/welcome",
            prototype: { ...importedPrototype, repositoryId: 2001 },
          }),
        )
      if (path === "/api/hub/comments/1/replies")
        return new Promise<Response>((resolve) => {
          finishReply = resolve
        })
      if (path === "/api/hub/comments" && options?.method === "POST" && saveUnavailable)
        return Promise.resolve(Response.json({ error: recoveryDetail }, { status: 503 }))
      if (path === "/api/hub/comments" && options?.method === "POST") {
        savedRoot = {
          ...octocatRootComment,
          id: 2,
          body: "Please update this heading.",
          activityVersion: 1,
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              comments: [savedRoot],
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify(
            path === "/api/hub/comments"
              ? {
                  comments: [
                    octocatRootComment,
                    resolvedRootComment,
                    ...(savedRoot ? [savedRoot] : []),
                  ],
                  hasMore: false,
                  nextCursor: null,
                }
              : { comments: [] },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }),
  )
  const view = renderPrototypeCanvasHubPanel(
    {
      config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
      frameRef,
      status: {
        state: "connected",
        repository: "github/prototype",
        branch: "prototype/welcome",
        commitSha: "a".repeat(40),
        reviewRevision: publicationHub.reviewRevision,
        hubOrigin: "https://hub.example.com",
        prototype: {
          id: 1,
          repositoryId: 2001,
          branch: "prototype/welcome",
          name: "Welcome",
          description: "A welcome flow.",
          startPage: "/welcome?step=1#intro",
          viewerLogin: "octocat",
          registered: true,
          canEdit: true,
          canRegister: true,
          published: true,
          buildState: "successful",
          versionCount: 1,
          build: {
            url: "https://hub.example.com/repositories/2001/prototypes/1?build=1",
            number: 1,
            commitSha: "a".repeat(40),
            publishedAt: "2026-09-14T12:00:00Z",
            author: { login: "octocat", name: null, avatarUrl: null },
          },
        },
      },
      onClose,
    },
    <iframe ref={frameRef} title="Prototype preview" src="about:blank" />,
  )
  const commentsToggle = await screen.findByRole("button", { name: /^Comments, 1/ })
  const hubPanel = screen.getByRole("complementary", { name: "Hub" })
  const prototypeHeading = within(hubPanel).getByRole("heading", { name: "Welcome" })
  const hubHeading = within(hubPanel).getByRole("heading", { name: "Hub" })
  const latestBuildHeading = within(hubPanel).getByRole("heading", { name: "Latest Build" })
  expect(prototypeHeading.className).toContain("Heading--subhead-large")
  expect(hubHeading.className).toContain("Heading--subhead-medium")
  expect(latestBuildHeading.className).toContain("Heading--subhead-medium")
  expect(prototypeHeading.compareDocumentPosition(hubHeading)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(latestBuildHeading.compareDocumentPosition(hubHeading)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  expect(hubHeading.closest(".canvas-hub-section")).toBeInTheDocument()
  expect(
    within(hubPanel).getByRole("link", { name: "Open prototype/welcome on GitHub" }),
  ).toHaveAttribute("href", "https://github.com/github/prototype/tree/prototype%2Fwelcome")
  expect(within(hubPanel).getByRole("link", { name: "https://hub.example.com" })).toHaveAttribute(
    "href",
    "https://hub.example.com/repositories/2001/prototypes/1",
  )
  expect(within(hubPanel).queryByText("Hub:")).not.toBeInTheDocument()
  fireEvent.click(within(hubPanel).getByRole("button", { name: "Edit details" }))
  expect(within(hubPanel).queryByRole("heading", { name: "Welcome" })).not.toBeInTheDocument()
  expect(hubPanel.querySelector(".canvas-hub-publication__description")).not.toBeInTheDocument()
  expect(within(hubPanel).getByRole("textbox", { name: "Name" })).toHaveValue("Welcome")
  expect(within(hubPanel).getByRole("textbox", { name: "Description" })).toHaveValue(
    "A welcome flow.",
  )
  expect(within(hubPanel).getByRole("textbox", { name: "Start page" })).toHaveValue(
    "/welcome?step=1#intro",
  )
  fireEvent.change(within(hubPanel).getByRole("textbox", { name: "Start page" }), {
    target: { value: "" },
  })
  fireEvent.click(within(hubPanel).getByRole("button", { name: "Save metadata" }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/hub/metadata",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Welcome", description: "A welcome flow.", startPage: "" }),
      }),
    ),
  )
  await waitFor(() =>
    expect(within(hubPanel).getByRole("button", { name: "Edit details" })).toBeVisible(),
  )
  fireEvent.click(within(hubPanel).getByRole("button", { name: "Edit details" }))
  fireEvent.click(within(hubPanel).getByRole("button", { name: "Cancel" }))
  expect(document.getElementById("canvas-review-controls")).toContainElement(commentsToggle)
  expect(commentsToggle.closest(".review-shell__comment-actions")).toBeInTheDocument()
  expect(commentsToggle).toHaveAttribute("aria-expanded", "false")
  fireEvent.click(commentsToggle)
  expect(onClose).toHaveBeenCalledOnce()
  expect(commentsToggle).toHaveAttribute("aria-expanded", "true")
  expect(document.querySelector(".canvas-hub-panel")).toHaveAttribute("aria-hidden", "true")
  expect(
    screen.getByRole("searchbox", { name: reviewCommentsCopy.searchLabel }),
  ).toBeInTheDocument()
  expect(screen.getByRole("button", { name: reviewCommentsCopy.filterLabel })).toBeInTheDocument()
  Object.defineProperties(frameRef.current, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  })
  const postMessage = vi.spyOn(frameRef.current!.contentWindow!, "postMessage")
  await waitFor(() => {
    fireEvent.load(frameRef.current!)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "replica:canvas:resolve", nonce }),
      "http://localhost:4321",
    )
  })
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frameRef.current?.contentWindow,
        origin: "http://localhost:4321",
        data: {
          type: "replica:canvas:resolved",
          protocolVersion: 1,
          nonce,
          route: { pathname: "/", search: "", hash: "" },
          results: [{ id: 1, x: 120, y: 80 }],
        },
      }),
    )
  })
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Unread thread started by @octocat" }),
    ).toBeInTheDocument(),
  )
  let marker = screen.getByRole("button", { name: "Unread thread started by @octocat" })
  expect(marker.querySelector("img")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.filterLabel }))
  const showPins = screen.getByRole("switch", { name: reviewCommentsCopy.showPinsLabel })
  fireEvent.click(showPins)
  expect(
    screen.queryByRole("button", { name: "Unread thread started by @octocat" }),
  ).not.toBeInTheDocument()
  fireEvent.click(showPins)
  const search = screen.getByRole("searchbox", { name: reviewCommentsCopy.searchLabel })
  fireEvent.change(search, { target: { value: "no matching comment" } })
  expect(screen.getByRole("button", { name: /^Comments, 0/ })).toBeInTheDocument()
  expect(screen.getByText(reviewCommentsCopy.noMatchesLabel)).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Unread thread started by @octocat" }),
  ).not.toBeInTheDocument()
  fireEvent.change(search, { target: { value: "" } })
  expect(screen.getByRole("button", { name: /^Comments, 1/ })).toBeInTheDocument()
  marker = screen.getByRole("button", { name: "Unread thread started by @octocat" })
  marker.focus()
  fireEvent.click(marker)
  expect(screen.getByRole("dialog", { name: reviewCommentsCopy.threadHeading })).toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Reply" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.backToCommentsLabel }))
  expect(marker).toHaveFocus()
  fireEvent.load(frameRef.current!)
  expect(
    screen.queryByRole("button", { name: "Unread thread started by @octocat" }),
  ).not.toBeInTheDocument()
  const unresolvedRow = screen.getByRole("button", {
    name: /Please align this control with the content above it/,
  })
  unresolvedRow.focus()
  fireEvent.click(unresolvedRow)
  const conversationBackButton = screen.getByRole("button", {
    name: reviewCommentsCopy.backToCommentsLabel,
  })
  await waitFor(() => expect(conversationBackButton).toHaveFocus())
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frameRef.current?.contentWindow,
        origin: "http://localhost:4321",
        data: {
          type: "replica:canvas:resolved",
          protocolVersion: 1,
          nonce,
          route: { pathname: "/", search: "", hash: "" },
          results: [{ id: 1, x: 120, y: 80 }],
        },
      }),
    )
  })
  expect(
    screen.getByRole("button", { name: "Unread thread started by @octocat" }),
  ).toBeInTheDocument()
  expect(conversationBackButton).toHaveFocus()
  fireEvent.click(conversationBackButton)
  await waitFor(() => expect(unresolvedRow).toHaveFocus())
  expect(
    screen.getByRole("button", { name: "Unread thread started by @octocat" }),
  ).toBeInTheDocument()
  const hiddenHubPanel = document.querySelector(".canvas-hub-panel")
  expect(hiddenHubPanel).toHaveTextContent("Welcome")
  expect(hiddenHubPanel).toHaveTextContent("Published")
  expect(
    hiddenHubPanel?.querySelector(
      'a[href="https://hub.example.com/repositories/2001/prototypes/1?build=1"]',
    ),
  ).toHaveTextContent("Build #1")
  expect(screen.queryByText("Checking")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
  fireEvent.click(
    await screen.findByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
  )
  await waitFor(() =>
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: "replica:canvas:select",
        nonce,
        mode: "element",
      },
      "http://localhost:4321",
    ),
  )
  expect(
    screen.getAllByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel }),
  ).toHaveLength(1)
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frameRef.current?.contentWindow,
        origin: "http://localhost:4321",
        data: {
          type: "replica:canvas:selected",
          nonce,
          anchor: octocatRootComment.anchor,
        },
      }),
    )
  })
  fireEvent.change(await screen.findByRole("textbox", { name: reviewCommentsCopy.composerLabel }), {
    target: { value: "Please update this heading." },
  })
  fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.submitLabel }))
  const composer = screen.getByRole("dialog", { name: reviewCommentsCopy.composerHeading })
  expect(await within(composer).findByRole("alert")).toHaveTextContent(recoveryDetail)
  expect(within(composer).getByRole("alert")).toBeVisible()
  expect(
    within(composer).getByRole("textbox", { name: reviewCommentsCopy.composerLabel }),
  ).toHaveValue("Please update this heading.")
  saveUnavailable = false
  fireEvent.click(within(composer).getByRole("button", { name: reviewCommentsCopy.submitLabel }))
  await waitFor(() => expect(paths).toContainEqual({ path: "/api/hub/comments", method: "POST" }))
  expect(
    await screen.findByRole("dialog", { name: reviewCommentsCopy.threadHeading }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.backToCommentsLabel }))
  const row = screen.getByRole("button", {
    name: /Please align this control with the content above it/,
  })
  row.focus()
  fireEvent.click(row)
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: reviewCommentsCopy.backToCommentsLabel }),
    ).toHaveFocus(),
  )
  expect(document.querySelector(".canvas-hub-panel")).toHaveAttribute("aria-hidden", "true")
  fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.backToCommentsLabel }))
  await waitFor(() => expect(row).toHaveFocus())
  fireEvent.click(row)
  fireEvent.change(screen.getByRole("textbox", { name: "Reply" }), {
    target: { value: "This is fixed." },
  })
  fireEvent.click(screen.getByRole("button", { name: "Reply" }))
  await waitFor(() =>
    expect(paths).toContainEqual({
      path: "/api/hub/comments/1/replies",
      method: "POST",
    }),
  )
  expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Reply" }))
  expect(paths.filter(({ path }) => path === "/api/hub/comments/1/replies")).toHaveLength(1)
  await act(async () => {
    finishReply(
      new Response(JSON.stringify({ comments: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    await Promise.resolve()
  })
  expect(paths).toContainEqual({ path: "/api/hub/comments", method: "POST" })
  view.unmount()
})

it("discards stale comments and metadata edits when the checkout changes", async () => {
  let resolveOld!: (response: Response) => void
  let requests = 0
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (path === "/api/hub/events") throw new Error("Live connection unavailable")
      if (path === "/api/hub/comments") {
        requests += 1
        if (requests === 1)
          return new Promise<Response>((resolve) => {
            resolveOld = resolve
          })
      }
      return Promise.resolve(
        new Response(JSON.stringify({ comments: [], hasMore: false, nextCursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
    }),
  )
  const status = {
    state: "connected" as const,
    repository: "github/prototype",
    branch: "prototype/first",
    prototype: {
      id: 1,
      repositoryId: 2001,
      branch: "prototype/first",
      name: "First",
      description: null,
      viewerLogin: "octocat",
      registered: true,
      canEdit: true,
      canRegister: true,
      published: false,
      buildState: null,
      versionCount: 0,
      build: null,
    },
  }
  const props = {
    config: { name: "Welcome", prototypeUrl: "http://localhost:4321/", token: "local" },
  }
  const view = renderPrototypeCanvasHubPanel({ ...props, status })
  await waitFor(() => expect(requests).toBeGreaterThan(0))
  const oldRequests = requests
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Draft" } })
  view.rerender({
    ...props,
    status: {
      ...status,
      branch: "prototype/second",
      prototype: { ...status.prototype, id: 2, branch: "prototype/second", name: "Second" },
    },
  })
  await waitFor(() => expect(requests).toBeGreaterThan(oldRequests))
  expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument()
  await act(async () => {
    resolveOld(
      new Response(
        JSON.stringify({ comments: [octocatRootComment], hasMore: false, nextCursor: null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
    await Promise.resolve()
  })
  expect(screen.getByRole("button", { name: /^Comments, 0/ })).toBeInTheDocument()
  view.unmount()
})

describe("PrototypeCanvasHubPanel()", () => {
  it.each(["comments", "error"] as const)(
    "keeps current-source feedback visible when stale %s arrive",
    async (staleResult) => {
      let finishOld!: (response: Response) => void
      const fetch = vi.fn((path: string) => {
        if (path === "/api/hub/events") throw new Error("Live connection unavailable")
        if (path.includes("local_revision_id=11"))
          return new Promise<Response>((resolve) => {
            finishOld = resolve
          })
        return Promise.resolve(
          Response.json({
            comments: [
              {
                ...octocatRootComment,
                body: "Current source comment.",
                draftRevisionId: 12,
                buildNumber: null,
              },
            ],
            hasMore: false,
            nextCursor: null,
          }),
        )
      })
      vi.stubGlobal("fetch", fetch)
      const status: HubStatus = {
        ...publicationHub,
        state: "connected",
        prototype: importedPrototype,
        reviewRevision: {
          ...publicationHub.reviewRevision!,
          id: 11,
          buildNumber: null,
          clean: false,
        },
      }

      const view = renderPrototypeCanvasHubPanel({ status })
      await waitFor(() => expect(finishOld).toBeTypeOf("function"))
      fireEvent.click(screen.getByRole("button", { name: /^Comments, 0/ }))
      view.rerender({
        status: {
          ...status,
          reviewRevision: { ...status.reviewRevision!, id: 12, treeSha: "c".repeat(40) },
        },
      })
      const sidebar = screen.getByRole("complementary", { name: reviewCommentsCopy.heading })
      expect(await within(sidebar).findByText("Current source comment.")).toBeVisible()
      await act(async () => {
        finishOld(
          staleResult === "error"
            ? Response.json({ error: "Old source is unavailable." }, { status: 503 })
            : Response.json({
                comments: [
                  {
                    ...octocatRootComment,
                    body: "Old source comment.",
                    draftRevisionId: 11,
                    buildNumber: null,
                  },
                ],
                hasMore: false,
                nextCursor: null,
              }),
        )
        await Promise.resolve()
      })
      expect(within(sidebar).getByText("Current source comment.")).toBeVisible()
      expect(within(sidebar).queryByText("Old source comment.")).not.toBeInTheDocument()
      expect(within(sidebar).queryByRole("alert")).not.toBeInTheDocument()
      expect(within(sidebar).queryByText(reviewCommentsCopy.loadingLabel)).not.toBeInTheDocument()
      view.unmount()
    },
  )

  it("keeps local feedback editable before discovery when source capture fails", async () => {
    const local = {
      ...octocatRootComment,
      body: "Local feedback before the first publish.",
      buildNumber: null,
      buildPath: null,
      draftRevisionId: 11,
      viewerLastSeenActivityVersion: octocatRootComment.activityVersion,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(Response.json({ comments: [local], hasMore: false, nextCursor: null })),
      ),
    )
    const view = renderPrototypeCanvasHubPanel({
      status: {
        ...publicationHub,
        state: "undiscovered",
        repositoryAuthorized: true,
        viewerLogin: "octocat",
        prototype: undefined,
        reviewError: "Commit or discard submodule changes before commenting.",
        reviewRevision: undefined,
      },
    })
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Local feedback before/ }))
    const conversation = await screen.findByRole("dialog", {
      name: reviewCommentsCopy.threadHeading,
    })
    expect(within(conversation).queryByRole("textbox")).not.toBeInTheDocument()
    expect(
      within(conversation).queryByRole("button", { name: reviewCommentsCopy.resolveLabel }),
    ).not.toBeInTheDocument()
    expect(
      within(conversation).queryByRole("button", { name: reviewCommentsCopy.addReactionLabel }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(conversation).getByRole("button", {
        name: reviewCommentsCopy.commentActionsLabel.replace("%{author}", "@octocat"),
      }),
    )
    expect(
      await screen.findByRole("menuitem", { name: reviewCommentsCopy.editLabel }),
    ).toBeEnabled()
    expect(screen.getByRole("menuitem", { name: reviewCommentsCopy.deleteLabel })).toBeEnabled()
    expect(
      screen.queryByRole("menuitem", { name: reviewCommentsCopy.markUnreadLabel }),
    ).not.toBeInTheDocument()
    expect(within(conversation).queryByRole("link", { name: /build/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: reviewCommentsCopy.editLabel }))
    expect(screen.getByRole("textbox", { name: reviewCommentsCopy.editCommentLabel })).toHaveValue(
      local.body,
    )
    view.unmount()
  })

  it.each(["draft revision", "published Build"] as const)(
    "saves once to the selected %s after source changes and a preview reload",
    async (target) => {
      const nonce = "00000000-0000-4000-8000-000000000022"
      vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce)
      const frameRef = createRef<HTMLIFrameElement>()
      const onFrameLoad = vi.fn()
      const originalRevision = {
        ...publicationHub.reviewRevision!,
        id: target === "draft revision" ? 11 : null,
        buildNumber: target === "published Build" ? 1 : null,
        clean: target === "published Build",
      }
      let finishPreparation!: (response: Response) => void
      let finishSave!: (response: Response) => void
      let savedRoot: typeof octocatRootComment | null = null
      const fetch = vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/hub/events") throw new Error("Live connection unavailable")
        if (path === "/api/hub/status")
          return target === "draft revision"
            ? new Promise<Response>((resolve) => {
                finishPreparation = resolve
              })
            : Promise.resolve(Response.json(status))
        if (path === "/api/hub/comments" && options?.method === "POST")
          return new Promise<Response>((resolve) => {
            finishSave = resolve
          })
        return Promise.resolve(
          Response.json({
            comments: savedRoot && target === "published Build" ? [savedRoot] : [],
            hasMore: false,
            nextCursor: null,
          }),
        )
      })
      vi.stubGlobal("fetch", fetch)
      const onStatusChange = vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Background status refresh is unavailable."))
      const status: HubStatus = {
        ...publicationHub,
        state: "connected",
        prototype:
          target === "draft revision" ? { ...importedPrototype, build: null } : importedPrototype,
        reviewRevision: originalRevision,
      }
      const view = renderPrototypeCanvasHubPanel(
        {
          frameRef,
          onStatusChange,
          status: {
            ...status,
            reviewRevision:
              target === "draft revision"
                ? { ...originalRevision, id: 10, treeSha: "e".repeat(40) }
                : originalRevision,
          },
        },
        <iframe ref={frameRef} title="Prototype" src="about:blank" onLoad={onFrameLoad} />,
      )
      fireEvent.click(await screen.findByRole("button", { name: /^Comments, 0/ }))
      await waitFor(() => expect(onFrameLoad).toHaveBeenCalled())
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://localhost:4321",
            source: frameRef.current?.contentWindow,
            data: {
              type: "replica:canvas:ready",
              nonce,
              protocolVersion: 1,
              route: { pathname: "/", search: "", hash: "" },
            },
          }),
        )
      })
      fireEvent.click(screen.getByRole("button", { name: reviewCommentsCopy.commentMenuLabel }))
      fireEvent.click(
        await screen.findByRole("menuitem", { name: reviewCommentsCopy.commentOnElementLabel }),
      )
      if (target === "draft revision") {
        await waitFor(() => expect(finishPreparation).toBeTypeOf("function"))
        await act(async () => {
          finishPreparation(Response.json(status))
          await Promise.resolve()
        })
      }
      await screen.findByRole("button", { name: reviewCommentsCopy.cancelSelectionLabel })
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://localhost:4321",
            source: frameRef.current?.contentWindow,
            data: {
              type: "replica:canvas:selected",
              nonce,
              anchor: octocatRootComment.anchor,
            },
          }),
        )
      })
      fireEvent.change(screen.getByRole("textbox", { name: reviewCommentsCopy.composerLabel }), {
        target: { value: "Keep the comment on the source I selected." },
      })
      view.rerender({
        status: {
          ...status,
          commitSha: "c".repeat(40),
          prototype: {
            ...importedPrototype,
            build: { ...importedPrototype.build!, number: 2, commitSha: "c".repeat(40) },
          },
          reviewRevision: {
            ...originalRevision,
            id: 12,
            buildNumber: null,
            treeSha: "d".repeat(40),
            commitSha: "c".repeat(40),
            clean: false,
          },
        },
      })
      fireEvent.load(frameRef.current!)
      expect(screen.getByRole("textbox", { name: reviewCommentsCopy.composerLabel })).toHaveValue(
        "Keep the comment on the source I selected.",
      )
      const submit = screen.getByRole("button", { name: reviewCommentsCopy.submitLabel })
      fireEvent.click(submit)
      await waitFor(() => expect(finishSave).toBeTypeOf("function"))
      fireEvent.click(submit)
      const saves = fetch.mock.calls.filter(
        ([input, options]) => input === "/api/hub/comments" && options?.method === "POST",
      )
      expect(saves).toHaveLength(1)
      expect(JSON.parse(saves[0]![1]!.body as string)).toEqual({
        review_revision: originalRevision,
        review_comment: {
          body: "Keep the comment on the source I selected.",
          anchor: octocatRootComment.anchor,
        },
      })
      savedRoot = {
        ...octocatRootComment,
        id: 22,
        draftRevisionId: originalRevision.id,
        buildNumber: originalRevision.buildNumber,
        buildPath: target === "draft revision" ? null : octocatRootComment.buildPath,
        body: "Keep the comment on the source I selected.",
      }
      await act(async () => {
        finishSave(
          Response.json(
            {
              comments: [savedRoot],
            },
            { status: 201 },
          ),
        )
        await Promise.resolve()
      })
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: reviewCommentsCopy.composerHeading }),
        ).not.toBeInTheDocument(),
      )
      if (target === "published Build") {
        const sidebar = screen.getByRole("complementary", { name: reviewCommentsCopy.heading })
        expect(await within(sidebar).findByText(savedRoot.body!)).toBeVisible()
      } else {
        expect(screen.queryByText(savedRoot.body!)).not.toBeInTheDocument()
        await waitFor(() =>
          expect(screen.getByRole("button", { name: /^Comments, 0/ })).toHaveFocus(),
        )
      }
      expect(screen.queryByText(reviewCommentsCopy.createErrorLabel)).not.toBeInTheDocument()
      expect(
        fetch.mock.calls.filter(
          ([input, options]) => input === "/api/hub/comments" && options?.method === "POST",
        ),
      ).toHaveLength(1)
      view.unmount()
    },
  )
})

it("does not mix conversations from two Hubs for the same repository and branch", async () => {
  let requests = 0
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (path === "/api/hub/events") throw new Error("Live connection unavailable")
      if (path === "/api/hub/comments") requests += 1
      return Promise.resolve(
        new Response(
          JSON.stringify({
            comments: requests === 1 ? [octocatRootComment] : [],
            hasMore: false,
            nextCursor: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    }),
  )
  const status = {
    state: "connected" as const,
    hubOrigin: "https://first.example.com",
    repository: "github/prototype",
    branch: "prototype/first",
    prototype: {
      id: 1,
      repositoryId: 2001,
      branch: "prototype/first",
      name: "First",
      description: null,
      viewerLogin: "octocat",
      registered: true,
      canEdit: false,
      canRegister: false,
      published: false,
      buildState: null,
      versionCount: 0,
      build: null,
    },
  }
  const props = {
    config: { name: "First", prototypeUrl: "http://localhost:4321/", token: "local" },
  }
  const view = renderPrototypeCanvasHubPanel({ ...props, status })
  await screen.findByRole("button", { name: /^Comments, 1/ })

  view.rerender({ ...props, status: { ...status, hubOrigin: "https://second.example.com" } })

  await screen.findByRole("button", { name: /^Comments, 0/ })
  expect(requests).toBeGreaterThan(1)
  view.unmount()
})

it("offers the shared connection dialog instead of guessing a Hub URL", () => {
  const view = renderPrototypeCanvasHubPanel({
    config: { name: "Example", prototypeUrl: "http://localhost:6006/", token: "local" },
    status: { state: "unconfigured" },
  })

  expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
  expect(screen.queryByText(/replica\.localhost/)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Connect to the Hub" })).toBeInTheDocument()
  view.unmount()
})

it("changes the selected Hub before connecting", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ state: "disconnected" })))
  const onSelectHub = vi.fn().mockResolvedValue(undefined)
  const view = renderPrototypeCanvasHubPanel({
    config: { name: "Example", prototypeUrl: "http://localhost:6006/", token: "local" },
    status: {
      state: "unavailable",
      hubOrigin: "http://replica.localhost:19500",
      repository: "github/prototype",
      branch: "prototype/welcome",
    },
    onSelectHub,
  })

  expect(screen.getByText("http://replica.localhost:19500")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
  await screen.findByRole("textbox", { name: "Hub URL" })
  expect(screen.queryByRole("button", { name: "Change Hub" })).not.toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue(
    "http://replica.localhost:19500",
  )
  expect(screen.getByText("Remote Hubs require HTTPS")).toBeInTheDocument()
  expect(screen.queryByText(/Changing Hubs keeps/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole("textbox", { name: "Hub URL" }), {
    target: { value: "https://team.example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  await waitFor(() => expect(onSelectHub).toHaveBeenCalledWith("https://team.example.com"))
  expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
  view.unmount()
})

it("resets only the editable URL and preserves the selected Hub until saved", async () => {
  const onSelectHub = vi.fn().mockResolvedValue(undefined)
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        discovery: { state: "valid", origin: "https://configured.example.com" },
      }),
    ),
  )
  vi.stubGlobal("fetch", fetch)
  const view = renderPrototypeCanvasHubPanel({
    config: { name: "Example", prototypeUrl: "http://localhost:6006/", token: "local" },
    status: { state: "unavailable", hubOrigin: "https://selected.example.com" },
    onSelectHub,
  })
  vi.stubGlobal("fetch", fetch.mockResolvedValueOnce(Response.json({ state: "disconnected" })))
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
  await screen.findByRole("textbox", { name: "Hub URL" })
  expect(screen.queryByText(/Repository Hub:/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Reset to repository Hub URL" }))
  expect(screen.getByRole("button", { name: "Save Hub" })).toBeDisabled()
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue(
      "https://configured.example.com",
    ),
  )
  expect(fetch).toHaveBeenCalledWith(
    "/api/hub/discovery",
    expect.objectContaining({ method: "POST" }),
  )
  expect(onSelectHub).not.toHaveBeenCalled()
  expect(screen.getByRole("link", { name: "https://selected.example.com" })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
  await waitFor(() => expect(onSelectHub).toHaveBeenCalledWith("https://configured.example.com"))
  view.unmount()
})

it.each(["absent", "unreachable"])(
  "keeps the draft and reports a %s reset failure",
  async (state) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ discovery: { state } }))),
    )
    const onSelectHub = vi.fn()
    const view = renderPrototypeCanvasHubPanel({
      config: { name: "Example", prototypeUrl: "http://localhost:6006/", token: "local" },
      status: { state: "unavailable", hubOrigin: "https://selected.example.com" },
      onSelectHub,
    })
    const fetch = vi.mocked(globalThis.fetch)
    fetch.mockResolvedValueOnce(Response.json({ state: "disconnected" }))
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
    await screen.findByRole("textbox", { name: "Hub URL" })
    fireEvent.change(screen.getByRole("textbox", { name: "Hub URL" }), {
      target: { value: "https://draft.example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Reset to repository Hub URL" }))
    await screen.findByText(/No repository Hub URL is available/)
    expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue(
      "https://draft.example.com",
    )
    expect(screen.getByRole("button", { name: "Reset to repository Hub URL" })).toBeEnabled()
    expect(onSelectHub).not.toHaveBeenCalled()
    view.unmount()
  },
)

it("uses one primary connection action without inline Hub configuration", () => {
  const onConnect = vi.fn()
  const view = renderPrototypeCanvasHubPanel({
    config: { name: "Example", prototypeUrl: "http://localhost:6006/", token: "local" },
    status: {
      state: "disconnected",
      repository: "github/prototype",
      branch: "prototype/welcome",
      hubOrigin: "https://hub.example.com",
      discovery: { state: "absent" },
    },
    onConnect,
  })

  const button = screen.getByRole("button", { name: "Connect to the Hub" })
  expect(screen.queryByRole("button", { name: "Retry discovery" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Change Hub" })).not.toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Hub" })).not.toBeInTheDocument()
  expect(screen.getByText("Connect to the hub before publishing this prototype.")).toBeVisible()
  expect(view.container.querySelector("details")).toBeNull()
  fireEvent.click(button)
  expect(onConnect).toHaveBeenCalledOnce()
  expect(screen.queryByText(/Using your selected Hub/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Choose a Hub manually/)).not.toBeInTheDocument()
  view.unmount()
})
