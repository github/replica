import { NavigationContext } from "@thoughtbot/superglue"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, it, vi } from "vitest"

import { PrototypeWorkspaceHeader } from "@features/prototype-workspace-header"
import headerStory from "@features/prototype-workspace-header/stories"
import { HubThemeProvider } from "@hooks/use-hub-theme"
import { useControlQuery } from "@hooks/use-prototype-control-query"

import { BuildsIndexPage } from "./index"
import story from "./stories"
import type { BuildsIndexPageData } from "./types"

const PAGE_DATA: BuildsIndexPageData = {
  ...story.args.data,
  closePath: "/repositories/2001/prototypes/1?build=2",
  branchPath: "/repositories/2001/prototypes/1?build=2",
  builds: [
    {
      author: {
        avatarUrl: "https://avatars.example.test/octocat",
        label: "By @octocat",
        url: "https://github.com/octocat",
      },
      commitLabel: "Commit aaaaaaa",
      commitSha: "a".repeat(40),
      createdAt: "2026-09-11T12:00:00Z",
      createdLabel: "Added to Hub September 11, 2026",
      number: 2,
      numberLabel: "build 2",
      path: "/repositories/2001/prototypes/1/builds/2",
      shortCommitSha: "aaaaaaa",
      state: "successful",
      stateLabel: "Successful",
    },
  ],
  buildOptions: [
    {
      number: 2,
      label: "v2",
      path: "/repositories/2001/prototypes/1?build=2",
      state: "successful",
    },
  ],
  nextPageLabel: "Older builds",
  nextPagePath:
    "/repositories/2001/prototypes/1/builds?before=2&before_at=2026-09-11T12%3A00%3A00.000000Z",
  selectedBuild: {
    detailsLabel: "Build details",
    detailsPath: "/repositories/2001/prototypes/1/builds/2",
    number: 2,
  },
}

describe("BuildsIndexPage()", () => {
  it("copies fixed preview links only for successful Builds in history", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const successful = PAGE_DATA.builds[0]!
    render(
      <BuildsIndexPage
        controlQuery="rc.shared.state=empty"
        data={{
          ...PAGE_DATA,
          builds: [
            {
              ...successful,
              number: 4,
              numberLabel: "build 4",
              state: "running",
              stateLabel: "Running",
            },
            {
              ...successful,
              number: 3,
              numberLabel: "build 3",
              state: "failed",
              stateLabel: "Failed",
            },
            successful,
            { ...successful, number: 1, numberLabel: "build 1" },
          ],
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    const history = screen.getByRole("list", { name: PAGE_DATA.buildsHeading })
    expect(within(history).getAllByRole("button", { name: /^Copy link to Build / })).toHaveLength(2)
    expect(within(history).queryByRole("textbox")).not.toBeInTheDocument()
    expect(
      within(history).queryByRole("button", { name: "Copy link to Build 3" }),
    ).not.toBeInTheDocument()
    expect(
      within(history).queryByRole("button", { name: "Copy link to Build 4" }),
    ).not.toBeInTheDocument()
    for (const number of [2, 1]) {
      const expected = new URL(PAGE_DATA.branchPath, window.location.href)
      expected.searchParams.set("build", String(number))
      expected.searchParams.set("rc.shared.state", '"empty"')
      expected.searchParams.set("view", "minimized")
      const copy = within(history).getByRole("button", { name: `Copy link to Build ${number}` })
      expect(copy).toHaveTextContent("")
      fireEvent.click(copy)
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expected.toString()))
      expect(
        await within(history).findByRole("button", { name: `Link to Build ${number} copied` }),
      ).toBeInTheDocument()
    }
    expect(within(history).queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("offers the numbered Build link when clipboard copying fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard unavailable"))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    render(<BuildsIndexPage data={PAGE_DATA} />, { wrapper: HubThemeProvider })

    fireEvent.click(screen.getByRole("button", { name: "Copy link to Build 2" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/could not copy/i)
    expect(within(alert).getByRole("link")).toHaveAttribute(
      "href",
      new URL(
        "/repositories/2001/prototypes/1?build=2&view=minimized",
        window.location.href,
      ).toString(),
    )
    expect(screen.queryByRole("button", { name: "Link to Build 2 copied" })).not.toBeInTheDocument()
  })

  it("uses the supplied non-fullscreen preference for a numbered Build link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    render(<BuildsIndexPage data={PAGE_DATA} fullScreenPreview={false} />, {
      wrapper: HubThemeProvider,
    })

    fireEvent.click(screen.getByRole("button", { name: "Copy link to Build 2" }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        new URL("/repositories/2001/prototypes/1?build=2", window.location.href).toString(),
      ),
    )
  })

  it("shows build history in the repository review workspace", () => {
    const { container } = render(<BuildsIndexPage data={PAGE_DATA} />, {
      wrapper: HubThemeProvider,
    })

    expect(container.querySelector(".repository-workspace")).toBeInTheDocument()
    expect(container.querySelector(".build-history__breadcrumbs")).not.toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Repository navigation" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "prototype/welcome", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "prototype/welcome" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1?build=2",
    )
    expect(
      screen.getByRole("heading", { name: "History", level: 2 }).closest("header"),
    ).toHaveClass("hub-content-page-header")
    expect(screen.getByRole("button", { name: "Choose build, v2" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1?build=2",
    )
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Open in new tab" })).not.toBeInTheDocument()
  })

  it("links exact builds and pagination through soft navigation", () => {
    render(<BuildsIndexPage data={PAGE_DATA} />, { wrapper: HubThemeProvider })

    expect(screen.getByRole("link", { name: /build 2/ })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1/builds/2",
    )
    expect(screen.getByRole("link", { name: /build 2/ })).toHaveAttribute("data-sg-visit", "true")
    expect(screen.getByText("Successful")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: "By @octocat" })[0]).toHaveAttribute(
      "href",
      "https://github.com/octocat",
    )
    expect(screen.getByText("Added to Hub September 11, 2026").closest("time")).toHaveAttribute(
      "datetime",
      "2026-09-11T12:00:00Z",
    )
    expect(screen.getByRole("link", { name: "Older builds" })).toHaveAttribute(
      "href",
      PAGE_DATA.nextPagePath,
    )
    expect(screen.getByRole("link", { name: "Older builds" })).toHaveAttribute(
      "data-sg-visit",
      "true",
    )
  })

  it("preserves option settings on both History pagination links", () => {
    render(
      <BuildsIndexPage
        data={{
          ...PAGE_DATA,
          newestPageLabel: "Newest builds",
          newestPagePath: "/repositories/2001/prototypes/1/builds",
        }}
        controlQuery="rc.page.title=%22Shared%22"
      />,
      { wrapper: HubThemeProvider },
    )
    const newest = new URL(
      screen.getByRole("link", { name: "Newest builds" }).getAttribute("href")!,
      window.location.href,
    )
    const older = new URL(
      screen.getByRole("link", { name: "Older builds" }).getAttribute("href")!,
      window.location.href,
    )
    expect(newest.searchParams.get("rc.page.title")).toBe('"Shared"')
    expect(older.searchParams.get("rc.page.title")).toBe('"Shared"')
    expect(older.searchParams.get("before")).toBe("2")
    expect(older.searchParams.get("before_at")).toBe("2026-09-11T12:00:00.000000Z")
  })

  it("keeps preview options through History pagination and copying a Build", async () => {
    const original = window.location.href
    try {
      window.history.replaceState({}, "", "/preview?rc.shared.state=%22empty%22")
      const visit = vi.fn()
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal("navigator", { clipboard: { writeText } })
      const header = render(
        <HubThemeProvider>
          <NavigationContext.Provider
            value={{ pageKey: "/", search: {}, navigateTo: vi.fn(), remote: vi.fn(), visit }}
          >
            <PrototypeWorkspaceHeader {...headerStory.args} />
          </NavigationContext.Provider>
        </HubThemeProvider>,
      )
      fireEvent.click(screen.getByRole("button", { name: "More actions" }))
      fireEvent.click(screen.getByRole("menuitem", { name: "History" }))
      const historyPath: unknown = visit.mock.calls[0]?.[0]
      if (typeof historyPath !== "string") throw new Error("History navigation did not occur.")
      header.unmount()
      window.history.pushState({}, "", historyPath)

      function HistoryPage() {
        const controls = useControlQuery()
        return (
          <BuildsIndexPage
            data={PAGE_DATA}
            controlQuery={controls.query}
            fullScreenPreview={false}
          />
        )
      }
      const firstPage = render(<HistoryPage />, { wrapper: HubThemeProvider })
      const olderPath = screen.getByRole("link", { name: "Older builds" }).getAttribute("href")!
      firstPage.unmount()
      window.history.pushState({}, "", olderPath)
      render(<HistoryPage />, { wrapper: HubThemeProvider })
      fireEvent.click(screen.getByRole("button", { name: "Copy link to Build 2" }))
      const expected = new URL("/repositories/2001/prototypes/1?build=2", window.location.href)
      expected.searchParams.set("rc.shared.state", '"empty"')
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(expected.href))
    } finally {
      window.history.replaceState({}, "", original)
      vi.unstubAllGlobals()
    }
  })

  it("keeps an unlinked author and avatar aligned in the history", () => {
    const { container } = render(
      <BuildsIndexPage
        data={{
          ...PAGE_DATA,
          builds: [
            {
              ...PAGE_DATA.builds[0]!,
              author: { avatarUrl: "/local-developer-avatar.svg", label: "By @local", url: null },
            },
          ],
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    const author = container.querySelector(".build-history__author")
    expect(author).toHaveTextContent("By @local")
    expect(author).toHaveClass("build-history__state")
    expect(author?.querySelector("img")).toHaveAttribute("src", "/local-developer-avatar.svg")
  })

  it("shows empty history without offering a build selection", () => {
    render(
      <BuildsIndexPage
        data={{
          ...PAGE_DATA,
          buildOptions: [],
          builds: [],
          closePath: "/repositories/2001/prototypes/1",
          selectedBuild: undefined,
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    expect(screen.getByText(story.args.data.emptyLabel)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Choose build/ })).not.toBeInTheDocument()
  })
})
