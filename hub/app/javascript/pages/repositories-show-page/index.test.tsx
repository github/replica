import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, it, vi } from "vitest"

import { prototypeListing } from "@/storybook/fixtures/prototype-listing"
import type { PrototypeListingControls } from "@utils/prototype-listing/types"

import { RepositoriesShowPage as Page } from "./index"
import type { RepositoriesShowPageData } from "./types"

const PAGE_DATA: RepositoriesShowPageData = {
  listing: prototypeListing,
  accountMenuLabel: "Account menu for @octocat",
  darkThemeLabel: "Dark",
  feedbackLabel: "Feedback",
  lightThemeLabel: "Light",
  systemThemeLabel: "System",
  alert: null,
  authenticityToken: "token",
  clearSearchLabel: "Clear search",
  collapseNavigationLabel: "Collapse sidebar",
  currentUser: { avatarUrl: null, login: "octocat", name: "Octocat" },
  emptyHeading: "No prototypes yet",
  emptyLabel: "No prototypes have been added to Hub yet.",
  buildPrototypeLabel: "Build prototype",
  expandNavigationLabel: "Expand sidebar",
  galleryViewLabel: "Gallery view",
  listViewLabel: "List view",
  prototypeColumnLabel: "Prototype",
  ownerColumnLabel: "Author",
  buildColumnLabel: "Build",
  passingLabel: "passing",
  notPassingLabel: "not passing",
  noBuildLabel: "No build yet",
  noSearchResultsHeading: "No prototypes found",
  noSearchResultsDescription:
    "Try a different search, or clear the current search to browse all prototypes.",
  navigationLabel: "Repository navigation",
  newPrototypeLabel: "Create",
  newPrototypePath: "/repositories/2001/new",
  pageTitle: "github/prototype",
  prototypes: [
    {
      author: {
        avatarUrl: "https://avatars.example.test/octocat",
        label: "by @octocat",
        ownerLabel: "@octocat",
        url: "https://github.com/octocat",
      },
      branchName: "prototype/welcome",
      name: "Welcome",
      description: "Explore a new welcome flow.",
      id: "1",
      latestBuild: { state: "running", stateLabel: "Running" },
      path: "/repositories/2001/prototypes/1",
      reviewBuild: {
        number: 1,
        screenshotAlt: "Desktop screenshot of prototype/welcome, build 1",
        screenshotSrc: "/repositories/2001/prototypes/1/builds/1/screenshots/desktop",
      },
    },
  ],
  prototypesCountLabel: "1 prototype",
  prototypesHeading: "Prototypes",
  prototypesLabel: "Prototypes",
  prototypesPath: "/repositories/2001",
  repositories: [
    { id: "2001", nameWithOwner: "github/prototype", path: "/repositories/2001" },
    { id: "2002", nameWithOwner: "github/other", path: "/repositories/2002" },
  ],
  repositoryMenuLabel: "Repositories",
  repositorySelectorLabel: "Choose repository. github/prototype selected",
  selectedRepositoryId: "2001",
  searchLabel: "Search prototypes",
  signOutLabel: "Sign out",
  signOutPath: "/session",
  viewLabel: "Prototype layout",
  workflowInstallation: {
    actionLabel: "Open installation pull request",
    createPath: "/repositories/2001/workflow_installation",
    description: "Open a pull request that adds the Replica workflow for prototype branches.",
    heading: "Prototype workflow file missing",
    state: "installable",
  },
}

function RepositoriesShowPage({
  controls,
  ...props
}: Omit<ComponentProps<typeof Page>, "controls"> & { controls?: PrototypeListingControls }) {
  return (
    <Page {...props} controls={controls ?? listingControls({ query: props.data.listing.query })} />
  )
}

function listingControls(
  overrides: Partial<PrototypeListingControls> = {},
): PrototypeListingControls {
  return {
    query: "",
    pending: false,
    error: false,
    onQueryChange: vi.fn(),
    onQuerySubmit: vi.fn(),
    onAuthorChange: vi.fn(),
    onNavigate: vi.fn(),
    onRetry: vi.fn(),
    loadAuthors: vi.fn(() => Promise.resolve({ authors: [], nextCursor: null })),
    ...overrides,
  }
}

describe("RepositoriesShowPage()", () => {
  it("navigates a page once while keeping ordinary links available for modified clicks", () => {
    const controls = listingControls()
    const delegatedClick = vi.fn()
    render(
      <div onClick={delegatedClick}>
        <RepositoriesShowPage
          controls={controls}
          data={{
            ...PAGE_DATA,
            listing: {
              ...prototypeListing,
              matchingCount: 80,
              pageCount: 4,
              pagePath: "/repositories/2001?q=design&author=me",
            },
            prototypesCountLabel: "80 prototypes",
          }}
        />
      </div>,
    )
    const next = screen.getByRole("button", { name: "Page 3" })
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page")
    expect(next).toHaveAttribute("href", "/repositories/2001?q=design&author=me&page=3")
    expect(screen.getByText("80 prototypes (1 shown)")).toBeInTheDocument()
    fireEvent.click(next)
    expect(controls.onNavigate).toHaveBeenCalledExactlyOnceWith(
      "/repositories/2001?q=design&author=me&page=3",
    )
    expect(delegatedClick).not.toHaveBeenCalled()
    fireEvent.click(next, { ctrlKey: true })
    expect(controls.onNavigate).toHaveBeenCalledTimes(1)
    expect(delegatedClick).toHaveBeenCalledTimes(1)
  })

  it("retains known cards during loading and request failure and exposes retry", () => {
    const controls = listingControls({ pending: true })
    const { rerender } = render(<RepositoriesShowPage data={PAGE_DATA} controls={controls} />)
    expect(screen.getByRole("region", { name: "Prototypes" })).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("status")).toHaveTextContent(prototypeListing.copy.updating)
    expect(screen.getByRole("link", { name: "Welcome" })).toBeInTheDocument()
    rerender(
      <RepositoriesShowPage
        data={PAGE_DATA}
        controls={{ ...controls, pending: false, error: true }}
      />,
    )
    expect(screen.getByText(prototypeListing.copy.resultsFailed)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Welcome" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(controls.onRetry).toHaveBeenCalledOnce()
  })

  it("invites people to build their first prototype with a decorative branch icon", () => {
    const { container } = render(
      <RepositoriesShowPage
        data={{ ...PAGE_DATA, prototypes: [], workflowInstallation: undefined }}
      />,
    )

    expect(screen.getByRole("heading", { level: 2, name: "No prototypes yet" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Build prototype" })).toHaveAttribute(
      "href",
      PAGE_DATA.newPrototypePath,
    )
    expect(screen.getByRole("link", { name: "Build prototype" })).toHaveAttribute(
      "data-sg-visit",
      "true",
    )
    const visual = container.querySelector(".hub-empty-state__visual svg")
    expect(visual).toHaveClass("octicon-git-branch")
    expect(visual).toHaveAttribute("width", "48")
    expect(visual).toHaveAttribute("height", "48")
    expect(visual).toHaveAttribute("fill", "currentColor")
    expect(container.querySelector(".hub-empty-state__visual")).toHaveAttribute(
      "aria-hidden",
      "true",
    )
  })

  it("shows local discovery guidance without a local-only action", () => {
    const localPageData = {
      ...PAGE_DATA,
      alert: "This local repository is no longer available.",
      emptyLabel:
        "Hub checks committed local branches every minute. When one appears, add it under Manage prototypes.",
      managePrototypesLabel: "Manage prototypes",
      managePrototypesPath: "/repositories/1/prototypes/manage",
      newPrototypePath: null,
      prototypes: [],
      repositories: [
        { id: "1", nameWithOwner: "local/example", path: "/repositories/1" },
        { id: "2", nameWithOwner: "local/another", path: "/repositories/2" },
      ],
      repositorySelectorLabel: "Choose repository. local/example selected",
      selectedRepositoryId: "1",
      workflowInstallation: undefined,
    }
    const { container, rerender } = render(<RepositoriesShowPage data={localPageData} />)

    expect(screen.queryByRole("button", { name: "Refresh branches" })).not.toBeInTheDocument()
    const managePrototypes = screen.getByRole("link", { name: "Manage prototypes" })
    expect(managePrototypes).toHaveAttribute("href", "/repositories/1/prototypes/manage")
    expect(managePrototypes).not.toHaveAttribute("aria-busy")

    rerender(<RepositoriesShowPage data={localPageData} managingPrototypes />)
    const pendingManagePrototypes = screen.getByRole("link", { name: "Manage prototypes" })
    expect(pendingManagePrototypes).toHaveAttribute("aria-busy", "true")
    expect(pendingManagePrototypes.querySelector(".hub-spinner")).toBeInTheDocument()

    rerender(<RepositoriesShowPage data={localPageData} />)
    const settledManagePrototypes = screen.getByRole("link", { name: "Manage prototypes" })
    expect(settledManagePrototypes).not.toHaveAttribute("aria-busy")
    const emptyDescription = container.querySelector(".hub-empty-state__description")
    expect(emptyDescription).toHaveTextContent(
      "Hub checks committed local branches every minute. When one appears, add it under Manage prototypes.",
    )
    const manageLabel = emptyDescription?.querySelector(".repository-detail__manage-label")
    expect(manageLabel).toHaveTextContent("Manage prototypes")
    expect(manageLabel?.querySelector(".octicon-gear")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This local repository is no longer available.",
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Choose repository. local/example selected" }),
    )
    expect(screen.getByRole("menuitem", { name: "local/another" })).toHaveAttribute(
      "href",
      "/repositories/2",
    )
    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Build prototype" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open installation pull request" }),
    ).not.toBeInTheDocument()
  })

  it("links each card to review and keeps history available", () => {
    render(<RepositoriesShowPage data={PAGE_DATA} />)

    expect(screen.getByRole("heading", { name: "Prototypes" })).toBeInTheDocument()
    const navigation = screen.getByRole("navigation", { name: "Repository navigation" })
    expect(navigation.querySelectorAll("ul > li")).toHaveLength(2)
    const newPrototypeLink = screen.getByRole("link", { name: "Create" })
    expect(newPrototypeLink).toHaveAttribute("href", "/repositories/2001/new")
    expect(newPrototypeLink).not.toHaveAttribute("aria-current")
    expect(newPrototypeLink).toHaveTextContent(/^Create$/)
    expect(newPrototypeLink.querySelector("svg")).toHaveClass("octicon-plus")
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Replica Hub" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Choose repository. github/prototype selected" }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Choose repository. github/prototype selected" }),
    )
    expect(screen.getByRole("menuitem", { name: "github/prototype" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByText("1 prototype")).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+K Control+K",
    )
    const shortcutKey = screen.getByText("K")
    expect(shortcutKey).toHaveClass("prototype-index-header__shortcut-key")
    expect(shortcutKey.className).toMatch(/Text-font--monospace/)
    expect(shortcutKey.closest("kbd")).toHaveTextContent("⌘K")
    expect(
      screen.getByRole("searchbox", { name: "Search prototypes" }).closest("header"),
    ).toHaveClass("repository-page-header")
    expect(screen.getByRole("radio", { name: "List view" }).closest("header")).toHaveClass(
      "repository-page-header",
    )
    expect(screen.queryByText("github/prototype · Default branch: main")).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Gallery view" })).toBeChecked()
    fireEvent.click(screen.getByRole("radio", { name: "List view" }))
    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked()
    expect(screen.getByRole("link", { name: "Welcome" }).closest("tr")).toHaveClass(
      "prototype-card--list",
    )
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Account menu for @octocat" }))
    expect(screen.getByText("Sign out")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Welcome" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1",
    )
    expect(screen.getByRole("link", { name: "Welcome" })).toHaveAttribute("data-sg-visit", "true")
    const collapseButton = screen.getByRole("button", { name: "Collapse sidebar" })
    expect(collapseButton).toHaveTextContent("Collapse sidebar")
    expect(collapseButton.querySelector("svg")).toHaveClass("octicon-sidebar-expand")
    fireEvent.click(collapseButton)
    const expandButton = screen.getByRole("button", { name: "Expand sidebar" })
    expect(expandButton.querySelector("svg")).toHaveClass("octicon-sidebar-collapse")
    expect(screen.getByRole("link", { name: "Prototypes" })).not.toHaveAttribute("aria-label")
    expect(screen.queryByRole("link", { name: "2 builds" })).not.toBeInTheDocument()
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/repositories/2001/prototypes/1/builds/1/screenshots/desktop",
    )
    expect(screen.getByRole("columnheader", { name: "Author" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Build" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: /@octocat/ })).toBeInTheDocument()
    const authorLinks = screen.getAllByRole("link", { name: /@octocat/ })
    for (const authorLink of authorLinks) {
      expect(authorLink).toHaveAttribute("href", "https://github.com/octocat")
    }
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.queryByText("Explore a new welcome flow.")).not.toBeInTheDocument()
    expect(screen.queryByText("prototype/welcome")).not.toBeInTheDocument()
    expect(screen.queryByText("2 builds")).not.toBeInTheDocument()
    expect(screen.queryByText("Manage prototypes")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Open installation pull request" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("form")).toHaveAttribute(
      "action",
      "/repositories/2001/workflow_installation",
    )
  })

  it("preserves server order in gallery and list views", () => {
    render(
      <RepositoriesShowPage
        data={{
          ...PAGE_DATA,
          workflowInstallation: undefined,
          prototypes: [
            { ...PAGE_DATA.prototypes[0]!, name: "Z newest prototype" },
            {
              ...PAGE_DATA.prototypes[0]!,
              id: "2",
              name: "A oldest prototype",
              path: "/repositories/2001/prototypes/2",
            },
          ],
          prototypesCountLabel: "2 prototypes",
        }}
      />,
    )

    function prototypeLinks() {
      return screen.getAllByRole("link", { name: /^(Z newest|A oldest) prototype$/ })
    }

    expect(prototypeLinks().map((link) => link.textContent)).toEqual([
      "Z newest prototype",
      "A oldest prototype",
    ])

    fireEvent.click(screen.getByRole("radio", { name: "List view" }))
    expect(prototypeLinks().map((link) => link.textContent)).toEqual([
      "Z newest prototype",
      "A oldest prototype",
    ])
  })

  it("offers separate registration and personal dismissal forms for each recent branch", () => {
    render(
      <RepositoriesShowPage
        data={{
          ...PAGE_DATA,
          managePrototypesLabel: "Manage prototypes",
          managePrototypesPath: "/repositories/2001/prototypes/manage",
          workflowInstallation: undefined,
          addToHubLabel: "Add to Hub",
          declineBranchLabel: "Hide message",
          recentBranches: [
            {
              id: "2",
              branchName: "prototype/new",
              title: "You pushed prototype/new. Add it to Hub?",
              registrationPath: "/repositories/2001/prototypes/2/registration",
              dismissalPath: "/repositories/2001/prototypes/2/branch_banner_dismissal",
            },
            {
              id: "3",
              branchName: "prototype/navigation",
              title: "You pushed prototype/navigation. Add it to Hub?",
              registrationPath: "/repositories/2001/prototypes/3/registration",
              dismissalPath: "/repositories/2001/prototypes/3/branch_banner_dismissal",
            },
          ],
        }}
      />,
    )

    expect(screen.getAllByRole("status")).toHaveLength(2)
    expect(screen.getByText("You pushed prototype/new. Add it to Hub?")).toBeInTheDocument()
    expect(screen.getByText("You pushed prototype/navigation. Add it to Hub?")).toBeInTheDocument()
    const buttons = screen.getAllByRole("button", { name: "Add to Hub" })
    expect(buttons).toHaveLength(2)
    for (const [index, button] of buttons.entries()) {
      const form = button.closest("form")!
      expect(form).toHaveAttribute(
        "action",
        `/repositories/2001/prototypes/${index + 2}/registration`,
      )
      expect(form).toHaveAttribute("method", "post")
      expect(form.querySelector('[name="authenticity_token"]')).toHaveValue("token")
      expect(form.querySelector('[name="_method"]')).toHaveValue("patch")
      expect(form.querySelector('[name="intent"]')).toHaveValue("register_only")
      expect(form.querySelector('[name="return_to"]')).toHaveValue("repository")
      expect(form.querySelector('[name="prototype[name]"]')).toHaveValue(
        index === 0 ? "prototype/new" : "prototype/navigation",
      )
    }
    const declineButtons = screen.getAllByRole("button", { name: "Hide message" })
    expect(declineButtons).toHaveLength(2)
    for (const [index, button] of declineButtons.entries()) {
      const form = button.closest("form")!
      expect(form).toHaveAttribute(
        "action",
        `/repositories/2001/prototypes/${index + 2}/branch_banner_dismissal`,
      )
      expect(form).toHaveAttribute("method", "post")
      expect(form.querySelector('[name="authenticity_token"]')).toHaveValue("token")
      expect(form.querySelector('[name="user_id"]')).toBeNull()
      expect(form.querySelector('[name="prototype[name]"]')).toBeNull()
    }
    const gear = screen.getByRole("link", { name: "Manage prototypes" })
    expect(gear).toHaveAttribute("href", "/repositories/2001/prototypes/manage")
    expect(gear).toHaveClass("hub-icon-button--invisible")
    expect(screen.queryByText("You have branches ready to add to Hub.")).not.toBeInTheDocument()
  })

  it("keeps management available without recent pushes and offers no generic alert", () => {
    render(
      <RepositoriesShowPage
        data={{
          ...PAGE_DATA,
          managePrototypesLabel: "Manage prototypes",
          managePrototypesPath: "/repositories/2001/prototypes/manage",
          recentBranches: [],
          workflowInstallation: undefined,
        }}
      />,
    )

    expect(screen.getByRole("link", { name: "Manage prototypes" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add to Hub" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Hide message" })).not.toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("keeps gallery metadata concise and displays build results in the list", () => {
    render(
      <RepositoriesShowPage
        data={{
          ...PAGE_DATA,
          prototypes: [
            {
              ...PAGE_DATA.prototypes[0]!,
              latestBuild: { state: "successful", stateLabel: "Successful" },
            },
            {
              ...PAGE_DATA.prototypes[0]!,
              id: "2",
              name: "Failed build",
              latestBuild: { state: "failed", stateLabel: "Failed" },
            },
            {
              ...PAGE_DATA.prototypes[0]!,
              id: "3",
              name: "Waiting for build",
              latestBuild: undefined,
            },
          ],
        }}
      />,
    )

    expect(screen.getAllByText("by @octocat")).toHaveLength(3)
    expect(screen.queryByText("Explore a new welcome flow.")).not.toBeInTheDocument()
    expect(screen.queryByText("prototype/welcome")).not.toBeInTheDocument()
    expect(screen.queryByText("2 builds")).not.toBeInTheDocument()
    expect(document.querySelectorAll(".prototype-card__arrow")).toHaveLength(3)

    fireEvent.click(screen.getByRole("radio", { name: "List view" }))
    expect(screen.getByRole("table")).toBeInTheDocument()
    const passingRow = screen.getByRole("row", { name: /Welcome @octocat passing/ })
    expect(passingRow.querySelector(".prototype-card__build-label svg")).toBeNull()
    const prototypeLink = screen.getByRole("link", { name: "Welcome" })
    expect(prototypeLink).toHaveAttribute("href", PAGE_DATA.prototypes[0]!.path)
    expect(prototypeLink).toHaveAttribute("data-sg-visit", "true")
    const ownerLink = passingRow.querySelector<HTMLAnchorElement>(".prototype-card__list-owner")
    expect(ownerLink).toHaveAttribute("href", "https://github.com/octocat")
    expect(ownerLink).not.toHaveAttribute("data-sg-visit")
    expect(ownerLink?.querySelector(".prototype-card__list-owner-name")).toHaveTextContent(
      "@octocat",
    )
    expect(prototypeLink).not.toContainElement(ownerLink)

    const failedRow = screen.getByRole("row", { name: /Failed build @octocat not passing/ })
    expect(failedRow.querySelector(".prototype-card__build-label svg")).toBeNull()
    expect(
      screen.getByRole("row", { name: /Waiting for build @octocat No build yet/ }),
    ).toBeInTheDocument()
  })

  it("delegates search without filtering server results again and renders empty results", () => {
    const controls = listingControls({ query: "octocat" })
    const { rerender } = render(
      <RepositoriesShowPage
        controls={controls}
        data={{ ...PAGE_DATA, listing: { ...prototypeListing, query: "octocat" } }}
      />,
    )

    expect(screen.getByRole("link", { name: "Welcome" })).toBeInTheDocument()
    const search = screen.getByRole("searchbox", { name: "Search prototypes" })
    fireEvent.change(search, { target: { value: "missing" } })
    expect(controls.onQueryChange).toHaveBeenCalledWith("missing")
    fireEvent.keyDown(search, { key: "Enter" })
    expect(controls.onQuerySubmit).toHaveBeenCalledOnce()

    rerender(
      <RepositoriesShowPage
        controls={{ ...controls, query: "missing" }}
        data={{
          ...PAGE_DATA,
          listing: { ...prototypeListing, query: "missing", matchingCount: 0 },
          prototypes: [],
          prototypesCountLabel: "0 prototypes",
        }}
      />,
    )
    expect(screen.getByText("0 prototypes")).toBeInTheDocument()
    expect(screen.getByText("No prototypes found")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]!)
    expect(controls.onQueryChange).toHaveBeenLastCalledWith("")
    expect(search).toHaveFocus()
  })

  it("focuses search with Command K and Control K", () => {
    render(<RepositoriesShowPage data={PAGE_DATA} />)

    const search = screen.getByRole("searchbox", { name: "Search prototypes" })
    fireEvent.keyDown(window, { key: "k", metaKey: true })
    expect(search).toHaveFocus()
    search.blur()
    fireEvent.keyDown(window, { key: "K", ctrlKey: true })
    expect(search).toHaveFocus()
  })
})
