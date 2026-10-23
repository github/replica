import { render, screen } from "@testing-library/react"
import { describe, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { PrototypeManagementPage } from "."
import story from "./stories"

describe("PrototypeManagementPage()", () => {
  it("shows a site header with an icon-only return link above centered management content", () => {
    const data = story.args.data
    render(<PrototypeManagementPage data={data} />, { wrapper: HubThemeProvider })

    expect(
      screen.getByRole("heading", { name: "Prototypes", level: 1 }).closest("header"),
    ).toHaveClass("repository-page-header", "prototype-management-page__header")
    const back = screen.getByRole("link", { name: data.backLabel })
    expect(back).toHaveAttribute("href", data.prototypesPath)
    expect(back.textContent).toBe("")
    expect(screen.getByRole("heading", { name: "Manage prototypes", level: 2 })).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Available branches", level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Prototypes in Hub", level: 3 })).toBeInTheDocument()
    expect(
      screen
        .getByText("Add a branch to Hub to make your prototype available for others to explore.")
        .closest(".prototype-management-page__content"),
    ).toHaveClass("prototype-management-page__content")
    expect(
      screen.queryByText(
        "Add your branches to Hub or edit details for prototypes already listed here.",
      ),
    ).not.toBeInTheDocument()
  })

  it("explains where new branches appear when none are available to add", () => {
    const data = story.args.data
    render(
      <PrototypeManagementPage
        data={{
          ...data,
          management: { ...data.management, candidatePageCount: 0, unlisted: [], registered: [] },
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    expect(
      screen.getByText(
        "No branches available to add. When you create a new branch, it will appear here so you can add it to Hub.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Prototypes in Hub", level: 3 })).toBeInTheDocument()
    expect(
      screen.getByText(
        "No prototypes in Hub yet. Once you add a branch, it will appear here so you can manage its details.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(data.management.unlistedDescription)).not.toBeInTheDocument()
  })
})
