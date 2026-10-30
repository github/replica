import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { MentionProvider } from "@components/mention-provider"
import type { MentionSource } from "@hooks/use-mention-source/context"

import { MentionInput } from "."

const copy = {
  suggestions: "Mention suggestions",
  error: "Unavailable",
  loading: "Loading",
  empty: "No matches",
  retry: "Retry",
  limit: "Each message can mention at most 10 distinct people.",
}

function Composer({ load, submit }: { load: MentionSource["load"]; submit: () => void }) {
  const [value, setValue] = useState("")
  return (
    <MentionProvider source={{ load, copy }}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <MentionInput
          aria-label="Comment"
          value={value}
          onValueChange={setValue}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
      </form>
    </MentionProvider>
  )
}

describe("MentionInput()", () => {
  it("blocks an eleventh distinct login and accepts ten per message", () => {
    render(<Composer load={vi.fn().mockResolvedValue([])} submit={vi.fn()} />)
    const input = screen.getByRole("textbox")
    const ten = Array.from({ length: 10 }, (_, index) => `@person${index}`).join(" ")
    fireEvent.change(input, { target: { value: `${ten} @eleventh ` } })
    expect(input).toBeInvalid()
    expect(screen.getByRole("alert")).toHaveTextContent(copy.limit)
    fireEvent.change(input, { target: { value: `${ten} ` } })
    expect(input).toBeValid()
  })
  it("inserts a selected login without submitting and preserves surrounding text", async () => {
    const submit = vi.fn()
    const load = vi.fn().mockResolvedValue([{ githubId: 1002, login: "mona", avatarUrl: null }])
    render(<Composer load={load} submit={submit} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Please @mo" } })
    await screen.findByRole("option", { name: "@mona" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input).toHaveValue("Please @mona ")
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(submit).toHaveBeenCalledOnce()
  })

  it("reports lookup failure and supports retry without discarding text", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([])
    render(<Composer load={load} submit={vi.fn()} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "@mo" } })
    await screen.findByRole("alert")
    expect(input).toHaveValue("@mo")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("No matches")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("does not look up email addresses and Escape dismisses autocomplete", async () => {
    const load = vi.fn().mockResolvedValue([{ githubId: 1002, login: "mona", avatarUrl: null }])
    render(<Composer load={load} submit={vi.fn()} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "person@mona" } })
    expect(load).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: "@mona" } })
    await screen.findByRole("option")
    fireEvent.keyDown(input, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
    expect(input).toHaveValue("@mona")
  })

  it("keeps Retry reachable by keyboard and preserves the draft when activating it", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([])
    const submit = vi.fn()
    render(<Composer load={load} submit={submit} />)
    const input = screen.getByRole("textbox")
    input.focus()
    fireEvent.change(input, { target: { value: "Please review @mo" } })
    const retry = await screen.findByRole("button", { name: "Retry" })
    fireEvent.keyDown(input, { key: "Tab" })
    expect(retry).toHaveFocus()
    expect(retry).toBeInTheDocument()
    fireEvent.keyDown(retry, { key: "Tab", shiftKey: true })
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: "Tab" })
    expect(retry).toHaveFocus()
    fireEvent.click(retry)
    await screen.findByText("No matches")
    expect(input).toHaveFocus()
    expect(input).toHaveValue("Please review @mo")
    expect(load).toHaveBeenCalledTimes(2)
    expect(submit).not.toHaveBeenCalled()
  })

  it("dismisses the failed popup when focus leaves its input and controls", async () => {
    const load = vi.fn().mockRejectedValue(new Error("offline"))
    render(<Composer load={load} submit={vi.fn()} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "@mo" } })
    const retry = await screen.findByRole("button", { name: "Retry" })
    fireEvent.keyDown(input, { key: "Tab" })
    fireEvent.blur(retry, { relatedTarget: document.body })
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
    expect(input).toHaveValue("@mo")
  })

  it("returns focus to the composer when Escape dismisses the focused Retry control", async () => {
    const submit = vi.fn()
    render(<Composer load={vi.fn().mockRejectedValue(new Error("offline"))} submit={submit} />)
    const input = screen.getByRole("textbox")
    input.focus()
    fireEvent.change(input, { target: { value: "@mo" } })
    const retry = await screen.findByRole("button", { name: "Retry" })
    fireEvent.keyDown(input, { key: "Tab" })
    expect(retry).toHaveFocus()
    fireEvent.keyDown(retry, { key: "Escape" })
    expect(input).toHaveFocus()
    expect(input).toHaveValue("@mo")
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })
})
