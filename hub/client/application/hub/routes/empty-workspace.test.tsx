import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub empty workspace", () => {
  it.each([
    { profile: "owner", entry: "/" },
    { profile: "admin", entry: "/repositories" },
  ] as const)(
    "keeps account access and permitted Hub navigation for a repository-free $profile on both entry points",
    async ({ profile, entry: initialEntry }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select(profile)
      const server = setupServer(...createMockHandlers(store))
      server.use(
        http.get(`${store.origin}/api/workspace`, () =>
          HttpResponse.json({ ...store.getWorkspace(), repositories: [] }),
        ),
      )
      const router = await renderHubFlow(server, initialEntry)

      for (const entry of [initialEntry, initialEntry === "/" ? "/repositories" : "/"]) {
        if (router.state.location.pathname !== entry) {
          await router.settle(() => router.navigate(entry))
        }

        expect(router.state.location.pathname).toBe(entry)
        expect(screen.getByRole("heading", { name: "No repositories available" })).toBeVisible()
        expect(screen.getByRole("navigation", { name: "Hub navigation" })).toBeVisible()
        expect(screen.queryByRole("button", { name: /^Choose repository/ })).not.toBeInTheDocument()
        expect(screen.queryByRole("link", { name: /^Create/ })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /^Create/ })).not.toBeInTheDocument()

        if (profile === "admin") {
          const settings = screen.getByRole("navigation", { name: "Security and settings" })
          expect(settings).toBeVisible()
          const destinations = [
            ["Hub administrators", "/settings/admins"],
            ["Public sharing", "/settings/sharing"],
            ["End all Hub sessions", "/settings/sessions"],
            ["GitHub App", "/settings/github"],
            ["Copilot connection", "/settings/copilot"],
            ["Security audit", "/settings/audit?scope=hub"],
          ]
          for (const [label, href] of destinations) {
            expect(within(settings).getByRole("link", { name: label })).toHaveAttribute(
              "href",
              href,
            )
          }
        } else {
          expect(
            screen.queryByRole("navigation", { name: "Security and settings" }),
          ).not.toBeInTheDocument()
        }

        const account = screen.getByRole("button", { name: "Account menu for @octocat" })
        fireEvent.click(account)
        expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible()
        fireEvent.click(account)
      }

      fireEvent.click(screen.getByRole("button", { name: "Account menu for @octocat" }))
      await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })))
      expect(store.session.read().viewer).toBeNull()
      expect(router.state.location.pathname).toBe("/sign-in")
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible(),
      )
    },
    15_000,
  )

  it("preserves sign-in and first-repository redirects on both entry points", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("signed-out")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/")

    for (const entry of ["/", "/repositories"]) {
      await router.settle(() => router.navigate(entry))
      expect(router.state.location.pathname).toBe("/sign-in")
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible(),
      )
    }

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" })),
    )

    const firstRepository = store.getWorkspace().repositories[0]
    if (!firstRepository) throw new Error("The redirect case needs an accessible repository.")
    for (const entry of ["/", "/repositories"]) {
      await router.settle(() => router.navigate(entry))
      expect(router.state.location.pathname).toBe(`/repositories/${firstRepository.id}`)
      await waitFor(() => expect(screen.getByRole("region", { name: "Prototypes" })).toBeVisible())
    }
  }, 15_000)
})
