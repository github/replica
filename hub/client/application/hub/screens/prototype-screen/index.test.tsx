import { fireEvent, render, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { createMemoryRouter, RouterProvider } from "react-router"
import { expect, it, onTestFinished, vi } from "vitest"

import { createMockStore } from "@application/hub/mocks/create-mock-store"
import { createReviewHandlers } from "@application/hub/mocks/create-review-handlers"
import { HubThemeProvider } from "@hooks/use-hub-theme"

import { PrototypeScreen } from "."

it("sends the typed mention login to the review candidates API", async () => {
  const store = createMockStore({ origin: window.location.origin })
  const workspace = store.getWorkspace()
  const data = store.getPrototype("2001", "1", undefined, true)
  const repository = workspace.repositories.find(({ id }) => id === data.repository.id)!
  repository.capabilities = { reviewPrototypes: true, manageSharing: false }
  const path = `/repositories/${data.repository.id}/prototypes/${data.prototype.id}`
  const server = setupServer(
    http.get(`${store.origin}/api${path}/review-comments/mention-candidates`, ({ request }) =>
      HttpResponse.json({
        candidates:
          new URL(request.url).searchParams.get("q") === "mon"
            ? [{ githubId: 501, login: "mona", avatarUrl: null }]
            : [],
      }),
    ),
    ...createReviewHandlers(store.review, store.origin, store.session),
  )
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
  const router = createMemoryRouter(
    [
      {
        path,
        element: (
          <PrototypeScreen
            workspace={workspace}
            data={data}
            onSaveDetails={vi.fn()}
            savingDetails={false}
            detailsError={null}
            detailsSaved={false}
          />
        ),
      },
    ],
    { initialEntries: [path] },
  )
  onTestFinished(() => router.dispose())
  render(<RouterProvider router={router} />, { wrapper: HubThemeProvider })

  fireEvent.click(await screen.findByRole("button", { name: /^Comments, 1/ }))
  fireEvent.click(await screen.findByRole("button", { name: /welcome heading clearer/ }))
  const conversation = await screen.findByRole("dialog", { name: "Conversation" })
  const reply = within(conversation).getByRole("textbox", { name: "Reply" })
  fireEvent.change(reply, { target: { value: "Please review @mon" } })
  expect(await screen.findByRole("option", { name: "@mona" })).toBeVisible()
})
