import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { WorkflowInstallation } from "."

describe("WorkflowInstallation()", () => {
  it("submits the installation request when a writer can install the workflow", () => {
    render(
      <WorkflowInstallation
        authenticityToken="csrf-token"
        data={{
          actionLabel: "Open installation pull request",
          createPath: "/repositories/2001/workflow_installation",
          description: "Open a pull request that adds the Replica workflow.",
          heading: "Prototype workflow file missing",
          state: "installable",
        }}
      />,
    )

    expect(screen.getByRole("form")).toHaveAttribute(
      "action",
      "/repositories/2001/workflow_installation",
    )
    expect(
      screen.getByRole("heading", { name: "Prototype workflow file missing" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Open installation pull request" }),
    ).toBeInTheDocument()
  })

  it("explains when a repository writer is required", () => {
    render(
      <WorkflowInstallation
        authenticityToken="csrf-token"
        data={{
          description: "A repository writer must install the Replica workflow.",
          documentationLabel: "Learn about the workflow",
          documentationUrl: "https://github.com/github/replica#prototype-build-workflow",
          heading: "Prototype workflow file missing",
          state: "requiresWriter",
        }}
      />,
    )

    expect(
      screen.getByText("A repository writer must install the Replica workflow."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Learn about the workflow" })).toHaveAttribute(
      "href",
      "https://github.com/github/replica#prototype-build-workflow",
    )
  })

  it("does not offer the installation guide when a writer must update an existing workflow", () => {
    render(
      <WorkflowInstallation
        authenticityToken="csrf-token"
        data={{
          description: "A repository writer must review the build Action update.",
          heading: "Build Action update available",
          state: "requiresWriter",
        }}
      />,
    )

    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("submits an update request when the repository workflow differs", () => {
    render(
      <WorkflowInstallation
        authenticityToken="csrf-token"
        data={{
          actionLabel: "Open workflow update pull request",
          createPath: "/repositories/2001/workflow_installation",
          description:
            "The Replica build Action has changed. Review a pull request that replaces the installed workflow with the latest version.",
          heading: "Build Action update available",
          state: "updatable",
        }}
      />,
    )

    expect(
      screen.getByRole("button", { name: "Open workflow update pull request" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Build Action update available" }),
    ).toBeInTheDocument()
  })

  it("explains when the Hub is not configured for installation", () => {
    render(
      <WorkflowInstallation
        authenticityToken="csrf-token"
        data={{
          description: "The Hub operator must configure the pinned Replica build action.",
          heading: "Prototype workflow",
          state: "unavailable",
        }}
      />,
    )

    expect(
      screen.getByText("The Hub operator must configure the pinned Replica build action."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
