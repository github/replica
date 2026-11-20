import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useMemo, useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { MentionProvider } from "@components/mention-provider"
import type { MentionCandidate, MentionSource } from "@hooks/use-mention-source/context"
import { isSubmitShortcut } from "@utils/is-submit-shortcut"

import { MentionInput } from "."

const copy = {
  suggestions: "Mention suggestions",
  error: "Unavailable",
  loading: "Loading",
  empty: "No matches",
  retry: "Retry",
  limit: "Each message can mention at most 10 distinct people.",
}

function Composer({
  load,
  searchesByQuery,
  submit,
}: {
  load: MentionSource["load"]
  searchesByQuery?: boolean
  submit: () => void
}) {
  const [value, setValue] = useState("")
  const source = useMemo(() => ({ load, copy, searchesByQuery }), [load, searchesByQuery])
  return (
    <MentionProvider source={source}>
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
            if (isSubmitShortcut(event.nativeEvent, { allowPlainEnter: true })) {
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
  it("finds and inserts a login outside the default list without submitting", async () => {
    const submit = vi.fn()
    const collaborators = [
      ...Array.from({ length: 20 }, (_, index) => ({
        githubId: index + 1,
        login: `reviewer-${index}`,
        avatarUrl: null,
      })),
      { githubId: 1002, login: "mona", avatarUrl: null },
    ]
    function load(query = "") {
      return Promise.resolve(
        collaborators.filter(({ login }) => login.includes(query)).slice(0, 20),
      )
    }
    render(<Composer load={load} submit={submit} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Please @" } })
    await screen.findByRole("option", { name: "@reviewer-0" })
    expect(screen.queryByRole("option", { name: "@mona" })).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: "Please @mo" } })
    await screen.findByRole("option", { name: "@mona" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input).toHaveValue("Please @mona ")
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(submit).toHaveBeenCalledOnce()
  })

  it("keeps suggestions open through a managed username suffix and inserts the complete account", async () => {
    const submit = vi.fn()
    const load = vi.fn().mockResolvedValue([
      { githubId: 1002, login: "mona_enterprise", avatarUrl: null },
      { githubId: 1001, login: "octocat", avatarUrl: null },
    ])
    render(<Composer load={load} submit={submit} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Please @mona_ent" } })
    await screen.findByRole("option", { name: "@mona_enterprise" })
    expect(screen.queryByRole("option", { name: "@octocat" })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input).toHaveValue("Please @mona_enterprise ")
    expect(submit).not.toHaveBeenCalled()
    expect(load).toHaveBeenLastCalledWith("mona_ent", expect.any(AbortSignal))
  })

  it("filters a reused collaborator list before limiting suggestions", async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue([
      ...Array.from({ length: 8 }, (_, index) => ({
        login: `reviewer-${index}`,
        avatarUrl: null,
      })),
      { login: "alMond", avatarUrl: null },
    ])
    render(<Composer load={load} searchesByQuery={false} submit={vi.fn()} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Please @" } })
    await act(() => vi.runOnlyPendingTimersAsync())
    expect(screen.getAllByRole("option")).toHaveLength(8)

    fireEvent.change(input, { target: { value: "Please @mon" } })
    expect(screen.queryAllByRole("option", { name: /reviewer-/ })).toHaveLength(0)
    await act(() => vi.runOnlyPendingTimersAsync())
    expect(screen.getByRole("option")).toHaveAccessibleName("@alMond")
    expect(load).toHaveBeenCalledOnce()

    fireEvent.keyDown(input, { key: "Enter" })
    expect(input).toHaveValue("Please @alMond ")
  })

  it("blocks plain Enter during lookup without blocking Tab or the submit shortcut", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
    let finishEarlier!: (people: MentionCandidate[]) => void
    let finishCurrent!: (people: MentionCandidate[]) => void
    const earlier = new Promise<MentionCandidate[]>((resolve) => (finishEarlier = resolve))
    const current = new Promise<MentionCandidate[]>((resolve) => (finishCurrent = resolve))
    const load = vi.fn((query?: string) => (query === "mon" ? current : earlier))
    const submit = vi.fn()
    render(<Composer load={load} submit={submit} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "@mo" } })
    await waitFor(() => expect(load).toHaveBeenCalledOnce())
    fireEvent.change(input, { target: { value: "@mon" } })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))

    fireEvent.keyDown(input, { key: "Enter" })
    expect(submit).not.toHaveBeenCalled()
    expect(input).toHaveValue("@mon")
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true)
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })
    expect(submit).toHaveBeenCalledOnce()

    finishCurrent([{ login: "mona-current", avatarUrl: null }])
    await screen.findByRole("option", { name: "@mona-current" })

    await act(async () => {
      finishEarlier([{ login: "mona-old", avatarUrl: null }])
      await earlier
    })
    expect(screen.getByRole("option", { name: "@mona-current" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "@mona-old" })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: "@mona" } })
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
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
