import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Application, NavigationContext } from "@thoughtbot/superglue"
import { useContext } from "react"
import { describe, expect, it, vi } from "vitest"

import { store } from "@application/store"
import { HubThemeProvider } from "@hooks/use-hub-theme"
import managementStory from "@pages/prototype-management-page/stories"

import ManagementView from "../../../views/prototype_management/show"
import { buildVisitAndRemote } from "."

describe("async prototype management", () => {
  it("mounts the shell and grafts independent section responses through Superglue", async () => {
    const data = managementStory.args.data
    const path = "/repositories/2001/prototypes/manage"
    const initialPage = {
      data: {
        ...data,
        sectionLoadId: "first-shell",
        liveInbox: undefined,
        notificationInbox: data.notificationInbox
          ? { ...data.notificationInbox, copy: { ...data.notificationInbox.copy } }
          : undefined,
        repository: null,
        management: {
          ...data.management,
          registered: data.management.registered.map((entry) => ({ ...entry })),
          unlisted: [],
          candidatePageCount: 0,
        },
        repositoryChoices: {
          ...data.repositoryChoices,
          repositories: data.repositoryChoices.repositories
            .slice(0, 1)
            .map((repository) => ({ ...repository })),
        },
      },
      componentIdentifier: "prototype_management/show",
      assets: [],
      defers: [],
      fragments: [],
      slices: {},
      renderedAt: 1,
      restoreStrategy: "revisitOnly" as const,
    }
    let finishBranches!: (response: Response) => void
    let finishRepositories!: (response: Response) => void
    const branches = new Promise<Response>((resolve) => {
      finishBranches = resolve
    })
    const repositories = new Promise<Response>((resolve) => {
      finishRepositories = resolve
    })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      return url.includes("props_at=data.management") ? branches : repositories
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    render(
      <HubThemeProvider>
        <Application
          baseUrl="http://localhost"
          initialPage={initialPage}
          path={path}
          buildVisitAndRemote={buildVisitAndRemote}
          store={store}
          mapping={{ "prototype_management/show": ManagementView }}
        />
      </HubThemeProvider>,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(data.management.candidateLoadingLabel)).toBeVisible()
    expect(screen.getByRole("button", { name: "Edit details: prototype/welcome" })).toBeEnabled()
    expect(screen.queryByText(data.management.emptyLabel)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Edit details: prototype/welcome" }))
    const dialog = screen.getByRole("dialog", { name: data.management.editDialogHeading })
    const name = within(dialog).getByRole("textbox", { name: data.management.nameLabel })
    fireEvent.change(name, { target: { value: "Unsaved prototype name" } })

    const repositoryResponse = Response.json({
      ...initialPage,
      action: "graft",
      path: "data.repositoryChoices",
      data: data.repositoryChoices,
    })
    Object.defineProperty(repositoryResponse, "url", {
      value: `http://localhost${path}?props_at=data.repositoryChoices`,
    })
    await act(async () => {
      finishRepositories(repositoryResponse)
      await repositories
    })
    await waitFor(() =>
      expect(screen.queryByText(data.repositoryChoices.loadingLabel)).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole("button", { name: data.repositorySelectorLabel }))
    expect(screen.getByRole("link", { name: "github/empty" })).toBeInTheDocument()
    expect(screen.getByText(data.management.candidateLoadingLabel)).toBeVisible()
    expect(name).toHaveValue("Unsaved prototype name")

    const branchResponse = Response.json({
      ...initialPage,
      action: "graft",
      path: "data.management",
      data: data.management,
    })
    Object.defineProperty(branchResponse, "url", {
      value: `http://localhost${path}?props_at=data.management`,
    })
    await act(async () => {
      finishBranches(branchResponse)
      await branches
    })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to Hub: prototype/new" })).toBeEnabled(),
    )
    expect(screen.queryByText(data.management.candidateLoadingLabel)).not.toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: data.management.editDialogHeading })).toBe(dialog)
    expect(name).toHaveValue("Unsaved prototype name")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reloads both sections once after a full visit replaces the shell at the same URL", async () => {
    const data = structuredClone(managementStory.args.data)
    const path = "/repositories/2001/prototypes/manage"
    const shell = {
      data: {
        ...data,
        sectionLoadId: "before-refresh",
        liveInbox: undefined,
        notificationInbox: data.notificationInbox
          ? { ...data.notificationInbox, copy: { ...data.notificationInbox.copy } }
          : undefined,
        repository: null,
        management: {
          ...data.management,
          registered: data.management.registered.map((entry) => ({ ...entry })),
          unlisted: [],
          candidatePageCount: 0,
        },
        repositoryChoices: {
          ...data.repositoryChoices,
          repositories: data.repositoryChoices.repositories
            .slice(0, 1)
            .map((repository) => ({ ...repository })),
        },
      },
      componentIdentifier: "prototype_management/show",
      assets: [],
      defers: [],
      fragments: [],
      slices: {},
      renderedAt: 1,
      restoreStrategy: "revisitOnly" as const,
    }
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://localhost",
      )
      const section = url.searchParams.get("props_at")
      const payload = section
        ? {
            ...shell,
            action: "graft",
            path: section,
            data: section === "data.management" ? data.management : data.repositoryChoices,
          }
        : { ...shell, data: { ...shell.data, sectionLoadId: "after-refresh" } }
      const response = Response.json(payload)
      Object.defineProperty(response, "url", { value: url.href })
      return Promise.resolve(response)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    function RefreshableManagement() {
      const { visit } = useContext(NavigationContext)
      return (
        <>
          <button onClick={() => void visit(path, {})}>Refresh management</button>
          <ManagementView />
        </>
      )
    }
    render(
      <HubThemeProvider>
        <Application
          baseUrl="http://localhost"
          initialPage={shell}
          path={path}
          buildVisitAndRemote={buildVisitAndRemote}
          store={store}
          mapping={{ "prototype_management/show": RefreshableManagement }}
        />
      </HubThemeProvider>,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to Hub: prototype/new" })).toBeEnabled(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole("button", { name: "Refresh management" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to Hub: prototype/new" })).toBeEnabled(),
    )
    expect(screen.queryByText(data.management.emptyLabel)).not.toBeInTheDocument()
    const requests = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    )
    expect(requests.filter((url) => url.includes("props_at=data.management"))).toHaveLength(2)
    expect(requests.filter((url) => url.includes("props_at=data.repositoryChoices"))).toHaveLength(
      2,
    )
    expect(requests.filter((url) => !url.includes("props_at="))).toHaveLength(1)
  })
})
