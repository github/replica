import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, it, vi } from "vitest"

import { PrototypeMetadataManagement } from "."
import type { PrototypeMetadataManagementData } from "./types"

const data: PrototypeMetadataManagementData = {
  heading: "Manage prototypes",
  unlistedHeading: "Available branches",
  unlistedDescription:
    "Add a branch to Hub to make your prototype available for others to explore.",
  registeredHeading: "Prototypes in Hub",
  registeredEmptyLabel:
    "No prototypes in Hub yet. Once you add a branch, it will appear here so you can manage its details.",
  emptyLabel:
    "No branches available to add. When you create a new branch, it will appear here so you can add it to Hub.",
  nameLabel: "Name",
  descriptionLabel: "Description (optional)",
  startPageLabel: "Start page (optional)",
  startPageHint: "Paste a preview URL or route. Leave blank to start at /.",
  addLabel: "Add to Hub",
  editLabel: "Edit details",
  saveLabel: "Save details",
  cancelLabel: "Cancel",
  addDialogHeading: "Add branch to Hub",
  editDialogHeading: "Edit prototype details",
  closeDialogLabel: "Close dialog",
  nameMaximumLength: 255,
  descriptionMaximumLength: 500,
  candidateCheckFailed: false,
  candidateCheckFailedLabel: "Hub could not check which branches you can add.",
  candidateLoadingLabel: "Checking branches you can add...",
  candidateRetryLabel: "Retry branch check",
  candidateDataPath: "/repositories/2001/prototypes/manage?props_at=data.management",
  candidatePage: 1,
  candidatePageCount: 1,
  candidatePagePath: "/repositories/2001/prototypes/manage",
  paginationLabel: "Available branches pages",
  previousPageLabel: "Previous",
  previousPageAriaLabel: "Previous page",
  nextPageLabel: "Next",
  nextPageAriaLabel: "Next page",
  unlisted: [
    {
      id: "2",
      branchName: "prototype/new",
      name: "prototype/new",
      description: null,
      startPage: null,
      path: "/repositories/2001/prototypes/2/registration",
    },
  ],
  registered: [
    {
      id: "1",
      branchName: "prototype/welcome",
      name: "Welcome",
      description: "Explore the new welcome flow.",
      startPage: "/welcome?step=1#intro",
      path: "/repositories/2001/prototypes/1/registration",
    },
  ],
}

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "")
}
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open")
  this.dispatchEvent(new Event("close"))
}

describe("PrototypeMetadataManagement()", () => {
  it("shows loading instead of empty results while keeping registered edits available", () => {
    render(<PrototypeMetadataManagement authenticityToken="token" data={data} loading />)
    expect(screen.getByRole("status")).toHaveTextContent(data.candidateLoadingLabel)
    expect(screen.queryByText(data.emptyLabel)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Add to Hub: prototype/new" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit details: prototype/welcome" })).toBeEnabled()
  })

  it("offers an explicit retry when the async branch request fails", () => {
    const retry = vi.fn()
    render(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={data}
        loadFailed
        onRetry={retry}
      />,
    )
    expect(screen.getByText(data.candidateCheckFailedLabel)).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: data.candidateRetryLabel }))
    expect(retry).toHaveBeenCalledOnce()
  })
  it("shows repository metadata import errors in the editor", () => {
    const message = "Could not import .prototype: fix the file or set the start page here."
    render(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={{
          ...data,
          unlisted: data.unlisted.map((entry) => ({ ...entry, startPageImportError: message })),
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Add to Hub: prototype/new" }))
    expect(screen.getByText(message)).toBeVisible()
  })

  it("groups branches and listed prototypes in separate row lists", () => {
    render(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={{
          ...data,
          unlisted: [
            ...data.unlisted,
            {
              id: "3",
              branchName: "prototype/navigation",
              name: "prototype/navigation",
              description: null,
              startPage: null,
              path: "/repositories/2001/prototypes/3/registration",
            },
          ],
          registered: [
            ...data.registered,
            {
              id: "4",
              branchName: "prototype/settings",
              name: "Settings",
              description: null,
              startPage: null,
              path: "/repositories/2001/prototypes/4/registration",
            },
          ],
        }}
      />,
    )

    const ready = screen.getByRole("region", { name: data.unlistedHeading })
    const listed = screen.getByRole("region", { name: data.registeredHeading })
    expect(within(ready).getByRole("list")).toHaveClass("prototype-metadata__list")
    expect(within(ready).getAllByRole("listitem")).toHaveLength(2)
    expect(within(ready).getByText(data.unlistedDescription)).toBeInTheDocument()
    expect(screen.queryByText(data.emptyLabel)).not.toBeInTheDocument()
    expect(within(listed).getByRole("list")).toHaveClass("prototype-metadata__list")
    expect(within(listed).getAllByRole("listitem")).toHaveLength(2)
    expect(screen.queryByText(data.registeredEmptyLabel)).not.toBeInTheDocument()
  })

  it("opens a branch form and returns focus when the dialog closes", () => {
    render(<PrototypeMetadataManagement authenticityToken="token" data={data} />)

    const add = screen.getByRole("button", { name: "Add to Hub: prototype/new" })
    fireEvent.click(add)
    const dialog = screen.getByRole("dialog", { name: "Add branch to Hub" })
    const form = within(dialog).getByRole("button", { name: "Add to Hub" }).closest("form")

    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveFocus()
    expect(form).toHaveAttribute("action", "/repositories/2001/prototypes/2/registration")
    expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toEqual({
      _method: "patch",
      authenticity_token: "token",
      "prototype[name]": "prototype/new",
      "prototype[description]": "",
      "prototype[start_page]": "",
    })

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(add).toHaveFocus()
  })

  it("opens registered details for editing", () => {
    render(<PrototypeMetadataManagement authenticityToken="token" data={data} />)

    fireEvent.click(screen.getByRole("button", { name: "Edit details: prototype/welcome" }))
    const dialog = screen.getByRole("dialog", { name: "Edit prototype details" })
    const form = within(dialog).getByRole("button", { name: "Save details" }).closest("form")

    expect(form).toHaveAttribute("action", "/repositories/2001/prototypes/1/registration")
    expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toMatchObject({
      "prototype[name]": "Welcome",
      "prototype[description]": "Explore the new welcome flow.",
      "prototype[start_page]": "/welcome?step=1#intro",
    })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Start page (optional)" }), {
      target: { value: "" },
    })
    expect(form).toHaveFormValues({ "prototype[start_page]": "" })
  })

  it("keeps registered edits available when branch checks fail", () => {
    render(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={{ ...data, candidateCheckFailed: true, candidatePageCount: 2 }}
      />,
    )

    expect(screen.getByText(data.candidateCheckFailedLabel)).toBeInTheDocument()
    expect(screen.queryByText(data.emptyLabel)).not.toBeInTheDocument()
    expect(screen.queryByText(data.unlistedDescription)).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: data.paginationLabel })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit details: prototype/welcome" })).toBeEnabled()
  })

  it("links to eligible pages and marks the current page", () => {
    render(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={{ ...data, candidatePage: 2, candidatePageCount: 3 }}
      />,
    )

    const pages = screen.getByRole("navigation", { name: data.paginationLabel })
    expect(within(pages).getByRole("button", { name: "Previous page" })).toHaveAttribute(
      "href",
      data.candidatePagePath,
    )
    expect(within(pages).getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "href",
      data.candidatePagePath,
    )
    expect(within(pages).getByRole("button", { name: "Page 2" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(within(pages).getByRole("button", { name: "Next page" })).toHaveAttribute(
      "href",
      `${data.candidatePagePath}?page=3`,
    )
    expect(within(pages).getByRole("button", { name: /^Page 3/ })).toHaveAttribute(
      "data-sg-visit",
      "true",
    )
  })

  it("shows no pagination for a single page or an empty set", () => {
    const { rerender } = render(
      <PrototypeMetadataManagement authenticityToken="token" data={data} />,
    )

    expect(screen.queryByRole("navigation", { name: data.paginationLabel })).not.toBeInTheDocument()

    rerender(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={{ ...data, candidatePageCount: 0, unlisted: [] }}
      />,
    )
    expect(screen.getByText(data.emptyLabel)).toBeInTheDocument()
    expect(screen.queryByText(data.unlistedDescription)).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: data.paginationLabel })).not.toBeInTheDocument()
  })

  it("keeps the Hub section visible when empty regardless of available branches", () => {
    const { rerender } = render(
      <PrototypeMetadataManagement authenticityToken="token" data={{ ...data, registered: [] }} />,
    )

    const listed = screen.getByRole("region", { name: data.registeredHeading })
    expect(within(listed).getByText(data.registeredEmptyLabel)).toBeInTheDocument()
    expect(within(listed).queryByRole("list")).not.toBeInTheDocument()
    expect(screen.getByText(data.unlistedDescription)).toBeInTheDocument()

    rerender(
      <PrototypeMetadataManagement
        authenticityToken="token"
        data={{ ...data, candidatePageCount: 0, unlisted: [], registered: [] }}
      />,
    )

    expect(screen.getByRole("heading", { name: data.registeredHeading })).toBeInTheDocument()
    expect(screen.getByText(data.registeredEmptyLabel)).toBeInTheDocument()
    expect(screen.getByText(data.emptyLabel)).toBeInTheDocument()
    expect(screen.queryByText(data.unlistedDescription)).not.toBeInTheDocument()
  })
})
