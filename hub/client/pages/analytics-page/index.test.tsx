import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { AnalyticsPage } from "."
import story, {
  Configured,
  CustomConfigured,
  CustomFailed,
  CustomMultiple,
  Failed,
  Multiple,
  Paused,
} from "./stories"

describe("AnalyticsPage()", () => {
  it("defaults to new events and selects every event with labeled password inputs", () => {
    render(<AnalyticsPage data={story.args.data} />, { wrapper: HubThemeProvider })
    expect(
      screen.getByRole("heading", { name: "Analytics", level: 1 }).closest("header"),
    ).toHaveClass("repository-page-header")
    expect(
      screen.getByText("No destinations configured. Hub is still recording events."),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page")
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }))
    expect(screen.getByLabelText("When should delivery begin?")).toHaveValue("new")
    expect(screen.getByLabelText("Source write key")).toHaveAttribute("type", "password")
    expect(screen.getByLabelText("Source write key")).toBeRequired()
    for (const event of story.args.data.eventTypes) {
      expect(screen.getByLabelText(event.label)).toBeChecked()
    }
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "mixpanel" } })
    expect(screen.getByLabelText("Service account username")).toHaveAttribute("type", "password")
    expect(screen.getByLabelText("Service account secret")).toBeRequired()
    expect(screen.getByLabelText("Project ID")).toBeRequired()
    expect(screen.getByRole("option", { name: "India" })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "segment" } })
    expect(screen.queryByRole("option", { name: "India" })).not.toBeInTheDocument()
  })

  it("shows editable configuration immediately without revealing credentials or backfilling", () => {
    const data = Configured.args!.data!
    render(<AnalyticsPage data={data} />, { wrapper: HubThemeProvider })
    const secret = screen.getByLabelText("Source write key")
    expect(secret).toHaveValue("")
    expect(secret).not.toBeRequired()
    expect(screen.getByLabelText("Provider")).toBeDisabled()
    expect(screen.queryByLabelText("When should delivery begin?")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Prototype added to gallery")).toBeChecked()
    expect(screen.getByLabelText("Reply added")).not.toBeChecked()
    expect(screen.queryByRole("button", { name: "Edit configuration" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
  })

  it("groups save pause and disconnect without submitting edits through the other actions", () => {
    const data = Configured.args!.data!
    render(<AnalyticsPage data={data} />, { wrapper: HubThemeProvider })
    const card = screen.getByRole("region", { name: "Segment" })
    const pauseForm = within(card).getByRole("button", { name: "Pause" }).closest("form")
    expect(pauseForm).toHaveAttribute("action", data.destinations[0]!.path)
    expect(pauseForm?.querySelector('input[name="operation"]')).toHaveValue("pause")
    const disconnect = within(card).getByRole("button", { name: "Disconnect" })
    const disconnectForm = disconnect.closest("form")
    expect(disconnect).toHaveClass("analytics-page__disconnect")
    expect(disconnectForm).toHaveAttribute("action", data.destinations[0]!.path)
    expect(disconnectForm?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(disconnectForm?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      data.authenticityToken,
    )
    expect(disconnectForm?.parentElement).toBe(pauseForm?.parentElement)
    const save = within(card).getByRole<HTMLButtonElement>("button", { name: "Save configuration" })
    expect(disconnectForm?.parentElement).toContainElement(save)
    expect(save.form).toHaveAttribute("action", data.destinations[0]!.path)
    expect(save.form).toContainElement(within(card).getByLabelText("Source write key"))
    expect(save.form).not.toBe(pauseForm)
    expect(save.form).not.toBe(disconnectForm)
    expect(disconnectForm?.querySelector('input[type="checkbox"]')).toBeNull()
    expect(
      screen.queryByText(/Data region|Last provider acceptance|Terminal failures/),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Delivery is at least once/)).not.toBeInTheDocument()
    expect(screen.queryByText("Connected")).not.toBeInTheDocument()
  })

  it("shows paused and plain-language failure states without delivery statistics", () => {
    const { rerender } = render(<AnalyticsPage data={Paused.args!.data!} />, {
      wrapper: HubThemeProvider,
    })
    expect(screen.getByText("Paused")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument()
    rerender(<AnalyticsPage data={Failed.args!.data!} />)
    expect(screen.getByText("Needs attention")).toBeInTheDocument()
    expect(screen.queryByText(/Terminal failures/)).not.toBeInTheDocument()
    expect(screen.getByText(story.args.data.copy.failureHelp)).toBeInTheDocument()
  })

  it("shows a sanitized custom delivery failure without response text", () => {
    render(<AnalyticsPage data={CustomFailed.args!.data!} />, { wrapper: HubThemeProvider })
    expect(
      screen.getByText("The response did not match the configured confirmation field and value."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/private provider response/)).not.toBeInTheDocument()
  })

  it("offers custom HTTP after both built-in providers are configured", () => {
    render(<AnalyticsPage data={Multiple.args!.data!} />, { wrapper: HubThemeProvider })
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }))
    const added = screen.getByRole("region", { name: "Add destination" })
    expect(within(added).getByLabelText("Provider")).toHaveValue("custom")
    expect(within(added).queryByLabelText("Region")).not.toBeInTheDocument()
    expect(
      within(added).queryByText(story.args.data.copy.customHeaderRetention),
    ).not.toBeInTheDocument()
    expect(within(added).getByLabelText("Destination name")).toBeRequired()
    expect(within(added).getByLabelText("Public HTTPS URL")).toHaveAttribute("type", "url")
    expect(
      JSON.parse(within(added).getByLabelText<HTMLTextAreaElement>("Headers (JSON object)").value),
    ).toEqual({})
    expect(within(added).getByLabelText("Headers (JSON object)").parentElement?.className).toMatch(
      /Textarea-wrapper--monospace/,
    )
    expect(
      JSON.parse(
        within(added).getByLabelText<HTMLTextAreaElement>("Request body (JSON template)").value,
      ),
    ).toEqual({
      event: { $field: "event_name" },
      event_id: { $field: "event_id" },
      properties: { $field: "properties" },
    })
    expect(
      within(added).getByLabelText("Request body (JSON template)").parentElement?.className,
    ).toMatch(/Textarea-wrapper--monospace/)
    fireEvent.click(within(added).getByRole("button", { name: "Add secret" }))
    fireEvent.change(within(added).getByLabelText("Secret name"), {
      target: { value: "api_token" },
    })
    fireEvent.change(within(added).getByLabelText("Secret value"), {
      target: { value: "new-api-token" },
    })
    const form = within(added).getByRole<HTMLButtonElement>("button", {
      name: "Save configuration",
    }).form!
    expect(new FormData(form).get("destination[provider]")).toBe("custom")
    expect(new FormData(form).get("destination[secrets][0][name]")).toBe("api_token")
    expect(new FormData(form).get("destination[secrets][0][value]")).toBe("new-api-token")
    expect(new FormData(form).get("destination[headers]")).toBe("{}")
    expect(within(added).getByLabelText("When should delivery begin?")).toHaveValue("new")
    expect(within(added).getByText(/Hub retries some failures/)).toBeInTheDocument()
  })

  it("keeps multiple visible configurations and new destination fields independent", () => {
    const { container } = render(<AnalyticsPage data={Configured.args!.data!} />, {
      wrapper: HubThemeProvider,
    })
    const segment = screen.getByRole("region", { name: "Segment" })
    fireEvent.change(within(segment).getByLabelText("Region"), { target: { value: "eu" } })
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }))
    const added = screen.getByRole("region", { name: "Add destination" })
    expect(within(added).getByLabelText("Provider")).toHaveValue("mixpanel")
    expect(within(added).getByLabelText("Region")).toHaveValue("us")
    expect(within(segment).getByLabelText("Region")).toHaveValue("eu")
    expect(within(added).getByLabelText("When should delivery begin?")).toHaveValue("new")
    expect(within(segment).queryByLabelText("When should delivery begin?")).not.toBeInTheDocument()
    expect(within(added).getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("cancels only the new destination and restores the heading action", () => {
    render(<AnalyticsPage data={Configured.args!.data!} />, { wrapper: HubThemeProvider })
    const add = screen.getByRole("button", { name: "Add destination" })
    expect(add.querySelector("svg.octicon-plus")).toBeInTheDocument()
    expect(add.parentElement).toContainElement(
      screen.getByRole("heading", { name: "Destinations" }),
    )
    const segment = screen.getByRole("region", { name: "Segment" })
    fireEvent.change(within(segment).getByLabelText("Region"), { target: { value: "eu" } })
    fireEvent.click(add)
    const added = screen.getByRole("region", { name: "Add destination" })
    fireEvent.change(within(added).getByLabelText("Service account secret"), {
      target: { value: "unsaved-secret" },
    })
    fireEvent.click(within(added).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("region", { name: "Add destination" })).not.toBeInTheDocument()
    expect(within(segment).getByLabelText("Region")).toHaveValue("eu")
    expect(add).toHaveFocus()
    fireEvent.click(add)
    expect(screen.getByLabelText("Service account secret")).toHaveValue("")
    expect(screen.getByLabelText("When should delivery begin?")).toHaveValue("new")
  })

  it("submits named custom secrets and JSON settings without exposing saved values", () => {
    const data = CustomConfigured.args!.data!
    render(<AnalyticsPage data={data} />, { wrapper: HubThemeProvider })
    const card = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    const form = within(card).getByRole<HTMLButtonElement>("button", {
      name: "Save configuration",
    }).form!
    expect(within(card).getByLabelText("Provider")).toBeDisabled()
    expect(form.querySelector('input[name="destination[provider]"]')).toHaveValue("custom")
    expect(within(card).queryByLabelText("Region")).not.toBeInTheDocument()
    expect(within(card).queryByLabelText("When should delivery begin?")).not.toBeInTheDocument()
    expect(within(card).getByLabelText("Secret value")).toHaveValue("")
    expect(within(card).getByLabelText("Secret value")).not.toBeRequired()
    const headers = within(card).getByLabelText<HTMLTextAreaElement>("Headers (JSON object)")
    expect(JSON.parse(headers.value)).toEqual({
      Authorization: { $secret: "api_token" },
      "X-Workspace": { $keep: true },
    })
    expect(within(card).getByText(data.copy.customHeaderRetention)).toBeInTheDocument()
    expect(card).not.toHaveTextContent("stored-header-value")
    expect(within(card).getByLabelText("Expected JSON value")).toHaveValue("true")
    expect(within(card).getByLabelText("Redacted sample request body")).toHaveTextContent(
      '"credential": "[redacted]"',
    )
    expect(within(card).getByLabelText("Redacted sample request body")).toHaveTextContent(
      '"event_id": "00000000-0000-4000-8000-000000000001"',
    )
    expect(new FormData(form).get("destination[secrets][0][name]")).toBe("api_token")
    expect(new FormData(form).get("destination[secrets][0][value]")).toBe("")
    expect(new FormData(form).get("destination[success_value]")).toBe("true")
    expect(new FormData(form).has("destination[history]")).toBe(false)
  })

  it("submits only the named custom secrets still present after a removal", () => {
    render(<AnalyticsPage data={CustomConfigured.args!.data!} />, { wrapper: HubThemeProvider })
    const card = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    fireEvent.click(within(card).getByRole("button", { name: "Add secret" }))
    fireEvent.click(within(card).getByRole("button", { name: "Cancel Secret name api_token" }))
    fireEvent.change(within(card).getByLabelText("Secret name"), {
      target: { value: "replacement_token" },
    })
    fireEvent.change(within(card).getByLabelText("Secret value"), {
      target: { value: "new-value" },
    })
    const form = within(card).getByRole<HTMLButtonElement>("button", {
      name: "Save configuration",
    }).form!
    expect(new FormData(form).getAll("destination[secrets][0][name]")).toEqual([
      "replacement_token",
    ])
    expect(new FormData(form).get("destination[secrets][0][value]")).toBe("new-value")
    expect(new FormData(form).has("destination[secrets][1][name]")).toBe(false)
  })

  it("redacts typed secrets in the sample and hides invalid JSON without echoing it", () => {
    render(<AnalyticsPage data={CustomConfigured.args!.data!} />, { wrapper: HubThemeProvider })
    const card = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    const value = within(card).getByLabelText("Secret value")
    const body = within(card).getByLabelText("Request body (JSON template)")
    const preview = within(card).getByLabelText("Redacted sample request body")
    fireEvent.change(value, { target: { value: "private-key-123" } })
    fireEvent.change(body, {
      target: {
        value:
          '{"token":{"$secret":"api_token"},"literal":"Bearer private-key-123","repo":{"$field":"repository_id"},"actor":{"$field":"actor_id"}}',
      },
    })
    expect(preview).toHaveTextContent('"token": "[redacted]"')
    expect(preview).toHaveTextContent("Bearer [redacted]")
    expect(preview).toHaveTextContent('"repo": 2001')
    expect(preview).toHaveTextContent('"actor": "example-actor"')
    expect(preview).not.toHaveTextContent("private-key-123")
    fireEvent.change(body, { target: { value: '{"token":"private-key-123"' } })
    expect(preview).toHaveTextContent("Preview unavailable. Check the JSON body.")
    expect(preview).not.toHaveTextContent("private-key-123")
  })

  it("offers pending retention only for authentication changes to the same recipient", () => {
    render(<AnalyticsPage data={CustomConfigured.args!.data!} />, { wrapper: HubThemeProvider })
    const card = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    const form = within(card).getByRole<HTMLButtonElement>("button", {
      name: "Save configuration",
    }).form!
    const keep = "Same recipient; keep pending events after changing authentication"
    expect(within(card).queryByLabelText(keep)).not.toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText("Secret value"), {
      target: { value: "new-secret" },
    })
    fireEvent.click(within(card).getByLabelText(keep))
    expect(new FormData(form).get("destination[keep_pending]")).toBe("1")
    const endpoint = within(card).getByLabelText("Public HTTPS URL")
    fireEvent.change(endpoint, { target: { value: "https://new.example.com/collect" } })
    expect(within(card).queryByLabelText(keep)).not.toBeInTheDocument()
    expect(new FormData(form).has("destination[keep_pending]")).toBe(false)
    fireEvent.change(endpoint, { target: { value: "https://events.example.com/collect" } })
    expect(within(card).getByLabelText(keep)).not.toBeChecked()
    const body = within(card).getByLabelText<HTMLTextAreaElement>("Request body (JSON template)")
    const originalBody = body.value
    fireEvent.change(body, { target: { value: '{"new":"recipient"}' } })
    expect(within(card).queryByLabelText(keep)).not.toBeInTheDocument()
    fireEvent.change(body, { target: { value: originalBody } })
    const headers = within(card).getByLabelText("Headers (JSON object)")
    fireEvent.change(headers, {
      target: { value: '{"Authorization":{"$secret":"api_token"},"X-Workspace":"other"}' },
    })
    expect(within(card).queryByLabelText(keep)).not.toBeInTheDocument()
  })

  it("never offers retention for routing headers with auth-like names", () => {
    const baseline = CustomConfigured.args!.data!
    const destination = baseline.destinations[0]!
    if (destination.provider !== "custom") throw new Error("Expected a custom destination")
    const saved = {
      ...destination.customConfig.headers,
      "X-Token-Tenant": { $keep: true as const },
      "X-Author-Version": { $keep: true as const },
      "X-API-Key": { $keep: true as const },
    }
    render(
      <AnalyticsPage
        data={{
          ...baseline,
          destinations: [
            { ...destination, customConfig: { ...destination.customConfig, headers: saved } },
          ],
        }}
      />,
      { wrapper: HubThemeProvider },
    )
    const card = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    const headers = within(card).getByLabelText("Headers (JSON object)")
    const secret = within(card).getByLabelText("Secret value")
    const keep = "Same recipient; keep pending events after changing authentication"
    fireEvent.change(secret, { target: { value: "rotated-secret" } })
    expect(within(card).getByLabelText(keep)).toBeInTheDocument()

    for (const routingHeader of ["X-Token-Tenant", "X-Author-Version"]) {
      fireEvent.change(headers, {
        target: { value: JSON.stringify({ ...saved, [routingHeader]: "new-recipient" }) },
      })
      expect(within(card).queryByLabelText(keep)).not.toBeInTheDocument()
    }
    fireEvent.change(secret, { target: { value: "" } })
    fireEvent.change(headers, {
      target: { value: JSON.stringify({ ...saved, "X-API-Key": "rotated" }) },
    })
    expect(within(card).getByLabelText(keep)).toBeInTheDocument()
  })

  it("keeps named custom cards and their form fields independent", () => {
    const { container } = render(<AnalyticsPage data={CustomMultiple.args!.data!} />, {
      wrapper: HubThemeProvider,
    })
    const product = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    const archive = screen.getByRole("region", { name: "Custom HTTP: Build archive" })
    fireEvent.change(within(product).getByLabelText("Destination name"), {
      target: { value: "Product events new" },
    })
    expect(within(archive).getByLabelText("Destination name")).toHaveValue("Build archive")
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }))
    const added = screen.getByRole("region", { name: "Add destination" })
    expect(within(added).getByRole("option", { name: "Custom HTTP" })).toBeInTheDocument()
    fireEvent.change(within(added).getByLabelText("Provider"), {
      target: { value: "custom" },
    })
    expect(within(added).getByLabelText("Destination name")).toHaveValue("")
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("shows custom delivery failure without changing the disconnect action", () => {
    render(<AnalyticsPage data={CustomFailed.args!.data!} />, { wrapper: HubThemeProvider })
    const card = screen.getByRole("region", { name: "Custom HTTP: Product events" })
    expect(within(card).getByText("Needs attention")).toBeInTheDocument()
    expect(
      within(card).getByRole("button", { name: "Disconnect" }).closest("form"),
    ).toContainElement(within(card).getByDisplayValue("delete"))
  })
})
