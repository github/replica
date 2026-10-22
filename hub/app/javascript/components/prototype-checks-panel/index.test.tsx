import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ChecksPanel } from "./index"
import type { ChecksState, CheckState } from "@utils/prototype-checks/types"

function fixture(): ChecksState & { checks: [CheckState] } {
  return {
    state: "ready",
    checks: [
      {
        id: "review",
        name: "Design review",
        runner: "agent",
        automatic: false,
        status: "completed",
        outcome: "fail",
        summary: "The source review found a component mismatch.",
        runId: "run",
        error: null,
        criteria: [{ id: "usage", status: "fail", evidence: "Wrong component." }],
        findings: [
          {
            id: "usage",
            severity: "error",
            criterionId: "usage",
            title: "Use the approved button",
            description: "Replace the custom button.",
            evidence: "Observed in the changed page.",
            file: "src/page.tsx",
          },
        ],
      },
    ],
  }
}

describe("ChecksPanel", () => {
  it("explains runner-enforced verification gaps and exposes measured source coverage", () => {
    const state = fixture()
    state.checks[0].criteria[0]!.status = "unverified"
    state.checks[0].criteria[0]!.coverageReason = "incomplete"
    state.checks[0].readCoverage = {
      version: 1,
      files: [
        {
          file: "source.tsx",
          required: true,
          status: "partial",
          reason: "partial_read",
          readBytes: 4096,
          totalBytes: 50000,
        },
      ],
    }
    render(
      <ChecksPanel
        state={state}
        error={null}
        busy={false}
        onAction={() => Promise.resolve(false)}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText("Read coverage: 0 of 1 source files")).toBeVisible()
    fireEvent.click(screen.getByText("usage"))
    expect(screen.getByText(/Required source was not fully read/)).toBeVisible()
    fireEvent.click(screen.getByText("Read coverage: 0 of 1 source files"))
    expect(screen.getByText("source.tsx")).toBeVisible()
  })
  it("shows readable result pointers and reveals long saved evidence only for the expanded rule", () => {
    const state = fixture()
    const evidence = "Reviewed the complete source. ".repeat(10).trim()
    state.checks[0].criteria = [
      {
        id: "typing-and-lint-patterns",
        name: "Type safety and lint patterns",
        status: "pass",
        evidence,
      },
      {
        id: "errors-and-async",
        name: "Errors and async behavior",
        status: "fail",
        evidence: "A rejected save promise is not reported.",
      },
    ]
    render(
      <ChecksPanel
        state={state}
        error={null}
        busy={false}
        onAction={() => Promise.resolve(false)}
        onClose={() => {}}
      />,
    )
    const checklist = screen.getByRole("region", { name: "What was checked" })
    expect(within(checklist).getByText("Passed")).toBeVisible()
    expect(within(checklist).getByText("Failed")).toBeVisible()
    expect(screen.getByText(evidence.trim())).not.toBeVisible()
    fireEvent.click(screen.getByText("Type safety and lint patterns"))
    expect(screen.getByText(evidence.trim())).toBeVisible()
    expect(screen.getByText("A rejected save promise is not reported.")).not.toBeVisible()
  })

  it("shows unverified criterion results", () => {
    const state = fixture()
    state.checks[0].criteria = [
      {
        id: "keyboard-and-focus",
        status: "unverified",
        evidence: "- Rendered focus visibility still needs checking.",
      },
    ]
    render(
      <ChecksPanel
        state={state}
        error={null}
        busy={false}
        onAction={() => Promise.resolve(false)}
        onClose={() => {}}
      />,
    )
    const checklist = screen.getByRole("region", { name: "What was checked" })
    expect(within(checklist).getByText("keyboard and focus")).toBeVisible()
    expect(within(checklist).getByText("Needs verification")).toBeVisible()
  })

  it("identifies the missing configuration through an accessible status", () => {
    render(
      <ChecksPanel
        state={{ ...fixture(), state: "unconfigured", checks: [] }}
        error={null}
        busy={false}
        onAction={() => Promise.resolve(false)}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole("status")).toHaveTextContent(".replica/checks.json")
  })

  it("opens an accessible sidebar and focuses its keyboard-accessible close button", () => {
    const onClose = vi.fn()
    render(
      <ChecksPanel
        state={fixture()}
        error={null}
        busy={false}
        onAction={() => Promise.resolve(false)}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole("complementary", { name: "Prototype checks" })).toBeVisible()
    const close = screen.getByRole("button", { name: "Close prototype checks" })
    expect(close).toHaveAttribute("aria-keyshortcuts", "Escape")
    expect(close).toHaveFocus()
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("counts every configured check and enables running unrun checks without page confirmation", () => {
    const state = fixture()
    state.checks.push({
      ...state.checks[0],
      id: "inactive",
      name: "Another check",
      status: "not_run",
      outcome: null,
      summary: null,
      criteria: [],
      findings: [],
    })
    render(
      <ChecksPanel
        state={state}
        error={null}
        busy={false}
        onAction={() => Promise.resolve(false)}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole("status")).toHaveTextContent(/0 of 2 passed/)
    const unrun = screen.getByRole("region", { name: "Another check" })
    expect(within(unrun).getByRole("button", { name: "Run" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Run all" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Confirm page scope" })).not.toBeInTheDocument()
  })
  it("shows failed outcomes and sends only explicitly selected findings to Copilot", async () => {
    const state = fixture()
    state.checks[0].findings.push({
      ...state.checks[0].findings[0]!,
      id: "unselected",
      title: "Another improvement",
    })
    const onAction = vi.fn().mockResolvedValue(true)
    render(
      <ChecksPanel
        state={state}
        error={null}
        busy={false}
        onAction={onAction}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole("status")).toHaveTextContent(/0 of 1 passed/)
    expect(screen.getByText("The source review found a component mismatch.")).toBeVisible()
    fireEvent.click(screen.getByText(/Error: Use the approved button/))
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Use the approved button/ }))
    fireEvent.click(screen.getByRole("button", { name: "Fix selected with Copilot" }))
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({
        action: "fix",
        checkId: "review",
        runId: "run",
        findingIds: ["usage"],
      }),
    )
  })
  it("shows active checks and supports cancellation without pretending checks are complete", () => {
    const state = fixture()
    state.checks[0].status = "running"
    state.checks[0].outcome = null
    state.checks[0].summary = null
    const onAction = vi.fn().mockResolvedValue(true)
    const onClose = vi.fn()
    render(
      <ChecksPanel state={state} error={null} busy={false} onAction={onAction} onClose={onClose} />,
    )
    expect(screen.getByRole("status")).toHaveTextContent(/0 of 1 passed/)
    expect(screen.getByRole("status")).toHaveTextContent(/running/i)
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }))
    expect(onAction).toHaveBeenCalledWith({ action: "cancel", checkIds: ["review"] })
    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })
})
