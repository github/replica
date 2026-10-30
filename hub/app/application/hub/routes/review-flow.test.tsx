import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { renderHubFlow } from "./test-fixture"

describe("Hub prototype review flow", () => {
  // The full mutation/remount/reopen flow has exceeded 15s with two Windows workers.
  it("loads the seeded conversation and retains replies, reactions and resolution across routes", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(screen.getByRole("button", { name: /^Comments, 1/ }))
    await router.settle(() =>
      fireEvent.click(
        screen.getByRole("button", { name: /Could we make the welcome heading clearer\?/ }),
      ),
    )
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(conversation).getByText("I will try a shorter heading.")).toBeVisible()
    fireEvent.change(within(conversation).getByRole("textbox", { name: "Reply" }), {
      target: { value: "The shorter heading works well." },
    })
    await router.settle(() =>
      fireEvent.click(within(conversation).getByRole("button", { name: "Reply" })),
    )
    expect(
      await within(conversation).findByText("The shorter heading works well."),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(conversation).getByRole("textbox", { name: "Reply" })).toHaveValue(""),
    )
    fireEvent.click(within(conversation).getAllByRole("button", { name: "Add reaction" })[0]!)
    await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: /Thumbs up/ })))
    expect(
      await within(conversation).findByRole("button", { name: "Thumbs up, 1 reaction" }),
    ).toHaveAttribute("aria-pressed", "true")
    await router.settle(() =>
      fireEvent.click(within(conversation).getByRole("button", { name: "Resolve" })),
    )
    expect(await within(conversation).findByRole("button", { name: "Reopen" })).toBeEnabled()
    expect(within(conversation).queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument()

    await router.settle(() => router.navigate("/repositories/2001/prototypes/1/builds"))
    await screen.findByRole("heading", { name: "History", level: 2 })
    await router.settle(() => router.navigate("/repositories/2001/prototypes/1"))
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
    fireEvent.click(screen.getByRole("button", { name: "Filters" }))
    await router.settle(() =>
      fireEvent.click(screen.getByRole("switch", { name: "Show resolved" })),
    )
    await router.settle(() =>
      fireEvent.click(
        screen.getByRole("button", { name: /Could we make the welcome heading clearer\?/ }),
      ),
    )
    const reopened = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(reopened).getByText("The shorter heading works well.")).toBeInTheDocument()
    expect(within(reopened).getByRole("button", { name: "Thumbs up, 1 reaction" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await router.settle(() =>
      fireEvent.click(within(reopened).getByRole("button", { name: "Reopen" })),
    )
    expect(await within(reopened).findByRole("textbox", { name: "Reply" })).toBeEnabled()
  }, 20_000)

  // Failure, scenario navigation and retry have exceeded the 5s Windows case budget.
  it("retains a failed reply draft and permits a retry without destructive loader revalidation", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(
      server,
      "/repositories/2001/prototypes/1?mockScenario=save-error",
    )
    fireEvent.click(screen.getByRole("button", { name: /^Comments, 1/ }))
    await router.settle(() =>
      fireEvent.click(
        screen.getByRole("button", { name: /Could we make the welcome heading clearer\?/ }),
      ),
    )
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    await waitFor(() =>
      expect(
        within(screen.getByRole("complementary", { name: "Comments" })).getByRole("button", {
          name: /Could we make the welcome heading clearer\?/,
        }),
      ).not.toHaveAccessibleName(/Unread/),
    )
    const reply = within(conversation).getByRole("textbox", { name: "Reply" })
    fireEvent.change(reply, { target: { value: "Keep this review draft." } })
    let finishSave: (() => void) | undefined
    const saving = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    onTestFinished(() => finishSave?.())
    const failedSave = vi.fn(async () => {
      await saving
      return HttpResponse.json({ error: "Reviews are temporarily unavailable." }, { status: 503 })
    })
    const failedReads = vi.fn(() =>
      HttpResponse.json({ error: "Loaded resources are unavailable." }, { status: 503 }),
    )
    server.use(
      http.post(
        `${store.origin}/api/repositories/2001/prototypes/1/review-comments/1/replies`,
        failedSave,
      ),
      http.get(`${store.origin}/api/*`, failedReads),
    )

    fireEvent.click(within(conversation).getByRole("button", { name: "Reply" }))
    await waitFor(() => expect(failedSave).toHaveBeenCalledOnce())
    expect(within(conversation).getByRole("button", { name: "Reply" })).toBeDisabled()
    if (!finishSave) throw new Error("The pending reply did not expose its completion.")
    finishSave()
    await router.settle()

    expect(await within(conversation).findByRole("alert")).toHaveTextContent(
      /reply could not be saved/i,
    )
    expect(reply).toHaveValue("Keep this review draft.")
    expect(failedReads).not.toHaveBeenCalled()
    expect(screen.getByTitle("Welcome, Build 3 preview")).toBeInTheDocument()
    server.resetHandlers()
    const normal = new URLSearchParams(router.state.location.search)
    normal.delete("mockScenario")
    await router.settle(() =>
      router.navigate(`${router.state.location.pathname}?${normal.toString()}`),
    )
    expect(screen.getByRole("dialog", { name: "Conversation" })).toBe(conversation)
    expect(reply).toHaveValue("Keep this review draft.")
    await router.settle(() =>
      fireEvent.click(within(conversation).getByRole("button", { name: "Reply" })),
    )
    expect(await within(conversation).findByText("Keep this review draft.")).toBeInTheDocument()
    await waitFor(() => expect(reply).toHaveValue(""))
  }, 10_000)

  it("reports invalid review data and loads real comments after an explicit retry", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/repositories/2001/prototypes/1/review-comments`, () =>
        HttpResponse.json({
          comments: [{ id: 1, body: "A malformed comment must not become an empty review." }],
          hasMore: false,
          nextCursor: null,
        }),
      ),
    )
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 0/ }))
    const sidebar = screen.getByRole("complementary", { name: "Comments" })

    expect(await within(sidebar).findByRole("alert")).toHaveTextContent(/could not be loaded/i)
    expect(within(sidebar).queryByText("No comments have been added.")).not.toBeInTheDocument()
    server.resetHandlers()
    await router.settle(() =>
      fireEvent.click(within(sidebar).getByRole("button", { name: "Retry" })),
    )
    expect(
      await within(sidebar).findByRole("button", {
        name: /Could we make the welcome heading clearer\?/,
      }),
    ).toBeInTheDocument()
    expect(within(sidebar).queryByRole("alert")).not.toBeInTheDocument()
  })

  it("allows the reader to inspect the conversation but rejects review changes", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("reader")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
    await router.settle(() =>
      fireEvent.click(
        screen.getByRole("button", { name: /Could we make the welcome heading clearer\?/ }),
      ),
    )
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })

    expect(within(conversation).getByText("I will try a shorter heading.")).toBeVisible()
    expect(within(conversation).getByRole("button", { name: "Resolve" })).toBeDisabled()
    expect(within(conversation).queryByRole("textbox", { name: "Reply" })).not.toBeInTheDocument()
    for (const reaction of within(conversation).getAllByRole("button", { name: "Add reaction" })) {
      expect(reaction).toBeDisabled()
    }
    const response = await fetch(
      `${store.origin}/api/repositories/2001/prototypes/1/review-comments/1/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review_comment: { body: "Reader must not save a reply." } }),
      },
    )
    expect(response.status).toBe(403)
    expect(store.review.list(2001, 1).comments).toHaveLength(2)
  })

  it("restores shared review filters through back navigation without discarding the open reply draft", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const reviewReads = vi.spyOn(store.review, "list")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(
      server,
      "/repositories/2001/prototypes/1?build=3&comment=1&commentSearch=welcome&commentResolved=1",
    )
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    expect(within(conversation).getByText("I will try a shorter heading.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Comments, 1/ }))
    const sidebar = screen.getByRole("complementary", { name: "Comments" })
    const search = within(sidebar).getByRole("searchbox", { name: "Search comments" })
    expect(search).toHaveValue("welcome")
    fireEvent.click(within(sidebar).getByRole("button", { name: "Filters" }))
    expect(within(sidebar).getByRole("switch", { name: "Show resolved" })).toBeChecked()
    await waitFor(() =>
      expect(
        within(sidebar).getByRole("button", {
          name: /Could we make the welcome heading clearer\?/,
        }),
      ).not.toHaveAccessibleName(/Unread/),
    )
    const readsBeforeFiltering = reviewReads.mock.calls.length
    fireEvent.change(within(conversation).getByRole("textbox", { name: "Reply" }), {
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

    await waitFor(() => expect(search).toHaveValue("welcome"))
    expect(within(sidebar).getByRole("switch", { name: "Show resolved" })).toBeChecked()
    expect(
      within(sidebar).getByRole("button", {
        name: /Could we make the welcome heading clearer\?/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "Conversation" })).toBe(conversation)
    expect(within(conversation).getByRole("textbox", { name: "Reply" })).toHaveValue(
      "Keep this draft while navigating review filters.",
    )
    expect(new URLSearchParams(router.state.location.search).get("build")).toBe("3")
    expect(new URLSearchParams(router.state.location.search).get("comment")).toBe("1")
    expect(reviewReads).toHaveBeenCalledTimes(readsBeforeFiltering)
  })

  it("cancels a delayed reply on a profile change before it can change the next session's records", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const replyStarted = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (request.method === "POST" && new URL(request.url).pathname.endsWith("/1/replies")) {
        replyStarted()
      }
    })
    const commitReply = vi.spyOn(store.review, "reply")
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }, { timeout: 5000 }))
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /Could we make the welcome heading clearer\?/ },
        { timeout: 5000 },
      ),
    )
    const conversation = await screen.findByRole("dialog", { name: "Conversation" })
    await waitFor(
      () =>
        expect(
          within(screen.getByRole("complementary", { name: "Comments" })).getByRole("button", {
            name: /Could we make the welcome heading clearer\?/,
          }),
        ).not.toHaveAccessibleName(/Unread/),
      { timeout: 5000 },
    )
    let replySignal: AbortSignal | undefined
    const nativeFetch = globalThis.fetch
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (init?.method === "POST" && url.endsWith("/1/replies")) {
        replySignal = init.signal ?? undefined
        const headers = new Headers(init.headers)
        headers.set("X-Replica-Mock-Scenario", "loading")
        return nativeFetch(input, { ...init, headers })
      }
      return nativeFetch(input, init)
    })
    fireEvent.change(within(conversation).getByRole("textbox", { name: "Reply" }), {
      target: { value: "This abandoned reply must never be saved." },
    })
    fireEvent.click(within(conversation).getByRole("button", { name: "Reply" }))
    await waitFor(() => expect(replyStarted).toHaveBeenCalledOnce())

    const profileForm = new FormData()
    profileForm.set("profile", "admin")
    await act(async () =>
      router.fetch("session-change", "root", "/session", {
        formMethod: "post",
        formData: profileForm,
      }),
    )
    expect(
      within(await screen.findByRole("region", { name: "Prototypes" })).getByRole("link", {
        name: "Welcome",
      }),
    ).toBeInTheDocument()
    await waitFor(() => expect(replySignal?.aborted).toBe(true))
    expect(store.session.read().profile).toBe("admin")
    expect(conversation).not.toBeInTheDocument()
    await new Promise((resolve) => window.setTimeout(resolve, 1600))
    expect(commitReply).not.toHaveBeenCalled()
    expect(store.review.list(2001, 1).comments).toHaveLength(2)
  }, 15_000)
})
