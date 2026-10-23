import { render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { BuildsIndexPage } from "."
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
