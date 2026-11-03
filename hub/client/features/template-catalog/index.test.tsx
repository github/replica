import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import { templatesData } from "@/storybook/fixtures/templates"

import { TemplateCatalog } from "."

function renderPage(data = templatesData) {
  return render(
    <HubThemeProvider>
      <TemplateCatalog data={data} />
    </HubThemeProvider>,
  )
}

describe("TemplateCatalog()", () => {
  it("shows a section heading, filtered count, actual thumbnails, and detail links", () => {
    renderPage()
    expect(screen.getByRole("heading", { name: "Templates", level: 2 })).toBeInTheDocument()
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1)
    for (const template of templatesData.templates) {
      expect(screen.getByRole("heading", { name: template.name, level: 3 })).toBeInTheDocument()
    }
    expect(screen.getByText("4 templates").closest("header")).toHaveClass("repository-page-header")
    expect(screen.getByAltText("Preview of Welcome")).toHaveAttribute(
      "src",
      "/prototype-preview/templates/welcome.png",
    )
    expect(screen.getByRole("link", { name: "Open template: Default" })).toHaveAttribute(
      "href",
      "/repositories/2001/templates/default",
    )
  })

  it("filters names, categories, and descriptions and restores the collection", () => {
    renderPage()
    const search = screen.getByRole("searchbox", { name: "Search templates" })
    for (const query of ["welcome", "editorial", "issue archive"]) {
      fireEvent.change(search, { target: { value: query } })
      expect(screen.getByText("1 template")).toBeInTheDocument()
      expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument()
      expect(screen.queryByRole("heading", { name: "Signal room" })).not.toBeInTheDocument()
    }
    fireEvent.change(search, { target: { value: "not a template" } })
    expect(screen.getByRole("heading", { name: "No templates found" })).toBeInTheDocument()
    expect(screen.getByText("0 templates")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]!)
    expect(screen.getByText("4 templates")).toBeInTheDocument()
  })

  it("keeps every card available when the collection has more than five templates", () => {
    const templates = [
      ...templatesData.templates,
      ...templatesData.templates.slice(1).map((template) => ({
        ...template,
        id: `${template.id}-alternate`,
      })),
    ]
    renderPage({ ...templatesData, templates })

    expect(screen.getByText("7 templates")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /^Open template:/ })).toHaveLength(7)
    expect(screen.getAllByRole("group", { name: /^Preview of / })).toHaveLength(7)
  })

  it("keeps Default available without a build alert when its preview is unavailable", () => {
    renderPage({
      ...templatesData,
      templates: [{ ...templatesData.templates[0]!, screenshotSrc: undefined }],
      noAdditionalTemplatesLabel:
        "This repository has no additional templates yet. Start with Default.",
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Default" })).toBeInTheDocument()
    expect(screen.getByText("1 template")).toBeInTheDocument()
  })
})
