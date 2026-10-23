import { fireEvent, render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { BuildsShowPage } from "./index"
import story from "./stories"
import type { BuildsShowPageData } from "./types"

const PAGE_DATA: BuildsShowPageData = {
  ...story.args.data,
  closePath: "/repositories/2001/prototypes/1?build=2",
  branchPath: "/repositories/2001/prototypes/1?build=2",
  commitSha: "a".repeat(40),
  createdAt: "2026-09-11T12:00:00Z",
  createdLabel: "Added to Hub September 11, 2026",
  desktopScreenshot: {
    alt: "Desktop screenshot of build 2",
    label: "Desktop",
    src: "/repositories/2001/prototypes/1/builds/2/screenshots/desktop",
  },
  failureHeading: undefined,
  failureSummary: undefined,
  finishedAt: "2026-09-11T12:02:00Z",
  finishedLabel: "Finished September 11, 2026",
  heading: "build 2",
  pageTitle: "build 2",
  publicationHeading: "Stored build output",
  previewLabel: "Review build",
  previewPath: "/repositories/2001/prototypes/1?build=2",
  retainedSizeLabel: "Storage used: 24.5 MB",
  screenshotsHeading: "Screenshots",
  startedAt: "2026-09-11T12:01:00Z",
  startedLabel: "Started September 11, 2026",
  state: "successful",
  stateLabel: "Successful",
  narrowScreenshot: {
    alt: "Narrow viewport screenshot of build 2",
    label: "Narrow viewport",
    src: "/repositories/2001/prototypes/1/builds/2/screenshots/narrow",
  },
  workflowCompletedAt: "2026-09-11T12:01:30Z",
  workflowCompletedLabel: "Workflow completed September 11, 2026",
  workflowUrl: "https://github.com/github/prototype/actions/runs/9001",
  buildOptions: [
    {
      number: 2,
      label: "v2",
      path: "/repositories/2001/prototypes/1?build=2",
      state: "successful",
    },
  ],
  selectedBuild: {
    detailsLabel: "Build details",
    detailsPath: "/repositories/2001/prototypes/1/builds/2",
    number: 2,
  },
}

describe("BuildsShowPage()", () => {
  it("shows the compact build detail inside the review workspace", () => {
    const { container } = render(<BuildsShowPage data={PAGE_DATA} />, {
      wrapper: HubThemeProvider,
    })

    expect(container.querySelector(".repository-workspace")).toBeInTheDocument()
    expect(container.querySelector(".build-detail__breadcrumbs")).not.toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Repository navigation" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "prototype/welcome", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "prototype/welcome" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1?build=2",
    )
    expect(
      screen.getByRole("heading", { name: "build 2", level: 2 }).closest("header"),
    ).toHaveClass("hub-content-page-header")
    expect(screen.getByRole("button", { name: "Choose build, v2" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    expect(screen.getByRole("menuitem", { name: "History" }).querySelector("a")).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1/builds",
    )
    expect(screen.queryByRole("link", { name: "Open in new tab" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1?build=2",
    )
  })

  it("shows exact commit, timeline, and links back to review", () => {
    render(<BuildsShowPage data={PAGE_DATA} />, { wrapper: HubThemeProvider })

    expect(screen.getByText("a".repeat(40))).toBeInTheDocument()
    expect(screen.getByText("Successful")).toBeInTheDocument()
    expect(screen.getByText("Started September 11, 2026")).toHaveAttribute(
      "datetime",
      "2026-09-11T12:01:00Z",
    )
    expect(screen.getByRole("link", { name: "View workflow run" })).toHaveAttribute(
      "href",
      "https://github.com/github/prototype/actions/runs/9001",
    )
    expect(screen.getByText("Storage used: 24.5 MB")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: "By @octocat" })[0]).toHaveAttribute(
      "href",
      "https://github.com/octocat",
    )
    expect(screen.getByRole("link", { name: "Review build" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1?build=2",
    )
    expect(screen.getByRole("img", { name: "Desktop screenshot of build 2" })).toHaveAttribute(
      "src",
      "/repositories/2001/prototypes/1/builds/2/screenshots/desktop",
    )
    expect(
      screen.getByRole("img", { name: "Narrow viewport screenshot of build 2" }),
    ).toHaveAttribute("src", "/repositories/2001/prototypes/1/builds/2/screenshots/narrow")
  })
})
