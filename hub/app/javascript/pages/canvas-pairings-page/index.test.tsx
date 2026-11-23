import { ThemeProvider } from "@primer/react-brand/esm"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CanvasPairingsPage } from "."
import type { CanvasPairingsPageData } from "./types"

describe("CanvasPairingsPage()", () => {
  it("asks the reviewer to match the code before approving a repository connection", () => {
    const data: CanvasPairingsPageData = {
      kind: "approval",
      pageTitle: "Connect Replica canvas",
      productName: "Replica Hub",
      heading: "Connect Replica canvas",
      description: "Confirm this connection before letting Copilot access your Hub reviews.",
      codeLabel: "Connection code",
      codeInstruction: "Only approve if this code matches the one shown in Copilot.",
      code: "ABCDEF1234",
      repositoryLabel: "Repository",
      repository: "local/example",
      permissions:
        "The connection also lets Copilot add the learnings this repository's administrators accepted to your prompts.",
      learningsConsentVersion: "1",
      expiration: "Connections expire after seven days. You can revoke access from",
      connectionsLabel: "Canvas connections",
      connectionsPath: "/canvas/connections",
      approveLabel: "Approve connection",
      approvePath: "/canvas/pair/ABCDEF1234",
      cancelLabel: "Cancel",
      cancelPath: "/repositories",
      authenticityToken: "csrf-token",
    }

    render(
      <ThemeProvider>
        <CanvasPairingsPage data={data} />
      </ThemeProvider>,
    )

    expect(screen.getByRole("heading", { name: "Connect Replica canvas" })).toBeInTheDocument()
    expect(screen.getByText("ABCDEF1234")).toBeInTheDocument()
    expect(screen.getByText("local/example")).toBeInTheDocument()
    expect(screen.getByText(data.permissions)).toBeInTheDocument()
    const form = screen.getByRole("button", { name: "Approve connection" }).closest("form")
    expect(form).toHaveAttribute("action", "/canvas/pair/ABCDEF1234")
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(form?.querySelector('input[name="learnings_consent_version"]')).toHaveValue("1")
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/repositories")
  })

  it("shows revocable connections after approval", () => {
    const data: CanvasPairingsPageData = {
      kind: "connections",
      pageTitle: "Canvas connections",
      productName: "Replica Hub",
      heading: "Canvas connections",
      description: "Review the repositories connected to your Copilot canvases.",
      authenticityToken: "csrf-token",
      emptyLabel: "No active connections.",
      backLabel: "Back to repositories",
      backPath: "/repositories",
      revokeLabel: "Revoke",
      notice: "Replica canvas connected to local/example.",
      grants: [
        {
          id: 1,
          repository: "local/example",
          expiresLabel: "Expires October 1, 2026 at 12:00 UTC",
          revokePath: "/canvas/connections/1",
        },
      ],
    }

    render(
      <ThemeProvider>
        <CanvasPairingsPage data={data} />
      </ThemeProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("connected to local/example")
    expect(screen.getByText("local/example")).toBeInTheDocument()
    const form = screen.getByRole("button", { name: "Revoke" }).closest("form")
    expect(form).toHaveAttribute("action", "/canvas/connections/1")
    expect(form?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue("csrf-token")
    expect(screen.getByRole("link", { name: "Back to repositories" })).toHaveAttribute(
      "href",
      "/repositories",
    )
  })

  it("shows the task scope and deadline with separate protected approval and denial forms", () => {
    const data: CanvasPairingsPageData = {
      kind: "approval",
      pageTitle: "Approve prototype task",
      productName: "Replica Hub",
      heading: "Approve prototype task",
      description: "Approve access for this task.",
      codeLabel: "Connection code",
      codeInstruction: "Compare this code with the task request.",
      code: "TASK123456",
      repositoryLabel: "Repository",
      repository: "github/prototype",
      branchLabel: "Branch",
      branch: "prototype/welcome",
      approvalDeadline: "Connect by November 10, 2026 at 10:00 UTC.",
      permissions: "Access is limited to this repository and branch.",
      expiration: "Access expires 24 hours after approval. Manage access from",
      connectionsLabel: "Task connections",
      connectionsPath: "/tasks/connections",
      approveLabel: "Approve task",
      approvePath: "/tasks/approve/TASK123456",
      cancelLabel: "Deny request",
      cancelPath: "/tasks/approve/TASK123456",
      cancelMethod: "delete",
      authenticityToken: "task-csrf-token",
    }

    const { container } = render(
      <ThemeProvider>
        <CanvasPairingsPage data={data} />
      </ThemeProvider>,
    )

    expect(screen.getByText(data.repository)).toBeInTheDocument()
    expect(screen.getByText(data.branch!)).toBeInTheDocument()
    expect(screen.getByText(data.approvalDeadline!)).toBeInTheDocument()
    const approvalForm = screen.getByRole("button", { name: data.approveLabel }).closest("form")
    const denialForm = screen.getByRole("button", { name: data.cancelLabel }).closest("form")
    expect(approvalForm).toHaveAttribute("action", data.approvePath)
    expect(approvalForm).toHaveAttribute("method", "post")
    expect(approvalForm?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      data.authenticityToken,
    )
    expect(approvalForm?.querySelector('input[name="_method"]')).toBeNull()
    expect(denialForm).not.toBe(approvalForm)
    expect(denialForm).toHaveAttribute("action", data.cancelPath)
    expect(denialForm).toHaveAttribute("method", "post")
    expect(denialForm?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      data.authenticityToken,
    )
    expect(denialForm?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(container.querySelector('input[name="learnings_consent_version"]')).toBeNull()
  })

  it("shows task branch and expiry with a protected task revocation form", () => {
    const data: CanvasPairingsPageData = {
      kind: "connections",
      pageTitle: "Task connections",
      productName: "Replica Hub",
      heading: "Task connections",
      description: "Manage approved task access.",
      authenticityToken: "task-csrf-token",
      emptyLabel: "No active task connections.",
      backLabel: "Back to repositories",
      backPath: "/repositories",
      revokeLabel: "Revoke task",
      notice: null,
      grants: [
        {
          id: 42,
          repository: "github/prototype",
          branch: "prototype/welcome",
          expiresLabel: "Expires November 11, 2026 at 10:00 UTC.",
          revokePath: "/tasks/connections/42",
        },
      ],
    }

    render(
      <ThemeProvider>
        <CanvasPairingsPage data={data} />
      </ThemeProvider>,
    )

    const grant = data.grants[0]!
    expect(screen.getByText(grant.repository)).toBeInTheDocument()
    expect(screen.getByText(grant.branch!)).toBeInTheDocument()
    expect(screen.getByText(grant.expiresLabel)).toBeInTheDocument()
    const form = screen.getByRole("button", { name: data.revokeLabel }).closest("form")
    expect(form).toHaveAttribute("action", grant.revokePath)
    expect(form).toHaveAttribute("method", "post")
    expect(form?.querySelector('input[name="_method"]')).toHaveValue("delete")
    expect(form?.querySelector('input[name="authenticity_token"]')).toHaveValue(
      data.authenticityToken,
    )
  })
})
