import { ThemeProvider } from "@primer/react-brand/esm"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { NotificationSettingsPage } from "."
import story, { Administrator, Single } from "./stories"

describe("NotificationSettingsPage()", () => {
  it("submits a personal opt-out without changing the Inbox or supplying another recipient", () => {
    const data = story.args.data
    render(
      <ThemeProvider>
        <NotificationSettingsPage data={data} />
      </ThemeProvider>,
    )
    const checkbox = screen.getByRole("checkbox", { name: data.enabledLabel })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    const form = screen.getByRole("button", { name: data.saveLabel }).closest("form")!
    const fields = new FormData(form)
    expect(fields.getAll("enabled")).toEqual(["0"])
    expect(fields.get("_method")).toBe("patch")
    expect(fields.get("authenticity_token")).toBe(data.authenticityToken)
    expect(fields.has("recipient_id")).toBe(false)
    expect(screen.queryByRole("heading", { name: "Hub delivery" })).not.toBeInTheDocument()
  })

  it("offers a scoped unmute form for a saved prototype", () => {
    const data = Single.args!.data!
    render(
      <ThemeProvider>
        <NotificationSettingsPage data={data} />
      </ThemeProvider>,
    )
    const mute = data.mutes[0]!
    const form = screen
      .getByRole("button", { name: `${mute.unmuteLabel} ${mute.prototype}` })
      .closest("form")!
    expect(form).toHaveAttribute("action", mute.submitPath)
    expect(new FormData(form).get("muted")).toBe("0")
    expect(screen.getByRole("link", { name: mute.prototype })).toHaveAttribute("href", mute.path)
  })

  it("requires explicit confirmation before changing delivery for everyone", () => {
    const data = Administrator.args!.data!
    render(
      <ThemeProvider>
        <NotificationSettingsPage data={data} />
      </ThemeProvider>,
    )
    const administration = data.administration!
    expect(screen.getByRole("checkbox", { name: administration.confirmLabel })).toBeRequired()
    const form = screen.getByRole("button", { name: administration.submitLabel }).closest("form")!
    expect(form).toHaveAttribute("action", administration.submitPath)
    expect(new FormData(form).get("operation")).toBe("enable")
  })
})
