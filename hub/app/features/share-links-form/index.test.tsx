import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { SubmitEvent } from "react"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import { ShareLinksForm } from "."
import story from "./stories"

const data = story.args.data

describe("ShareLinksForm()", () => {
  it("offers only supplied expiry choices and selects a permitted browser default", () => {
    render(
      <ShareLinksForm
        data={{
          ...data,
          expirationOptions: [{ value: "one_day", label: "One day" }],
        }}
        action="/repositories/2001/prototypes/1/share_links"
      />,
      { wrapper: HubThemeProvider },
    )
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("combobox")).toHaveValue("one_day")
    expect(screen.queryByRole("option", { name: "Never" })).not.toBeInTheDocument()
  })

  it("omits the Build heading when the caller supplies the target in its details", () => {
    render(
      <ShareLinksForm
        data={{ ...data, buildLabel: null }}
        onSubmit={(event) => event.preventDefault()}
        details={<p>New links share Build 2.</p>}
      />,
      { wrapper: HubThemeProvider },
    )
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(screen.getByText("New links share Build 2.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create share link" })).toBeInTheDocument()
  })

  it("preserves native browser form submission and caller-owned hidden fields", () => {
    const { container } = render(
      <ShareLinksForm
        data={data}
        action="/repositories/2001/prototypes/1/share_links"
        hiddenFields={<input type="hidden" name="authenticity_token" value="csrf" />}
      />,
      { wrapper: HubThemeProvider },
    )
    const form = screen.getByRole("textbox", { name: "Label" }).closest("form")
    expect(form).toHaveAttribute("action", "/repositories/2001/prototypes/1/share_links")
    expect(form).toHaveAttribute("method", "post")
    expect(container.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf")
    expect(screen.getByRole("textbox")).toHaveAttribute("name", "share_link[label]")
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "100")
    expect(screen.getByRole("combobox")).toHaveValue("seven_days")
  })

  it("uses controlled fields and callbacks without a browser action or CSRF token", () => {
    const submit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault())
    const change = vi.fn()
    const { container } = render(
      <ShareLinksForm
        data={data}
        onSubmit={submit}
        label="Review"
        expiration="never"
        onLabelChange={change}
        onExpirationChange={change}
        error="Invalid label"
      />,
      { wrapper: HubThemeProvider },
    )
    const input = screen.getByRole("textbox")
    expect(input).toHaveValue("Review")
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid label")
    expect(screen.getByRole("combobox")).toHaveValue("never")
    expect(input.closest("form")).not.toHaveAttribute("action")
    expect(container.querySelector('input[name="authenticity_token"]')).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: "Partner review" } })
    expect(change).toHaveBeenCalledOnce()
    fireEvent.submit(input.closest("form")!)
    expect(submit).toHaveBeenCalledOnce()
  })

  it("disables mutations while keeping form contents visible", () => {
    render(
      <ShareLinksForm
        data={data}
        onSubmit={(event) => event.preventDefault()}
        disabled
        fieldsDisabled
        busy
      />,
      { wrapper: HubThemeProvider },
    )
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.getByRole("combobox")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Create share link" })).toBeDisabled()
    expect(screen.getByRole("textbox").closest("form")).toHaveAttribute("aria-busy", "true")
  })

  it("places the required label before its input without helper text, keeping validation separate", () => {
    const { container } = render(
      <ShareLinksForm
        data={data}
        onSubmit={(event) => event.preventDefault()}
        error="Invalid label"
      />,
      { wrapper: HubThemeProvider },
    )
    const fields = container.querySelectorAll(".share-links__field")
    expect(fields).toHaveLength(2)
    expect(fields[0]?.firstElementChild).toBe(screen.getByText(/^Label/))
    expect(fields[0]?.firstElementChild).toHaveTextContent("Label *")
    expect(fields[0]?.children[1]).toContainElement(screen.getByRole("textbox"))
    expect(screen.getByRole("textbox")).toBeRequired()
    expect(screen.queryByText("Required. Up to 100 UTF-8 bytes.")).not.toBeInTheDocument()
    expect(fields[0]?.querySelector(".share-links__validation")).toHaveTextContent("Invalid label")
    expect(fields[1]).toContainElement(screen.getByRole("combobox"))
    expect(screen.getByRole("button").closest(".share-links__form-actions")).not.toBeNull()
  })
})
