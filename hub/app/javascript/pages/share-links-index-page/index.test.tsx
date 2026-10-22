import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { ShareLinksIndexPage } from "./index"
import story from "./stories"
import type { ShareLinksIndexPageData } from "./types"

const writeText = vi.fn()

const PAGE_DATA: ShareLinksIndexPageData = {
  ...story.args.data,
  closePath: "/repositories/2001/prototypes/1?build=2",
  branchPath: "/repositories/2001/prototypes/1?build=2",
  form: {
    ...story.args.data.form,
    buildLabel: "Build 2",
  },
  managementBuildNumber: 2,
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
  shareLinks: [
    {
      buildLabel: "Build 2",
      createdAt: "2026-09-15T12:00:00Z",
      createdLabel: "Created by @octocat",
      deletePath: "/repositories/2001/prototypes/1/share_links/1",
      deletePrompt: "Delete “Usability review”?",
      expiresAt: "2026-09-22T12:00:00Z",
      expiresLabel: "Expires September 22",
      id: 1,
      label: "Usability review",
      url: "http://replica.localhost:19500/share/12345678-1234-1234-1234-123456789abc",
    },
  ],
}

describe("ShareLinksIndexPage()", () => {
  it("warns that public links can expose sensitive or customer information before creation", () => {
    render(<ShareLinksIndexPage data={PAGE_DATA} />, { wrapper: HubThemeProvider })
    expect(
      screen.getByText(/Anyone with a link can view this Build without signing in/),
    ).toHaveTextContent("sensitive or customer information")
    expect(screen.getByRole("button", { name: "Create share link" })).toBeInTheDocument()
  })

  it("explains disabled sharing without a create form or remembered public links", () => {
    render(<ShareLinksIndexPage data={{ ...PAGE_DATA, publicSharingEnabled: false }} />, {
      wrapper: HubThemeProvider,
    })
    expect(screen.getByRole("alert")).toHaveTextContent(PAGE_DATA.disabledLabel)
    expect(screen.queryByRole("button", { name: "Create share link" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "No active share links" })).not.toBeInTheDocument()
  })
  it("decorates copied and opened links while preserving source settings in native mutation forms", async () => {
    writeText.mockResolvedValue(undefined)
    const query = "rc.page.title=%22Configured%22"
    const { container, rerender } = render(
      <ShareLinksIndexPage
        data={PAGE_DATA}
        sourceControlQuery={query}
        controlSettings={{
          included: true,
          query,
          error: "",
          blocked: false,
          onChange: vi.fn(),
        }}
      />,
      { wrapper: HubThemeProvider },
    )
    const url = `${PAGE_DATA.shareLinks[0]!.url}?${query}`
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    expect(writeText).toHaveBeenCalledWith(url)
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", url)
    expect([...container.querySelectorAll('input[name="control_query"]')]).toHaveLength(2)
    for (const field of container.querySelectorAll('input[name="control_query"]'))
      expect(field).toHaveValue(query)
    rerender(
      <ShareLinksIndexPage
        data={PAGE_DATA}
        sourceControlQuery={query}
        controlSettings={{
          included: false,
          query: "",
          error: "",
          blocked: false,
          onChange: vi.fn(),
        }}
      />,
    )
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      PAGE_DATA.shareLinks[0]!.url,
    )
    expect(container.querySelector('input[name="control_query"]')).toHaveValue(query)
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument()
  })

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
  })

  it("uses the review workspace without breadcrumbs", () => {
    const { container } = render(<ShareLinksIndexPage data={PAGE_DATA} />, {
      wrapper: HubThemeProvider,
    })

    expect(container.querySelector(".repository-workspace")).toBeInTheDocument()
    expect(container.querySelector(".share-links__breadcrumbs")).not.toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Repository navigation" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "prototype/welcome", level: 1 })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "prototype/welcome" })).toHaveAttribute(
      "href",
      "/repositories/2001/prototypes/1?build=2",
    )
    expect(
      screen.getByRole("heading", { name: "Share links", level: 2 }).closest("header"),
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

  it("creates a seven-day share link for the selected Build", () => {
    const { container } = render(<ShareLinksIndexPage data={PAGE_DATA} />, {
      wrapper: HubThemeProvider,
    })

    expect(screen.getByRole("heading", { name: "Share links" })).toBeInTheDocument()
    expect(screen.getByLabelText("Label")).toHaveAttribute("maxlength", "100")
    expect(screen.getByLabelText("Expires after")).toHaveValue("seven_days")
    expect(container.querySelector('input[name="share_link[build_number]"]')).toHaveValue("2")
    const form = screen.getByLabelText("Label").closest("form")
    expect(form).toHaveAttribute("action", PAGE_DATA.form.createPath)
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      PAGE_DATA.authenticityToken,
    )
    expect(form?.querySelector('input[name="management_build"]')).toHaveValue("2")
    expect(screen.getByRole("button", { name: "Create share link" })).toBeInTheDocument()
  })

  it("omits management selection from every default-view mutation form", () => {
    const { container } = render(
      <ShareLinksIndexPage data={{ ...PAGE_DATA, managementBuildNumber: undefined }} />,
      { wrapper: HubThemeProvider },
    )

    expect(container.querySelectorAll('input[name="management_build"]')).toHaveLength(0)
  })

  it("shows verification success and leaves creation to the user", () => {
    const notice =
      "GitHub authorization succeeded for this connection only. Return to the action and submit it again within five minutes."
    render(<ShareLinksIndexPage data={{ ...PAGE_DATA, notice }} />, {
      wrapper: HubThemeProvider,
    })

    expect(screen.getByRole("status")).toHaveTextContent(notice)
    expect(screen.getByRole("button", { name: "Create share link" })).toBeInTheDocument()
  })

  it("copies and opens an active share link", async () => {
    writeText.mockResolvedValue(undefined)
    render(<ShareLinksIndexPage data={PAGE_DATA} />, { wrapper: HubThemeProvider })

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))

    expect(writeText).toHaveBeenCalledWith(
      "http://replica.localhost:19500/share/12345678-1234-1234-1234-123456789abc",
    )
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
    const open = screen.getByRole("link", { name: "Open" })
    expect(open).toHaveAttribute(
      "href",
      "http://replica.localhost:19500/share/12345678-1234-1234-1234-123456789abc",
    )
    expect(open.nextElementSibling).toContainElement(
      screen.getByRole("button", { name: "Delete link" }),
    )
  })

  it("explains why a share link cannot be created before a successful build", () => {
    render(
      <ShareLinksIndexPage
        data={{
          ...PAGE_DATA,
          buildOptions: [],
          closePath: "/repositories/2001/prototypes/1",
          selectedBuild: undefined,
          shareLinks: [],
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    expect(screen.getByRole("heading", { name: "No successful Build" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Create share link" })).not.toBeInTheDocument()
  })

  it("keeps browser deletion scoped and requires confirmation", () => {
    const link = PAGE_DATA.shareLinks[0]
    if (!link) throw new Error("Missing share-link fixture.")
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ShareLinksIndexPage data={PAGE_DATA} />, { wrapper: HubThemeProvider })
    const form = screen.getByRole("button", { name: "Delete link" }).closest("form")
    expect(form).toHaveAttribute("action", link.deletePath)
    expect(form?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      PAGE_DATA.authenticityToken,
    )
    expect(form?.querySelector('input[name="management_build"]')).toHaveValue("2")
    expect(fireEvent.submit(form!)).toBe(false)
    expect(fireEvent.submit(form!)).toBe(true)
    expect(confirm).toHaveBeenCalledWith(link.deletePrompt)
    confirm.mockRestore()
  })
})
