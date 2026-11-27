import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { previewRecords } from "./fixtures/preview-records"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function UnconnectedPreferences({ galleryPath }: { galleryPath: string }) {
  return (
    <main>
      <h1>Account preferences</h1>
      <form method="post" action="/unconnected-preferences">
        <label>
          Display name
          <input name="display_name" />
        </label>
        <button type="submit">Save preferences</button>
      </form>
      <a href={galleryPath}>Return to repository</a>
    </main>
  )
}

describe("Hub unavailable actions", () => {
  it("allows only the new-tab private Build launch to submit natively", async () => {
    const { repository } = previewRecords()
    const server = stubHubFetch(...authenticatedWorkspace([repository]))
    await renderHubFlow(server, "/private-launch", {
      workspaceRoutes: [
        {
          path: "/private-launch",
          element: (
            <form method="post" action="/api/private-preview/launch/901/1201" target="_blank">
              <button type="submit">Open private preview</button>
            </form>
          ),
        },
      ],
    })
    const form = screen.getByRole("button", { name: "Open private preview" }).closest("form")!

    expect(fireEvent.submit(form)).toBe(true)

    form.target = ""
    expect(fireEvent.submit(form)).toBe(false)
    form.target = "_blank"
    form.action = `${form.action}/return`
    expect(fireEvent.submit(form)).toBe(false)
    expect(await screen.findByRole("alert")).toBeVisible()
  })

  it("shows a dismissible failure for an unconnected native form without development tools or a mutation request", async () => {
    const { repository, galleryPath } = previewRecords()
    const server = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      http.get(`/api${galleryPath}`, () =>
        Response.json({
          repository,
          prototypes: [],
          authors: [],
          pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 0 },
        }),
      ),
    )
    const router = await renderHubFlow(server, "/unconnected-preferences", {
      workspaceRoutes: [
        {
          path: "/unconnected-preferences",
          element: <UnconnectedPreferences galleryPath={galleryPath} />,
        },
      ],
    })
    const name = screen.getByRole("textbox", { name: "Display name" })
    fireEvent.change(name, { target: { value: "Keep my preferences draft" } })

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save preferences" })),
    )

    expect(server.requests.filter(({ method }) => method !== "GET")).toEqual([])
    const failure = await screen.findByRole("alert")
    expect(failure).toBeVisible()
    expect(failure).not.toBeEmptyDOMElement()
    expect(failure).not.toHaveTextContent(/not connected|no request was sent/i)
    expect(name).toHaveValue("Keep my preferences draft")

    fireEvent.click(within(failure).getByRole("button", { name: /dismiss|close/i }))

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save preferences" })),
    )
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(server.requests.filter(({ method }) => method !== "GET")).toEqual([])

    await router.settle(() =>
      fireEvent.click(screen.getByRole("link", { name: "Return to repository" })),
    )
    expect(screen.getByRole("region", { name: "Prototypes" })).toBeVisible()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps setup locked after a rejected bootstrap secret without echoing it", async () => {
    const acceptedSecret = "synthetic-accepted-secret"
    const server = stubHubFetch(
      http.get("/api/settings/github/status", ({ request }) =>
        request.headers.get("x-hub-bootstrap-secret") === acceptedSecret
          ? Response.json({
              status: "not_configured",
              signInEnabled: false,
              settings: [],
              urls: {
                homepage: window.location.origin,
                callback: `${window.location.origin}/api/auth/github/callback`,
                setup: `${window.location.origin}/settings/github/setup?step=install`,
                webhook: `${window.location.origin}/api/github/webhooks`,
              },
              connectedRepositories: [],
            })
          : Response.json(
              { error: "Bootstrap access is required.", requires: "bootstrap" },
              { status: 403 },
            ),
      ),
    )
    await renderHubFlow(server, "/settings/github/setup")
    const secret = screen.getByLabelText(/Bootstrap secret/)
    fireEvent.change(secret, { target: { value: "synthetic-wrong-secret-for-test" } })

    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    const failure = await screen.findByRole("alert")
    expect(failure).toHaveTextContent("The bootstrap secret is incorrect.")
    expect(failure).not.toHaveTextContent("synthetic-wrong-secret-for-test")
    expect(secret).toHaveValue("synthetic-wrong-secret-for-test")
    expect(server.requests.filter(({ method }) => method !== "GET")).toEqual([])

    fireEvent.change(secret, { target: { value: acceptedSecret } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByRole("heading", { name: "1. Register the GitHub App" })).toBeVisible()
  })
})
