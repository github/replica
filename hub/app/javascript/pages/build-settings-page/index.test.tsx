import { ThemeProvider } from "@primer/react-brand/esm"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { BuildSettingsPage } from "."
import story, { AccessRemoved } from "./stories"

describe("BuildSettingsPage()", () => {
  it("submits the edited whole-MiB limit with explicit confirmation and browser CSRF proof", () => {
    const data = story.args.data
    render(
      <ThemeProvider>
        <BuildSettingsPage data={data} />
      </ThemeProvider>,
    )
    const limit = screen.getByRole("spinbutton", { name: data.limitLabel })
    expect(limit).toHaveAttribute("name", "maximum_package_mib")
    expect(limit).toHaveAttribute("min", "1")
    expect(limit).toHaveAttribute("step", "1")
    expect(limit).toBeRequired()
    expect(limit).toHaveValue(150)
    const confirmation = screen.getByRole("checkbox", { name: data.confirmLabel })
    expect(confirmation).toBeRequired()
    expect(confirmation).not.toBeChecked()
    const form = screen.getByRole("button", { name: data.submitLabel }).closest("form")!
    expect(form).toHaveAttribute("action", "/build_settings")
    expect(form).toHaveAttribute("method", "post")
    expect(form.checkValidity()).toBe(false)

    fireEvent.click(confirmation)
    fireEvent.change(limit, { target: { value: "1.5" } })
    expect(form.checkValidity()).toBe(false)
    fireEvent.change(limit, { target: { value: "0" } })
    expect(form.checkValidity()).toBe(false)
    fireEvent.change(limit, { target: { value: "240" } })

    expect(form.checkValidity()).toBe(true)
    const submitted = new FormData(form)
    expect(submitted.get("maximum_package_mib")).toBe("240")
    expect(submitted.get("confirmed")).toBe("1")
    expect(submitted.get("_method")).toBe("patch")
    expect(submitted.get("authenticity_token")).toBe("storybook-token")
  })

  it("does not expose mutation controls after administrator access is removed", () => {
    const data = AccessRemoved.args!.data!
    render(
      <ThemeProvider>
        <BuildSettingsPage data={data} />
      </ThemeProvider>,
    )

    expect(screen.getByText(data.emptyLabel)).toBeInTheDocument()
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: story.args.data.submitLabel }),
    ).not.toBeInTheDocument()
  })
})
