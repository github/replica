import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PrototypeEdit, PrototypeRecord } from "@application/hub/contracts/types"
import type { ProductShareLink } from "@application/hub/product-contracts/types"
import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { previewHandlers } from "./fixtures/preview-handlers"
import { previewRecords } from "./fixtures/preview-records"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub listing management", () => {
  it("keeps an invalid listing draft and updates the existing preview and gallery on retry", async () => {
    const data = previewRecords()
    const { prototype, repository, galleryPath, path, latest } = data
    repository.capabilities!.managePrototypeListings = true
    const managementPath = `${galleryPath}/prototypes/manage`
    const readManagement = vi.fn(() =>
      Response.json({ repository, registered: [prototype], candidates: [], canManage: true }),
    )
    const save = vi.fn()
    const api = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      ...previewHandlers(data),
      http.get(`/api${galleryPath}`, () =>
        Response.json({
          repository,
          prototypes: [prototype],
          authors: [],
          pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 1 },
        }),
      ),
      http.get(`/api${galleryPath}/prototype-management`, readManagement),
      http.patch(`/api${galleryPath}/prototype-management/${prototype.id}`, async ({ request }) => {
        const updates = (await request.json()) as PrototypeEdit
        save(updates)
        Object.assign(prototype, updates)
        return Response.json({ repository, prototype, selectedBuild: latest })
      }),
    )
    const router = await renderHubFlow(api, galleryPath)
    const manage = screen.getByRole("link", { name: "Edit prototype listings" })
    expect(manage).toHaveAttribute("href", managementPath)
    await router.settle(() => fireEvent.click(manage))
    expect(router.state.location.pathname).toBe(managementPath)

    fireEvent.click(screen.getByRole("button", { name: `Edit details: ${prototype.branchName}` }))
    const editor = screen.getByRole("dialog", { name: "Edit prototype details" })
    const name = within(editor).getByRole("textbox", { name: "Name" })
    const description = within(editor).getByRole("textbox", { name: "Description (optional)" })
    const startPage = within(editor).getByRole("textbox", { name: "Start page (optional)" })
    const submit = within(editor).getByRole("button", { name: "Save details" })
    const draft = {
      name: "Refined onboarding",
      description: "Guide the visitor through one useful task.",
    }
    fireEvent.change(name, { target: { value: draft.name } })
    fireEvent.change(description, { target: { value: draft.description } })
    fireEvent.change(startPage, { target: { value: "//external.example.test/welcome" } })
    const readsBeforeSave = readManagement.mock.calls.length
    await router.settle(() => fireEvent.click(submit))

    expect(await within(editor).findByRole("alert")).toHaveTextContent(/local route/i)
    expect(name).toHaveValue(draft.name)
    expect(description).toHaveValue(draft.description)
    expect(startPage).toHaveValue("//external.example.test/welcome")
    expect(save).not.toHaveBeenCalled()
    expect(readManagement).toHaveBeenCalledTimes(readsBeforeSave)

    const corrected = "/welcome?step=2#heading"
    fireEvent.change(startPage, { target: { value: corrected } })
    await router.settle(() => fireEvent.click(submit))
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...draft, startPage: corrected })
    expect(editor).not.toBeVisible()

    await router.settle(() => router.navigate(path))
    expect(screen.getByTitle(`${draft.name}, Build ${latest.number} preview`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(
      within(screen.getByRole("dialog")).getByRole("textbox", { name: "Description" }),
    ).toHaveValue(draft.description)
    await router.settle(() => router.navigate(`${galleryPath}?q=Refined`))
    expect(screen.getByRole("link", { name: draft.name })).toHaveAttribute("href", path)
  }, 15_000)
})

describe("Hub Build share links", () => {
  function linkRecord(
    prototype: Pick<PrototypeRecord, "id" | "repositoryId">,
    buildNumber: number,
    label: string,
  ): ProductShareLink {
    return {
      id: 1,
      shareId: "test-stakeholder-share",
      repositoryId: prototype.repositoryId,
      prototypeId: prototype.id,
      buildNumber,
      label,
      createdBy: "octocat",
      createdAt: "2026-11-20T12:00:00Z",
      expiresAt: "2036-11-21T12:00:00Z",
      revokedAt: null,
    }
  }

  it("creates a link only to a successful Build with a preview and opens that exact Build without a workspace", async () => {
    const data = previewRecords({ canManageSharing: true })
    const { path, repository, prototype, historical, latest } = data
    const sharePath = `${path}/share-links`
    const create = vi.fn()
    let link: ProductShareLink | undefined
    prototype.builds.push(
      { ...latest, number: 4, state: "running" },
      { ...latest, number: 5, previewUrl: null },
    )
    const api = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      http.get(`/api${sharePath}`, ({ request }) =>
        Response.json({
          resource: {
            repository,
            prototype,
            selectedBuild:
              new URL(request.url).searchParams.get("build") === "1" ? historical : latest,
          },
          links: link ? [link] : [],
          enabled: true,
          canManage: true,
          expirationOptions: ["seven_days"],
        }),
      ),
      http.post(`/api${sharePath}`, async ({ request }) => {
        const input = (await request.json()) as { label: string; buildNumber: number }
        create(input)
        link = linkRecord(prototype, input.buildNumber, input.label)
        return Response.json({ notice: "Share link created.", link }, { status: 201 })
      }),
      http.get("/api/shared/test-stakeholder-share", () =>
        Response.json({
          state: "active",
          label: link?.label,
          prototypeName: prototype.name,
          buildNumber: link?.buildNumber,
          previewUrl: historical.previewUrl,
          expiresAt: link?.expiresAt,
          controlsIdentity: "shared-build-1",
          controlsOrigin: "https://build-1.example.test",
        }),
      ),
    )
    const router = await renderHubFlow(api, `${sharePath}?build=3`)
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v3" }))
    const menu = screen.getByRole("menu", { name: "Choose build" })
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2)
    const first = within(within(menu).getByRole("menuitem", { name: /v1/i })).getByRole("link")
    expect(first).toHaveAttribute("href", `${sharePath}?build=1`)
    await router.settle(() => fireEvent.click(first))
    expect(screen.getByRole("heading", { name: "Build 1" })).toBeVisible()

    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "Stakeholder review" },
    })
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Create share link" })),
    )
    expect(create).toHaveBeenCalledExactlyOnceWith({
      label: "Stakeholder review",
      expiration: "seven_days",
      buildNumber: 1,
    })
    const row = (await screen.findByRole("heading", { name: "Stakeholder review" })).closest("li")!
    const open = within(row).getByRole<HTMLAnchorElement>("link", { name: "Open" })
    expect(open).not.toHaveAttribute("target", "_blank")
    const privateReads = vi.fn(() =>
      Response.json({ error: "Sign in to continue." }, { status: 401 }),
    )
    api.use(http.get("/api/workspace", privateReads), http.get("/api/auth/session", privateReads))

    await router.settle(() => router.navigate(new URL(open.href).pathname))

    expect(await screen.findByTitle("Welcome · Build 1")).toBeInTheDocument()
    expect(privateReads).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()
  })

  it("hides creation controls and previously created URLs when deployment sharing is disabled", async () => {
    const { path, repository, prototype, latest } = previewRecords({ canManageSharing: true })
    const api = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      http.get(`/api${path}/share-links`, () =>
        Response.json({
          resource: { repository, prototype, selectedBuild: latest },
          links: [linkRecord(prototype, 3, "Partner review")],
          enabled: false,
          canManage: true,
          expirationOptions: ["seven_days"],
        }),
      ),
    )
    await renderHubFlow(api, `${path}/share-links?build=3`)

    expect(screen.getByText(/public sharing is disabled for this Hub/i)).toBeVisible()
    expect(screen.queryByRole("textbox", { name: "Label" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Create share link" })).not.toBeInTheDocument()
    expect(screen.queryByText("Partner review")).not.toBeInTheDocument()
  })

  it.each([
    { state: "expired", heading: /link has expired/i },
    { state: "revoked", heading: /link was revoked/i },
    { state: "disabled", heading: /sharing is disabled/i },
  ])("shows an unavailable public preview for a $state share", async ({ heading, state }) => {
    const api = stubHubFetch(
      http.get(`/api/shared/test-${state}`, () =>
        Response.json({ state, label: "Shared preview" }),
      ),
    )
    await renderHubFlow(api, `/shared/test-${state}`)

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible()
    expect(document.querySelector("iframe")).not.toBeInTheDocument()
  })
})
