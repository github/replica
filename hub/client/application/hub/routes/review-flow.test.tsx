import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { deferred } from "@/test/deferred"
import { http, stubHubFetch } from "@/test/stub-hub-fetch"
import { privateReviewLink } from "@utils/private-review-link"
import type { PreviewBridgeCommand } from "@utils/preview-bridge/types"
import type { ReviewRoute } from "@utils/review-anchor/types"
import type { ReviewComment, ReviewRootComment } from "@utils/review-comment/types"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { previewHandlers } from "./fixtures/preview-handlers"
import { previewRecords } from "./fixtures/preview-records"
import { renderHubFlow } from "./fixtures/render-hub-flow"
import { reviewRecords } from "./fixtures/review-records"
import { reviewSockets } from "./fixtures/review-sockets"

function reviewFixture(
  preview = previewRecords({ canReview: true }),
  buildNumber = preview.latest.number,
  repositories = [preview.repository],
) {
  const { root, reply } = reviewRecords(preview.path, buildNumber)
  const comments: ReviewComment[] = [root, reply]
  const commentsPath = `/api${preview.path}/review-comments`
  const read = vi.fn(() => Response.json({ comments, nextCursor: null, hasMore: false }))
  const sockets = reviewSockets()
  const api = stubHubFetch(
    ...authenticatedWorkspace(repositories, { scopeRepositoryPermissions: true }),
    ...previewHandlers(preview),
    http.get(commentsPath, read),
  )
  return { ...preview, root, reply, comments, commentsPath, api, read, sockets }
}

function pinnedReviewPreview(options: Parameters<typeof previewRecords>[0]) {
  const preview = previewRecords(options)
  const { historical, path } = preview
  const access = new URL(`/api${path}/builds/${historical.number}/access`, window.location.origin)
  access.searchParams.set("target", "preview")
  access.searchParams.set("preview_origin", new URL(historical.previewUrl!).origin)
  historical.previewUrl = access.href
  preview.showPrototypeInfo = false
  return preview
}

function pinnedThreadLink(path: string, root: ReviewRootComment) {
  if (root.buildNumber === null) throw new Error("Expected a thread on a successful Build.")
  const { pathname, search, hash } = root.anchor.route
  const link = privateReviewLink({
    baseUrl: new URL(path, window.location.origin).href,
    buildNumber: root.buildNumber,
    route: `${pathname}${search}${hash}`,
    threadId: root.id,
  })
  if (!link) throw new Error("Expected a restorable review link.")
  return link
}

function loadPinnedPreview(frame: HTMLIFrameElement) {
  const previewWindow = frame.contentWindow
  const { searchParams } = new URL(frame.src)
  const origin = searchParams.get("preview_origin")
  if (!previewWindow || !origin) throw new Error("Expected an isolated Build preview.")
  const messageSource = { source: previewWindow, origin }
  const loaded = new URL(searchParams.get("route") ?? "/", origin)
  const post = vi.spyOn(previewWindow, "postMessage").mockImplementation(() => undefined)

  function commands() {
    return post.mock.calls.map(([command]) => command as PreviewBridgeCommand)
  }

  fireEvent.load(frame)
  const ready = commands().find(({ type }) => type === "replica:bridge:request-navigation-ready")
  if (!ready) throw new Error("Expected Hub to request Build preview readiness.")
  const navigationId = ready.requestId
  function reportReady(requestId: string, route: ReviewRoute) {
    fireEvent(
      window,
      new MessageEvent("message", {
        ...messageSource,
        data: {
          type: "replica:bridge:ready",
          protocolVersion: 1,
          requestId,
          navigationId,
          payload: { route },
        },
      }),
    )
  }
  reportReady(navigationId, { pathname: loaded.pathname, search: loaded.search, hash: loaded.hash })
  const restore = commands().find((command) => command.type === "replica:bridge:restore-fragment")
  if (restore) reportReady(restore.requestId, restore.payload.route)
}

describe("Hub prototype review flow", () => {
  it("shows a saved reaction and resolved conversation after leaving and reopening review", async () => {
    const { api, root, path, commentsPath } = reviewFixture()
    const add = vi.fn()
    api.use(
      http.post(`${commentsPath}/1/reactions`, async ({ request }) => {
        add(await request.json())
        root.reactions = [{ content: "+1", count: 1, viewerHasReacted: true }]
        return Response.json({ comments: [root] })
      }),
      http.post(`${commentsPath}/1/resolution`, () => {
        root.resolvedAt = "2026-11-20T12:00:00Z"
        root.resolvedBy = root.author
        return Response.json({ comments: [root] })
      }),
      http.delete(`${commentsPath}/1/resolution`, () => {
        root.resolvedAt = null
        root.resolvedBy = null
        return Response.json({ comments: [root] })
      }),
    )
    const router = await renderHubFlow(api, `${path}?build=3&comment=1`)
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    fireEvent.click(within(conversation).getAllByRole("button", { name: "Add reaction" })[0]!)
    await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ })))
    expect(add).toHaveBeenCalledExactlyOnceWith({
      review_comment_reaction: { content: "+1", activity_version: 1 },
    })
    await router.settle(() =>
      fireEvent.click(within(conversation).getByRole("button", { name: "Resolve" })),
    )
    expect(await within(conversation).findByRole("button", { name: "Reopen" })).toBeEnabled()
    expect(within(conversation).queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument()

    await router.settle(() => router.navigate(`${path}/builds?build=3`))
    expect(screen.getByRole("heading", { name: "History", level: 2 })).toBeVisible()
    await router.settle(() => router.navigate(`${path}?build=3&comment=1&commentResolved=1`))
    const reopened = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(reopened).getByRole("button", { name: "Thumbs up, 1 reaction" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await router.settle(() =>
      fireEvent.click(within(reopened).getByRole("button", { name: "Reopen" })),
    )
    expect(await within(reopened).findByRole("textbox", { name: "Reply" })).toBeEnabled()
  }, 15_000)

  it.each([422, 500])(
    "retains a reply draft after HTTP %i without reloading the editor",
    async (status) => {
      const { api, path, comments, commentsPath, reply } = reviewFixture()
      const { promise: blocked, resolve: release } = deferred()
      onTestFinished(() => release())
      const failedSave = vi.fn(async () => {
        await blocked
        return Response.json({ error: "The reply could not be saved." }, { status })
      })
      const router = await renderHubFlow(api, `${path}?build=3&comment=1`)
      const conversation = await screen.findByRole("dialog", { name: "Conversation" })
      const input = within(conversation).getByRole("textbox", { name: "Reply" })
      const submit = within(conversation).getByRole("button", { name: "Reply" })
      const draft = "Keep this review draft."
      const failedRead = vi.fn(() =>
        Response.json({ error: "Loaded resources are unavailable." }, { status: 503 }),
      )
      api.use(
        http.post(`${commentsPath}/1/replies`, failedSave),
        http.get(`/api${path}`, failedRead),
        http.get(commentsPath, failedRead),
        http.get("/api/workspace", failedRead),
      )
      fireEvent.change(input, { target: { value: draft } })

      fireEvent.click(submit)
      await waitFor(() => expect(failedSave).toHaveBeenCalledOnce())
      expect(submit).toBeDisabled()
      release()
      await router.settle()

      expect(await within(conversation).findByRole("alert")).toBeVisible()
      expect(within(conversation).getByText(reply.body!)).toBeVisible()
      expect(input).toHaveValue(draft)
      expect(submit).toBeEnabled()
      expect(screen.getByTitle("Welcome, Build 3 preview")).toBeInTheDocument()
      expect(failedRead).not.toHaveBeenCalled()

      api.reset()
      api.use(
        http.post(`${commentsPath}/1/replies`, async ({ request }) => {
          const { review_comment } = (await request.json()) as { review_comment: { body: string } }
          const saved = { ...reply, id: 3, body: review_comment.body }
          comments.push(saved)
          return Response.json({ comments: [saved] })
        }),
      )
      await router.settle(() => fireEvent.click(submit))

      expect(await within(conversation).findByText(draft)).toBeVisible()
      expect(input).toHaveValue("")
      expect(within(conversation).queryByRole("alert")).not.toBeInTheDocument()
    },
    15_000,
  )

  it("reports invalid review data and loads comments after an explicit retry", async () => {
    const { api, path, commentsPath } = reviewFixture()
    api.use(
      http.get(commentsPath, () =>
        Response.json({
          comments: [{ id: 1, body: "A malformed comment." }],
          hasMore: false,
          nextCursor: null,
        }),
      ),
    )
    const router = await renderHubFlow(api, path)
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 0/ }))
    const sidebar = screen.getByRole("complementary", { name: "Comments" })

    expect(await within(sidebar).findByRole("alert")).toHaveTextContent(/could not be loaded/i)
    expect(within(sidebar).queryByText("No comments have been added.")).not.toBeInTheDocument()
    api.reset()
    await router.settle(() =>
      fireEvent.click(within(sidebar).getByRole("button", { name: "Retry" })),
    )
    expect(
      await within(sidebar).findByRole("button", { name: /welcome heading clearer/ }),
    ).toBeVisible()
    expect(within(sidebar).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps details editable but shows no review conversation when a pinned link is denied", async () => {
    const preview = pinnedReviewPreview({ canBranch: false })
    const { historical, path, prototype, repository } = preview
    const { root, reply } = reviewRecords(path, historical.number)
    const sockets = reviewSockets()
    const api = stubHubFetch(
      ...authenticatedWorkspace([repository], {
        provider: "local",
        administerHub: true,
        scopeRepositoryPermissions: true,
      }),
      ...previewHandlers(preview),
    )
    await renderHubFlow(api, pinnedThreadLink(path, root))
    loadPinnedPreview(screen.getByTitle<HTMLIFrameElement>("Welcome, Build 1 preview"))

    expect(api.requests.map(({ url }) => new URL(url).pathname)).toContain(
      `/api${path}/review-comments`,
    )
    expect(screen.queryByRole("dialog", { name: "Conversation" })).not.toBeInTheDocument()
    const addComment = screen.getByRole("button", { name: "Add a comment" })
    expect(addComment).toBeDisabled()
    expect(addComment).toHaveAccessibleDescription(/do not have permission to add review comments/i)
    fireEvent.click(screen.getByRole("button", { name: "Comments, 0" }))
    const sidebar = screen.getByRole("complementary", { name: "Comments" })
    const reviewError = within(sidebar).getByRole("alert")
    expect(reviewError).toBeVisible()
    expect(reviewError).toHaveTextContent(/comments could not be loaded/i)
    expect(within(sidebar).queryByText("No comments have been added.")).not.toBeInTheDocument()
    expect(screen.queryByText(root.body!)).not.toBeInTheDocument()
    expect(screen.queryByText(reply.body!)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^(Reply|Resolve|Add reaction)$/ }),
    ).not.toBeInTheDocument()
    expect(sockets).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const editor = screen.getByRole("dialog", { name: "Edit prototype details" })
    expect(within(editor).getByRole("textbox", { name: "Name" })).toHaveValue(prototype.name)
    expect(within(editor).getByRole("button", { name: "Save details" })).toBeEnabled()
    expect(api.requests.filter(({ method }) => method !== "GET")).toEqual([])
  })

  it("restores the older Build and exact thread from a private Hub link and refreshes it live", async () => {
    const preview = pinnedReviewPreview({ canReview: true })
    const { historical, latest, path, repository, prototype, galleryPath } = preview
    const otherRepository = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      nameWithOwner: "team/another-repository",
      defaultBranch: "main",
    }
    repository.capabilities!.manageAnalytics = true
    const { api, comments, root, reply, sockets } = reviewFixture(preview, historical.number, [
      otherRepository,
      repository,
    ])
    const otherThread = "A newer conversation about the latest Build."
    comments.unshift({
      ...root,
      id: 21,
      body: otherThread,
      createdAt: "2026-11-20T20:00:00.000Z",
      updatedAt: "2026-11-20T20:00:00.000Z",
      buildNumber: latest.number,
      buildPath: `${path}?build=${latest.number}`,
    })
    const router = await renderHubFlow(api, pinnedThreadLink(path, root))
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })

    const frame = screen.getByTitle<HTMLIFrameElement>("Welcome, Build 1 preview")
    expect(new URL(frame.src).pathname).toBe(`/api${path}/builds/1/access`)
    loadPinnedPreview(frame)
    expect(screen.getByRole("textbox", { name: "Preview URL" })).toHaveValue(
      "https://build-1.example.test/welcome?step=2#heading",
    )
    expect(within(conversation).getByText(root.body!)).toBeVisible()
    expect(within(conversation).getByText(reply.body!)).toBeVisible()
    expect(within(conversation).queryByText(otherThread)).not.toBeInTheDocument()
    expect(within(conversation).getByRole("textbox", { name: "Reply" })).toBeEnabled()
    expect(await screen.findByRole("link", { name: "Analytics" })).toHaveAttribute(
      "href",
      `${galleryPath}/analytics`,
    )

    const channel = `review:${repository.id}:${prototype.id}`
    expect(sockets).toHaveLength(1)
    const socket = sockets[0]!
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ type: "subscribe", channel }),
    )
    await router.settle(() => socket.receive({ type: "subscribed", channel }))
    reply.body = "The heading has been shortened in the draft."
    await router.settle(() =>
      socket.receive({ type: "event", channel, event: { type: "changed", payload: null } }),
    )

    expect(within(conversation).getByText(reply.body)).toBeVisible()
  })

  it("opens the pinned Inbox conversation and keeps it read on return", async () => {
    const { api, root, path, repository, prototype } = reviewFixture()
    const activity = {
      id: 7,
      version: 1,
      actor: root.author,
      kind: "mention",
      excerpt: root.body,
      createdAt: root.createdAt,
      read: false,
      repository: repository.nameWithOwner,
      prototype: prototype.name,
      path: `${path}?build=3&comment=1&message=1&notification=7`,
      updatePath: "/api/notifications/7",
      target: { prototypeId: prototype.id, threadId: root.id, commentId: root.id },
    }
    const markRead = vi.fn()
    api.use(
      ...authenticatedWorkspace([repository], {
        reviewInboxAvailable: true,
        scopeRepositoryPermissions: true,
      }),
      http.get("/api/notifications/inbox", () =>
        Response.json({
          notifications: [activity],
          nextBefore: null,
          unreadCount: activity.read ? 0 : 1,
        }),
      ),
      http.get(activity.updatePath, () => Response.json(activity)),
      http.patch(activity.updatePath, async ({ request }) => {
        markRead(await request.json())
        activity.read = true
        activity.version += 1
        return Response.json({ read: true, version: activity.version, unreadCount: 0 })
      }),
    )
    const router = await renderHubFlow(api, "/notifications")
    const link = within(await screen.findByRole("region", { name: "Inbox" })).getByRole("link")
    expect(link).toHaveAttribute("href", activity.path)

    await router.settle(() => fireEvent.click(link))

    const thread = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(thread).getByText(root.body!)).toBeVisible()
    expect(router.state.location.pathname + router.state.location.search).toBe(activity.path)
    await waitFor(() =>
      expect(markRead).toHaveBeenCalledExactlyOnceWith({
        notification: { read: true, version: 1 },
      }),
    )
    await router.go(-1)
    expect(await screen.findByRole("button", { name: "Mark as unread: mona" })).toBeVisible()
  })

  it("restores shared review filters through back navigation without discarding the open reply draft", async () => {
    const { api, path, read } = reviewFixture()
    const router = await renderHubFlow(
      api,
      `${path}?build=3&comment=1&commentSearch=welcome&commentResolved=1`,
    )
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    fireEvent.click(screen.getByRole("button", { name: /^Comments, 1/ }))
    const sidebar = screen.getByRole("complementary", { name: "Comments" })
    const search = within(sidebar).getByRole("searchbox", { name: "Search comments" })
    expect(search).toHaveValue("welcome")
    fireEvent.click(within(sidebar).getByRole("button", { name: "Filters" }))
    expect(within(sidebar).getByRole("switch", { name: "Show resolved" })).toBeChecked()
    const readsBeforeFiltering = read.mock.calls.length
    const input = within(conversation).getByRole("textbox", { name: "Reply" })
    fireEvent.change(input, {
      target: { value: "Keep this draft while navigating review filters." },
    })

    await router.settle(() =>
      fireEvent.change(search, { target: { value: "No matching conversation" } }),
    )
    expect(await within(sidebar).findByText("No comments match these filters.")).toBeVisible()
    expect(new URLSearchParams(router.state.location.search).get("commentSearch")).toBe(
      "No matching conversation",
    )
    await router.go(-1)

    expect(search).toHaveValue("welcome")
    expect(within(sidebar).getByRole("switch", { name: "Show resolved" })).toBeChecked()
    expect(within(sidebar).getByRole("button", { name: /welcome heading clearer/ })).toBeVisible()
    expect(screen.getByRole("dialog", { name: "Conversation" })).toBe(conversation)
    expect(input).toHaveValue("Keep this draft while navigating review filters.")
    expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({
      build: "3",
      comment: "1",
      commentSearch: "welcome",
      commentResolved: "1",
    })
    expect(read).toHaveBeenCalledTimes(readsBeforeFiltering)
  })

  it("aborts a pending reply when its review screen is left", async () => {
    const { api, path, commentsPath } = reviewFixture()
    const { promise: blocked, resolve: release } = deferred()
    const { promise: started, resolve: notify } = deferred<AbortSignal>()
    onTestFinished(() => release())
    const save = vi.fn()
    api.use(
      http.post(`${commentsPath}/1/replies`, async ({ request }) => {
        notify(request.signal)
        await blocked
        request.signal.throwIfAborted()
        save()
        return Response.json({ comments: [] })
      }),
    )
    const router = await renderHubFlow(api, `${path}?build=3&comment=1`)
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    fireEvent.change(within(conversation).getByRole("textbox", { name: "Reply" }), {
      target: { value: "This abandoned reply must never be shown." },
    })
    fireEvent.click(within(conversation).getByRole("button", { name: "Reply" }))
    const signal = await started
    expect(signal.aborted).toBe(false)

    await router.settle(() => router.navigate(`${path}/builds?build=3`))
    expect(signal.aborted).toBe(true)
    release()

    expect(screen.getByRole("heading", { name: "History", level: 2 })).toBeVisible()
    expect(conversation).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  }, 15_000)
})
