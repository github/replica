import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, onTestFinished } from "vitest"

import { deferred } from "@/test/deferred"
import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { renderHubFlow } from "./fixtures/render-hub-flow"

const first = {
  id: "11111111-1111-4111-8111-111111111111",
  nameWithOwner: "team/alpha",
  defaultBranch: "main",
}
const second = {
  id: "22222222-2222-4222-8222-222222222222",
  nameWithOwner: "team/beta",
  defaultBranch: "main",
}
const settings = { enabled: true, canAdminister: true, activeLinkCount: 0 }

describe("Public sharing navigation", () => {
  it("carries explicit repository context into sharing and keeps the selected repository on return", async () => {
    const galleryPath = `/repositories/${second.id}`
    const api = stubHubFetch(
      ...authenticatedWorkspace([first, second], {
        administerHub: true,
        publicSharingSettingsAvailable: true,
      }),
      http.get(`/api${galleryPath}`, () =>
        Response.json({
          repository: second,
          prototypes: [],
          authors: [],
          pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 0 },
        }),
      ),
      http.get("/api/product/sharing-settings", () => Response.json(settings)),
    )
    const router = await renderHubFlow(api, galleryPath)
    const navigation = screen.getByRole("navigation", { name: "Security and settings" })
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      "Canvas connections",
      "Hub administrators",
      "Public sharing",
      "End all Hub sessions",
      "Copilot connection",
      "Security audit",
    ])
    const sharing = within(navigation).getByRole("link", { name: "Public sharing" })
    expect(sharing).toHaveAttribute("href", `/settings/sharing?repositoryId=${second.id}`)
    await router.settle(() => fireEvent.click(sharing))

    expect(sharing).toHaveAttribute("aria-current", "page")
    expect(
      screen.getByRole("button", { name: "Choose repository. team/beta selected" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute("href", galleryPath)
    await router.go(-1)
    expect(router.state.location.pathname).toBe(galleryPath)
    expect(
      screen.getByRole("button", { name: "Choose repository. team/beta selected" }),
    ).toBeVisible()
  })

  it("denies a sharing change when the settings response does not grant administrator access", async () => {
    const api = stubHubFetch(
      ...authenticatedWorkspace([first], {
        administerHub: true,
        publicSharingSettingsAvailable: true,
      }),
      http.get("/api/product/sharing-settings", () =>
        Response.json({ ...settings, canAdminister: false }),
      ),
    )
    await renderHubFlow(api, "/settings/sharing")

    expect(
      await screen.findByText(
        /Only Hub administrators can view or change deployment sharing settings/,
      ),
    ).toBeVisible()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /(?:enable|disable) public sharing/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
      "href",
      `/repositories/${first.id}`,
    )
  })

  it("keeps authorized sharing controls on a repository-free workspace", async () => {
    const api = stubHubFetch(
      ...authenticatedWorkspace([], { administerHub: true, publicSharingSettingsAvailable: true }),
      http.get("/api/product/sharing-settings", () => Response.json(settings)),
    )
    await renderHubFlow(api, "/settings/sharing")

    expect(screen.getByText("No repository selected")).toBeVisible()
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
      "href",
      "/repositories",
    )
    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Disable public sharing" })).toBeEnabled()
  })

  it("prevents overlapping deployment changes and retains canonical repository context", async () => {
    let enabled = true
    const { promise: blocked, resolve: release } = deferred()
    onTestFinished(() => release())
    const changes: unknown[] = []
    const api = stubHubFetch(
      ...authenticatedWorkspace([first, second], {
        administerHub: true,
        publicSharingSettingsAvailable: true,
      }),
      http.get("/api/product/sharing-settings", () => Response.json({ ...settings, enabled })),
      http.patch("/api/product/sharing-settings", async ({ request }) => {
        changes.push(await request.json())
        await blocked
        enabled = false
        return Response.json({ notice: "Public sharing disabled." })
      }),
    )
    const router = await renderHubFlow(api, `/settings/sharing?repositoryId=${second.id}`)
    const submit = screen.getByRole("button", { name: "Disable public sharing" })
    const target = new URL(submit.closest("form")!.action)
    expect(target.pathname).toBe("/settings/sharing")
    expect(target.searchParams.get("repositoryId")).toBe(second.id)
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand and confirm this deployment-wide change.",
      }),
    )

    fireEvent.click(submit)
    await waitFor(() => expect(changes).toEqual([{ operation: "disable", confirmed: true }]))
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    release()
    await router.settle()

    expect(changes).toHaveLength(1)
    expect(screen.getByRole("heading", { name: "Public sharing is disabled" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Enable public sharing" })).toBeEnabled()
    expect(router.state.location).toMatchObject({
      pathname: "/settings/sharing",
      search: `?repositoryId=${second.id}`,
    })
  })

  it.each(["not-a-repository", second.id])(
    "keeps Hub sharing independent of an unreadable repository hint (%s)",
    async (context) => {
      const api = stubHubFetch(
        ...authenticatedWorkspace([first], {
          administerHub: true,
          publicSharingSettingsAvailable: true,
        }),
        http.get("/api/product/sharing-settings", () => Response.json(settings)),
      )
      await renderHubFlow(api, `/settings/sharing?repositoryId=${context}`)

      expect(screen.getByRole("button", { name: "Disable public sharing" })).toBeEnabled()
      expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
        "href",
        `/repositories/${first.id}`,
      )
    },
  )
})
