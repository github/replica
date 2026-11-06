import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { templatesData } from "@/storybook/fixtures/templates"

import { TemplateCard } from "."

describe("TemplateCard()", () => {
  it("keeps the focusable screenshot outside the stretched card link", () => {
    const template = templatesData.templates[1]!
    render(
      <TemplateCard
        template={template}
        openLabel="Open template"
        unavailableLabel="Preview unavailable"
      />,
    )

    const link = screen.getByRole("link", { name: "Open template: Welcome" })
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(link).toHaveAttribute("href", template.path)
    expect(link).toHaveClass("prototype-card__review-link")
    const preview = screen.getByRole("group", { name: "Preview of Welcome" })
    expect(preview).toHaveClass("scrolling-screenshot")
    expect(preview.closest("a")).toBeNull()
    expect(preview).toHaveAttribute("tabindex", "0")
    expect(within(preview).getByRole("img", { name: "Preview of Welcome" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Welcome", level: 3 })).toHaveClass(
      "prototype-card__branch-name",
    )
    expect(link).toContainElement(screen.getByRole("heading", { name: "Welcome" }))
    expect(link.closest(".template-card")).toContainElement(preview)
    expect(link.closest(".template-card")).toContainElement(screen.getByText(template.description))
    expect(link.querySelector("[tabindex], button, input, textarea, select, a")).toBeNull()
    expect(screen.queryByText(template.category)).not.toBeInTheDocument()
    expect(screen.queryByText("Open template")).not.toBeInTheDocument()
  })

  it("keeps the entire card linked when a screenshot is unavailable", () => {
    const template = { ...templatesData.templates[0]!, screenshotSrc: undefined }
    render(
      <TemplateCard
        template={template}
        openLabel="Open template"
        unavailableLabel="Preview unavailable"
      />,
    )

    const link = screen.getByRole("link", { name: "Open template: Default" })
    expect(link).toHaveAttribute("href", template.path)
    expect(link).toHaveClass("prototype-card__review-link")
    expect(link.closest(".template-card")).toContainElement(screen.getByText("Preview unavailable"))
    expect(link).toContainElement(screen.getByRole("heading", { name: "Default" }))
    expect(within(link).queryByRole("group")).not.toBeInTheDocument()
  })
})
