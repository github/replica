import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createMemoryHistory } from "@tanstack/history"
import { RouterProvider } from "@tanstack/react-router"
import { afterEach, describe, expect, it } from "vitest"

import { createAppRouter } from "./router"
import { notFoundPageConfig } from "./not-found-page"
import styles from "./not-found-page/styles.module.css"

const defaultFeedbackUrl = notFoundPageConfig.feedbackUrl

describe("createAppRouter()", () => {
  afterEach(() => {
    cleanup()
    notFoundPageConfig.feedbackUrl = defaultFeedbackUrl
  })

  it("renders the start page and navigates to the sub-page", async () => {
    const router = createAppRouter()
    render(<RouterProvider router={router} />)

    await router.navigate({ to: "/" })
    expect(await screen.findByRole("heading", { name: "Replica Starter" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("link", { name: "Go to the about page" }))
    expect(await screen.findByRole("heading", { name: "About" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("link", { name: "Back to start page" }))
    expect(await screen.findByRole("heading", { name: "Replica Starter" })).toBeInTheDocument()
  })

  it("loads the scaffolded activity route from seed data", async () => {
    const router = createAppRouter()
    render(<RouterProvider router={router} />)

    await router.navigate({ to: "/activity" })

    expect(await screen.findByRole("heading", { name: "Activity" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "First prototype item" })).toBeInTheDocument()
    expect(screen.getByText("1 total")).toBeInTheDocument()
  })

  it("opens a native section fragment on the start page instead of the missing-page fallback", async () => {
    window.history.replaceState({}, "", "/#contents")
    const router = createAppRouter()
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole("heading", { name: "Replica Starter" })).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "This page isn't built in the prototype yet" }),
    ).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/")
    expect(router.state.location.hash).toBe("contents")
    expect(window.location.hash).toBe("#contents")
    router.history.destroy()
    window.history.replaceState({}, "", "/")
  })

  it.each(["/missing", "/about/missing", "/activity/missing"])(
    "renders the fallback for a direct visit to %s without a feedback URL",
    async (path) => {
      notFoundPageConfig.feedbackUrl = ""
      const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
      render(<RouterProvider router={router} />)

      expect(
        await screen.findByRole("heading", { name: "This page isn't built in the prototype yet" }),
      ).toBeInTheDocument()
      expect(screen.queryByRole("link", { name: /Give feedback/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/Tell us what you were looking for/)).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Back" })).toHaveClass(styles.primary)
      expect(screen.getByRole("link", { name: "Go to start" })).not.toHaveClass(styles.primary)
      expect(screen.getAllByRole("button")).toHaveLength(1)
      expect(screen.getAllByRole("link")).toHaveLength(1)

      fireEvent.click(screen.getByRole("link", { name: "Go to start" }))
      expect(await screen.findByRole("heading", { name: "Replica Starter" })).toBeInTheDocument()
    },
  )

  it.each([
    "https://example.slack.com/archives/feedback",
    "https://github.com/example/prototypes/issues/new",
  ])("uses the repository feedback URL %s", async (feedbackUrl) => {
    notFoundPageConfig.feedbackUrl = feedbackUrl
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/missing"] }))
    render(<RouterProvider router={router} />)

    const link = await screen.findByRole("link", { name: /Give feedback/ })
    expect(link).toHaveAttribute("href", feedbackUrl)
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
    expect(link).toHaveClass(styles.primary)
    expect(screen.getByRole("button", { name: "Back" })).not.toHaveClass(styles.primary)
    expect(screen.queryByRole("link", { name: "Go to start" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByText(/Tell us what you were looking for/)).toBeInTheDocument()
  })

  it.each(["", defaultFeedbackUrl])(
    'returns to the previous page with feedback URL "%s"',
    async (feedbackUrl) => {
      notFoundPageConfig.feedbackUrl = feedbackUrl
      const router = createAppRouter(createMemoryHistory({ initialEntries: ["/about"] }))
      render(<RouterProvider router={router} />)
      await screen.findByRole("heading", { name: "About" })

      await act(async () => {
        await router.navigate({ href: "/missing" })
      })
      await screen.findByRole("heading", { name: "This page isn't built in the prototype yet" })

      fireEvent.click(screen.getByRole("button", { name: "Back" }))
      expect(await screen.findByRole("heading", { name: "About" })).toBeInTheDocument()
    },
  )
})
