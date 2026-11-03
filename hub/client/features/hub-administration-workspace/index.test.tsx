import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"

import { HubAdministrationWorkspace } from "."

describe("HubAdministrationWorkspace()", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it.each([false, true])(
    "uses repository navigation and lower Hub links without scope headings, collapsed %s",
    (collapsed) => {
      const { container } = render(
        <HubAdministrationWorkspace
          data={hubAdministrationWorkspaceData}
          defaultNavigationCollapsed={collapsed}
        >
          Deployment content
        </HubAdministrationWorkspace>,
      )
      expect(screen.queryByText("Replica Hub")).not.toBeInTheDocument()
      expect(screen.queryByText("Hub administration")).not.toBeInTheDocument()
      expect(screen.getByRole("navigation", { name: "Security and settings" })).toContainElement(
        screen.getByRole("link", { name: "Hub administrators" }),
      )
      expect(container.querySelector(".octicon-gear")).toBeNull()
      expect(
        screen.getByRole("link", { name: "GitHub App" }).querySelector(".octicon-mark-github"),
      ).not.toBeNull()
      expect(screen.getByRole("link", { name: "Hub administrators" })).toHaveAttribute(
        "aria-current",
        "page",
      )
      expect(screen.getByRole("link", { name: "Security audit" })).not.toHaveAttribute(
        "aria-current",
      )
      expect(screen.getByRole("button", { name: /Choose repository/ })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Account menu for @octocat" })).toBeInTheDocument()
      fireEvent.click(
        screen.getByRole("button", { name: collapsed ? "Expand sidebar" : "Collapse sidebar" }),
      )
      expect(container.querySelector("main")).toHaveAttribute(
        "data-navigation-collapsed",
        String(!collapsed),
      )
    },
  )

  it("omits repository controls for an administrator without repositories", () => {
    render(
      <HubAdministrationWorkspace
        data={{
          ...hubAdministrationWorkspaceData,
          repository: null,
          securityAuditPath: "/security_audit",
        }}
      >
        Deployment content
      </HubAdministrationWorkspace>,
    )
    expect(screen.queryByRole("button", { name: /Choose repository/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Prototypes" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Repositories" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Hub administrators" })).toBeInTheDocument()
  })
})
