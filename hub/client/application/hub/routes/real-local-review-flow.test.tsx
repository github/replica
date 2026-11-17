import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import type { ComponentType } from "react"
import {
  createBrowserRouter,
  RouterProvider,
  useLoaderData,
  type ActionFunction,
  type LoaderFunction,
  type RouteObject,
} from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { PreviewBridgeCommand, PreviewBridgeMessage } from "@utils/preview-bridge/types"
import type { ReviewComment, ReviewRootComment } from "@utils/review-comment/types"

type RouteModule = {
  default?: ComponentType<{ loaderData: unknown }>
  clientLoader?: LoaderFunction
  clientAction?: ActionFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
}

const routeModules = import.meta.glob<RouteModule>([
  "../root.tsx",
  "./**/index.tsx",
  "!./fixtures/**",
])

function applicationRoute(entry: RouteConfigEntry): RouteObject {
  const modulePath =
    entry.file === "root.tsx" ? "../root.tsx" : `./${entry.file.replace(/^routes\//, "")}`
  const loadModule = routeModules[modulePath]
  if (!loadModule) throw new Error(`Missing application route module: ${entry.file}`)
  const common = {
    id: entry.id ?? entry.file.replace(/\.tsx$/, ""),
    path: entry.path,
    lazy: async () => {
      const module = await loadModule()
      const Page = module.default
      return {
        loader: module.clientLoader,
        action: module.clientAction,
        ErrorBoundary: module.ErrorBoundary,
        HydrateFallback: module.HydrateFallback,
        Component: Page ? () => <Page loaderData={useLoaderData()} /> : undefined,
      }
    },
  }
  return entry.index
    ? { ...common, index: true }
    : { ...common, children: entry.children?.map(applicationRoute) }
}

async function renderApplication(path: string) {
  const [{ default: routes }, { HubThemeProvider }] = await Promise.all([
    import("../routes"),
    import("@hooks/use-hub-theme"),
  ])
  window.history.replaceState(null, "", path)
  const router = createBrowserRouter(
    [applicationRoute({ id: "root", file: "root.tsx", children: routes })],
    { window },
  )
  onTestFinished(() => router.dispose())
  await act(async () => {
    await vi.waitFor(() => expect(router.state.initialized).toBe(true), { timeout: 10_000 })
  })
  render(
    <HubThemeProvider>
      <RouterProvider router={router} />
    </HubThemeProvider>,
  )
}

const author = {
  login: "local-developer",
  name: "Local developer",
  avatarUrl: null,
}
const anchor = {
  schemaVersion: 1 as const,
  kind: "element" as const,
  route: { pathname: "/", search: "", hash: "" },
  selector: "#save",
  accessibleName: "Save",
  tagName: "button",
  selectedText: "",
  rect: { x: 120, y: 160, width: 120, height: 40 },
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
  elementOffset: { x: 0.5, y: 0.5 },
}

function rootComment(id: number, body: string): ReviewRootComment {
  return {
    id,
    kind: "root",
    buildNumber: 3,
    buildPath: "/repositories/repository-1/prototypes/prototype-1?build=3",
    body,
    anchor,
    createdAt: "2026-11-16T20:00:00.000Z",
    updatedAt: "2026-11-16T20:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    activityVersion: 1,
    viewerLastSeenActivityVersion: 1,
    author,
    viewerCanEdit: true,
    viewerCanDelete: true,
    reactions: [],
  }
}

describe("real local review flow", () => {
  it("completes persisted review mutations while preserving a failed reply draft", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const prototypeId = "22222222-2222-4222-8222-222222222222"
    const userId = "33333333-3333-4333-8333-333333333333"
    const prototypePath = `/repositories/${repositoryId}/prototypes/${prototypeId}`
    const reviewPath = `/api${prototypePath}/review-comments`
    const previewOrigin = "https://build.preview.example.test"
    const previewUrl = new URL(
      `/api${prototypePath}/builds/3/access?target=preview`,
      window.location.origin,
    )
    previewUrl.searchParams.set("preview_origin", previewOrigin)
    const repository = {
      id: repositoryId,
      nameWithOwner: "local/review-prototype",
      defaultBranch: "main",
    }
    const build = {
      number: 3,
      repositoryId,
      prototypeId,
      state: "successful",
      commitSha: null,
      commitAuthorProvider: null,
      commitAuthorIssuer: null,
      commitAuthorProviderUserId: null,
      commitAuthorLogin: null,
      commitAuthorName: null,
      commitAuthorAvatarUrl: null,
      createdAt: "2026-11-16T19:00:00.000Z",
      startedAt: "2026-11-16T19:00:00.000Z",
      finishedAt: "2026-11-16T19:01:00.000Z",
      previewUrl: previewUrl.toString(),
      desktopScreenshotUrl: null,
      narrowScreenshotUrl: null,
      failureSummary: null,
    }
    const prototype = {
      id: prototypeId,
      repositoryId,
      name: "Local review prototype",
      branchName: "prototype/local-review",
      description: null,
      authorProvider: "local",
      authorLogin: author.login,
      authorName: author.name,
      canEdit: true,
      startPage: "/",
      latestBuild: { number: 3, state: "successful" },
      builds: [build],
    }
    let nextId = 2
    let comments: ReviewComment[] = [rootComment(1, "Persisted conversation")]
    let failNextReply = false
    const createdAnchors: (typeof anchor)[] = []
    const listResponse = () => ({ comments, nextCursor: null, hasMore: false })
    const mutationResponse = (changed: ReviewComment, root?: ReviewRootComment) => ({
      comments: root && changed.id !== root.id ? [changed, root] : [changed],
    })
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json({
          authenticated: true,
          membershipId: "44444444-4444-4444-8444-444444444444",
          userId,
          provider: "local",
          login: author.login,
          name: author.name,
          role: "ADMINISTRATOR",
        }),
      ),
      http.get(`${window.location.origin}/api/session`, () =>
        HttpResponse.json({ error: "This endpoint is unavailable in real mode." }, { status: 404 }),
      ),
      http.get(`${window.location.origin}/api/workspace`, () =>
        HttpResponse.json({
          viewer: { id: userId, provider: "local", ...author },
          repositories: [repository],
          capabilities: {
            createPrototypes: false,
            reviewPrototypes: true,
            manageSharing: false,
            administerHub: true,
          },
        }),
      ),
      http.get(`${window.location.origin}/api${prototypePath}`, () =>
        HttpResponse.json({
          repository,
          prototype,
          selectedBuild: build,
          showPrototypeInfo: false,
        }),
      ),
      http.get(`${window.location.origin}${reviewPath}`, () => HttpResponse.json(listResponse())),
      http.post(`${window.location.origin}${reviewPath}`, async ({ request }) => {
        const input = (await request.json()) as {
          review_comment: { body: string; anchor: typeof anchor }
        }
        createdAnchors.push(input.review_comment.anchor)
        const created = rootComment(nextId++, input.review_comment.body)
        comments = [created, ...comments]
        return HttpResponse.json(mutationResponse(created), { status: 201 })
      }),
      http.post(
        `${window.location.origin}${reviewPath}/:rootId/replies`,
        async ({ params, request }) => {
          if (failNextReply) {
            failNextReply = false
            return HttpResponse.json({ error: "The reply could not be saved." }, { status: 500 })
          }
          const input = (await request.json()) as { review_comment: { body: string } }
          const rootId = Number(params.rootId)
          const root = comments.find(
            (comment): comment is ReviewRootComment =>
              comment.kind === "root" && comment.id === rootId,
          )
          if (!root) return HttpResponse.json({ error: "Not found." }, { status: 404 })
          const reply: ReviewComment = {
            id: nextId++,
            kind: "reply",
            rootId,
            body: input.review_comment.body,
            createdAt: "2026-11-16T20:02:00.000Z",
            updatedAt: "2026-11-16T20:02:00.000Z",
            editedAt: null,
            deletedAt: null,
            author,
            viewerCanEdit: true,
            viewerCanDelete: true,
            reactions: [],
          }
          comments = [reply, ...comments]
          return HttpResponse.json(mutationResponse(reply, root), { status: 201 })
        },
      ),
      http.patch(
        `${window.location.origin}${reviewPath}/:commentId`,
        async ({ params, request }) => {
          const input = (await request.json()) as { review_comment: { body: string } }
          const id = Number(params.commentId)
          const current = comments.find((comment) => comment.id === id)
          if (!current) return HttpResponse.json({ error: "Not found." }, { status: 404 })
          const edited = {
            ...current,
            body: input.review_comment.body,
            updatedAt: "2026-11-16T20:03:00.000Z",
            editedAt: "2026-11-16T20:03:00.000Z",
          }
          comments = comments.map((comment) => (comment.id === id ? edited : comment))
          return HttpResponse.json(mutationResponse(edited))
        },
      ),
      http.delete(`${window.location.origin}${reviewPath}/:commentId`, ({ params }) => {
        const id = Number(params.commentId)
        const current = comments.find((comment) => comment.id === id)
        if (!current) return HttpResponse.json({ error: "Not found." }, { status: 404 })
        const deleted = {
          ...current,
          body: null,
          editedAt: null,
          deletedAt: "2026-11-16T20:04:00.000Z",
        }
        comments = comments.map((comment) => (comment.id === id ? deleted : comment))
        return HttpResponse.json(mutationResponse(deleted))
      }),
      http.post(
        `${window.location.origin}${reviewPath}/:rootId/resolution`,
        ({ params }) => {
          const id = Number(params.rootId)
          const current = comments.find(
            (comment): comment is ReviewRootComment =>
              comment.kind === "root" && comment.id === id,
          )
          if (!current) return HttpResponse.json({ error: "Not found." }, { status: 404 })
          const resolved = {
            ...current,
            resolvedAt: "2026-11-16T20:05:00.000Z",
            resolvedBy: author,
          }
          comments = comments.map((comment) => (comment.id === id ? resolved : comment))
          return HttpResponse.json(mutationResponse(resolved))
        },
      ),
      http.delete(
        `${window.location.origin}${reviewPath}/:rootId/resolution`,
        ({ params }) => {
          const id = Number(params.rootId)
          const current = comments.find(
            (comment): comment is ReviewRootComment =>
              comment.kind === "root" && comment.id === id,
          )
          if (!current) return HttpResponse.json({ error: "Not found." }, { status: 404 })
          const reopened = { ...current, resolvedAt: null, resolvedBy: null }
          comments = comments.map((comment) => (comment.id === id ? reopened : comment))
          return HttpResponse.json(mutationResponse(reopened))
        },
      ),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    await renderApplication(`${prototypePath}?build=3`)

    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
    fireEvent.click(screen.getByRole("button", { name: /Persisted conversation/ }))
    let conversation = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(conversation).getByText("Persisted conversation")).toBeVisible()
    expect(within(conversation).queryByRole("button", { name: "Add reaction" })).toBeNull()
    fireEvent.click(
      within(conversation).getByRole("button", {
        name: `Actions for comment by @${author.login}`,
      }),
    )
    expect(screen.queryByRole("menuitem", { name: "Mark as unread" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    const frame = screen.getByTitle("Local review prototype, Build 3 preview")
    const commands: PreviewBridgeCommand[] = []
    vi.spyOn((frame as HTMLIFrameElement).contentWindow!, "postMessage").mockImplementation(
      (command: PreviewBridgeCommand) => commands.push(command),
    )
    const receive = (message: PreviewBridgeMessage) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (frame as HTMLIFrameElement).contentWindow,
          origin: previewOrigin,
          data: message,
        }),
      )
    receive({
      type: "replica:bridge:ready",
      protocolVersion: 1,
      requestId: "ready",
      payload: { route: { pathname: "/", search: "", hash: "" } },
    })
    fireEvent.click(screen.getByRole("button", { name: "Back to comments" }))
    fireEvent.click(screen.getByRole("button", { name: "Add a comment" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Comment on element" }))
    const selection = commands.findLast(
      (command) => command.type === "replica:bridge:select-element",
    )
    if (!selection) throw new Error("The preview bridge did not receive an element selection.")
    receive({
      type: "replica:bridge:element-selected",
      protocolVersion: 1,
      requestId: selection.requestId,
      payload: { anchor },
    })
    const composer = await screen.findByRole("dialog", { name: "New comment" })
    fireEvent.change(within(composer).getByRole("textbox", { name: "Comment" }), {
      target: { value: "Conversation from the preview anchor" },
    })
    fireEvent.click(within(composer).getByRole("button", { name: "Comment" }))
    conversation = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(conversation).getByText("Conversation from the preview anchor")).toBeVisible()
    expect(createdAnchors).toEqual([anchor])

    const reply = within(conversation).getByRole("textbox", { name: "Reply" })
    fireEvent.change(reply, { target: { value: "Reply to edit and delete" } })
    fireEvent.click(within(conversation).getByRole("button", { name: "Reply" }))
    expect(await within(conversation).findByText("Reply to edit and delete")).toBeVisible()
    const message = within(conversation).getByText("Reply to edit and delete").closest("article")
    if (!message) throw new Error("Expected the saved reply message.")
    fireEvent.click(
      within(message).getByRole("button", { name: `Actions for comment by @${author.login}` }),
    )
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }))
    fireEvent.change(within(message).getByRole("textbox", { name: "Edit comment" }), {
      target: { value: "Edited reply" },
    })
    fireEvent.click(within(message).getByRole("button", { name: "Save" }))
    expect(await within(message).findByText("Edited reply")).toBeVisible()
    fireEvent.click(
      within(message).getByRole("button", { name: `Actions for comment by @${author.login}` }),
    )
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))
    fireEvent.click(within(message).getByRole("button", { name: "Delete" }))
    expect(await within(message).findByText("Comment deleted")).toBeVisible()

    fireEvent.click(within(conversation).getByRole("button", { name: "Resolve" }))
    expect(await within(conversation).findByRole("button", { name: "Reopen" })).toBeEnabled()
    fireEvent.click(within(conversation).getByRole("button", { name: "Reopen" }))
    expect(await within(conversation).findByRole("textbox", { name: "Reply" })).toBeEnabled()

    const failedDraft = "Keep this failed local reply."
    failNextReply = true
    fireEvent.change(within(conversation).getByRole("textbox", { name: "Reply" }), {
      target: { value: failedDraft },
    })
    fireEvent.click(within(conversation).getByRole("button", { name: "Reply" }))
    expect(await within(conversation).findByRole("alert")).toHaveTextContent(
      /reply could not be saved/i,
    )
    expect(within(conversation).getByText("Conversation from the preview anchor")).toBeVisible()
    expect(within(conversation).getByRole("textbox", { name: "Reply" })).toHaveValue(failedDraft)
    await waitFor(() =>
      expect(within(conversation).getByRole("button", { name: "Reply" })).toBeEnabled(),
    )
  }, 20_000)
})
