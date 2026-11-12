import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { SubmitEvent } from "react"
import { describe, expect, it, vi } from "vitest"

import { PrototypeBriefComposer } from "."

const LABEL = "What changes would you like to make?"

describe("PrototypeBriefComposer()", () => {
  it("expands from a keyboard-accessible button and focuses the brief", () => {
    const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault())

    function BranchStory() {
      const [expanded, setExpanded] = useState(false)
      const [value, setValue] = useState("")
      return (
        <form onSubmit={onSubmit}>
          <PrototypeBriefComposer
            variant="branch"
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            onCollapse={() => setExpanded(false)}
            value={value}
            onChange={setValue}
            placeholder={LABEL}
            label={LABEL}
            submitLabel="Create branch"
            branchFrom="Branch from: Welcome"
          />
        </form>
      )
    }

    render(<BranchStory />)
    expect(screen.getByRole("button", { name: "Create branch" })).toBeDisabled()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    const compact = screen.getByRole("button", { name: LABEL })
    compact.focus()
    fireEvent.click(compact)
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveFocus()
    expect(screen.getByText("Branch from: Welcome")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create branch" })).toBeDisabled()

    fireEvent.change(screen.getByRole("textbox", { name: LABEL }), {
      target: { value: "Improve the navigation" },
    })
    expect(screen.getByRole("button", { name: "Create branch" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Create branch" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("collapses on focus leaving the composer without losing the draft", () => {
    function BranchStory() {
      const [expanded, setExpanded] = useState(false)
      const [value, setValue] = useState("")
      return (
        <>
          <form onSubmit={(event) => event.preventDefault()}>
            <PrototypeBriefComposer
              variant="branch"
              expanded={expanded}
              onExpand={() => setExpanded(true)}
              onCollapse={() => setExpanded(false)}
              value={value}
              onChange={setValue}
              placeholder={LABEL}
              label={LABEL}
              submitLabel="Create branch"
              branchFrom="Branch from: Welcome"
            />
          </form>
          <button type="button">Outside composer</button>
        </>
      )
    }

    render(<BranchStory />)
    fireEvent.click(screen.getByRole("button", { name: LABEL }))
    const field = screen.getByRole("textbox", { name: LABEL })
    fireEvent.change(field, { target: { value: "Keep my draft" } })

    const source = screen.getByRole("button", { name: "Branch from: Welcome" })
    fireEvent.blur(field, { relatedTarget: source })
    expect(field).toBeInTheDocument()

    fireEvent.blur(field, {
      relatedTarget: screen.getByRole("button", { name: "Outside composer" }),
    })
    expect(screen.queryByRole("textbox", { name: LABEL })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Keep my draft" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create branch" })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Keep my draft" }))
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveValue("Keep my draft")
    expect(screen.getByRole("textbox", { name: LABEL })).toHaveFocus()
  })

  it("exits the expanded composer on Escape without losing the draft", () => {
    const outsideKeyDown = vi.fn()

    function BranchStory() {
      const [expanded, setExpanded] = useState(false)
      const [value, setValue] = useState("")
      return (
        <div onKeyDown={outsideKeyDown}>
          <form onSubmit={(event) => event.preventDefault()}>
            <PrototypeBriefComposer
              variant="branch"
              expanded={expanded}
              onExpand={() => setExpanded(true)}
              onCollapse={() => setExpanded(false)}
              value={value}
              onChange={setValue}
              placeholder={LABEL}
              label={LABEL}
              submitLabel="Create branch"
              branchFrom="Branch from: Welcome"
            />
          </form>
        </div>
      )
    }

    render(<BranchStory />)
    fireEvent.click(screen.getByRole("button", { name: LABEL }))
    const field = screen.getByRole("textbox", { name: LABEL })
    fireEvent.change(field, { target: { value: "Keep my draft" } })
    fireEvent.keyDown(field, { key: "Escape" })

    expect(screen.queryByRole("textbox", { name: LABEL })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Keep my draft" })).toBeInTheDocument()
    expect(field).not.toHaveFocus()
    expect(outsideKeyDown).not.toHaveBeenCalled()
  })

  it("grows the brief, forwards the details action, and submits with Command+Enter", () => {
    const onChange = vi.fn()
    const onAddDetails = vi.fn()
    const onSubmit = vi.fn((event: SubmitEvent<HTMLFormElement>) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PrototypeBriefComposer
          value="A working prototype"
          onChange={onChange}
          placeholder="Describe the prototype"
          label="What should we create?"
          submitLabel="Create prototype"
          addDetails="Add details"
          onAddDetails={onAddDetails}
        />
      </form>,
    )
    const field = screen.getByRole("textbox", { name: "What should we create?" })
    expect(field).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Add details" }))
    expect(
      screen.getByRole("button", { name: "Add details" }).querySelector(".octicon-plus"),
    ).toBeInTheDocument()
    expect(onAddDetails).toHaveBeenCalledOnce()
    fireEvent.change(field, { target: { value: "A better prototype" } })
    expect(onChange).toHaveBeenCalledWith("A better prototype")
    fireEvent.keyDown(field, { key: "Enter", metaKey: true })
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("shows a pencil for saved details and forwards the edit action", () => {
    const onAddDetails = vi.fn()
    render(
      <PrototypeBriefComposer
        value=""
        onChange={() => undefined}
        placeholder="Describe the prototype"
        label="What should we create?"
        submitLabel="Create prototype"
        addDetails="Edit details"
        hasSavedDetails
        onAddDetails={onAddDetails}
      />,
    )
    const button = screen.getByRole("button", { name: "Edit details" })
    expect(button.querySelector(".octicon-pencil")).toBeInTheDocument()
    expect(button.querySelector(".octicon-plus")).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(onAddDetails).toHaveBeenCalledOnce()
  })
})
