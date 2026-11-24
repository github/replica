import { fireEvent, render, screen, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { expect, it, onTestFinished, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { HubThemeProvider } from "@hooks/use-hub-theme"

import { previewRecords } from "../../routes/fixtures/preview-records"
import { reviewRecords } from "../../routes/fixtures/review-records"
import { PrototypeScreen } from "."

it("sends the typed mention login to the review candidates API", async () => {
  const data = previewRecords({ canReview: true })
  const { path, repository } = data
  const { root, reply: savedReply } = reviewRecords(path)
  const workspace: WorkspaceResponse = {
    viewer: { id: "octocat", login: "octocat", name: null, avatarUrl: null, provider: "github" },
    repositories: [repository],
  }
  stubHubFetch(
    http.get(`/api${path}/review-comments/mention-candidates`, ({ request }) =>
      Response.json({
        candidates:
          new URL(request.url).searchParams.get("q") === "mon"
            ? [{ githubId: 501, login: "mona", avatarUrl: null }]
            : [],
      }),
    ),
    http.get(`/api${path}/review-comments`, () =>
      Response.json({ comments: [root, savedReply], nextCursor: null, hasMore: false }),
    ),
  )
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
