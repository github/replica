import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RepositorySelector } from "."

const data = {
  ariaLabel: "Choose repository. github/prototype selected",
  menuLabel: "Repositories",
  repositories: [
    { id: "2001", nameWithOwner: "github/prototype", path: "/repositories/2001" },
    { id: "2002", nameWithOwner: "github/empty", path: "/repositories/2002" },
  ],
  selectedRepositoryId: "2001",
}

describe("RepositorySelector()", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("shows the selected repository and keeps its menu links", async () => {
    render(<RepositorySelector {...data} />)

    const trigger = screen.getByRole("button", { name: data.ariaLabel })
    expect(trigger).toHaveTextContent("github/prototype")
    expect(trigger.className).toContain("Button--size-small")
    expect(trigger.className).toContain("Button--secondary")
    fireEvent.click(trigger)
    expect(screen.getByRole("menu", { name: data.menuLabel })).toHaveAttribute(
      "data-menu-label",
      data.menuLabel,
    )
    expect(screen.getByRole("menuitem", { name: "github/prototype" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "github/prototype" })).toHaveFocus(),
    )
    expect(screen.getByRole("link", { name: "github/empty" })).toHaveAttribute(
      "href",
      "/repositories/2002",
    )
  })

  it("keeps the repository menu labelled when collapsed", () => {
    render(<RepositorySelector {...data} collapsed />)

    const trigger = screen.getByRole("button", { name: data.ariaLabel })
    expect(trigger.querySelector(".repository-selector__name")).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByRole("menuitem", { name: "github/empty" })).toBeInTheDocument()
  })

  it("shows loading and retry states without losing the current repository", () => {
    const retry = vi.fn()
    const status = {
      loading: true,
      failed: false,
      loadingLabel: "Loading repositories...",
      errorLabel: "Hub could not load all repository choices.",
      retryLabel: "Retry repository choices",
      onRetry: retry,
    }
    const { rerender } = render(<RepositorySelector {...data} status={status} />)
    expect(screen.getByRole("status")).toHaveTextContent(status.loadingLabel)
    fireEvent.click(screen.getByRole("button", { name: data.ariaLabel }))
    expect(screen.getByRole("menuitem", { name: status.loadingLabel })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.getByRole("link", { name: "github/prototype" })).toBeInTheDocument()

    rerender(<RepositorySelector {...data} status={{ ...status, loading: false, failed: true }} />)
    expect(screen.getByRole("status")).toHaveTextContent(status.errorLabel)
    expect(screen.getByRole("menuitem", { name: status.errorLabel })).toBeVisible()
    fireEvent.click(screen.getByRole("menuitem", { name: status.retryLabel }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it.each(["Enter", " "])("retries repository choices with %s", (key) => {
    const retry = vi.fn()
    render(
      <RepositorySelector
        {...data}
        status={{
          loading: false,
          failed: true,
          loadingLabel: "Loading repositories...",
          errorLabel: "Hub could not load all repository choices.",
          retryLabel: "Retry repository choices",
          onRetry: retry,
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: data.ariaLabel }))
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Retry repository choices" }), { key })
    expect(retry).toHaveBeenCalledOnce()
  })

  it.each(["Enter", " "])("activates a repository link with %s", (key) => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    render(<RepositorySelector {...data} />)

    fireEvent.click(screen.getByRole("button", { name: data.ariaLabel }))
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "github/empty" }), { key })
    expect(click).toHaveBeenCalledOnce()
    expect(click.mock.instances[0]).toHaveAttribute("href", "/repositories/2002")
  })
})
