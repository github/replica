import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { hubAdministrationWorkspaceData } from "@/storybook/fixtures/hub-administration"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

import { RepositoryNavigation } from "."

describe("RepositoryNavigation()", () => {
  it.each([false, true])(
    "places Welcome first below the repository selector, collapsed %s",
    (collapsed) => {
      const data = {
        ...prototypeWorkspaceData,
        welcomeLabel: "Welcome",
        welcomePath: "/welcome",
        selectedSection: "welcome" as const,
      }
      const { container, rerender } = render(
        <RepositoryNavigation
          collapsed={collapsed}
          onCollapsedChange={() => undefined}
          data={data}
        />,
      )
      const welcome = screen.getByRole("link", { name: "Welcome" })
      expect(container.querySelector(".repository-navigation__list a")).toBe(welcome)
      expect(welcome).toHaveAttribute("href", "/welcome")
      expect(welcome).toHaveAttribute("aria-current", "page")

      rerender(
        <RepositoryNavigation
          collapsed={collapsed}
          onCollapsedChange={() => undefined}
          data={{ ...data, welcomePath: null }}
        />,
      )
      expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
      expect(screen.getByRole("link", { name: "Prototypes" })).toBeInTheDocument()
    },
  )

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

  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])(
    "groups one audit with Hub links above collapse and account, collapsed %s",
    (collapsed) => {
      const { container } = render(
        <RepositoryNavigation
          collapsed={collapsed}
          onCollapsedChange={() => undefined}
          data={{
            ...prototypeWorkspaceData,
            analyticsLabel: "Analytics",
            analyticsPath: "/repositories/2001/analytics",
            administrationLinks: hubAdministrationWorkspaceData.administrationLinks,
            selectedSection: "security",
          }}
        />,
      )
      const links = [...container.querySelectorAll("aside a")].map((link) =>
        link.textContent?.trim(),
      )
      expect(links).toEqual([
        "Create",
        "Prototypes",
        "Analytics",
        "GitHub App",
        "Copilot",
        "Hub administrators",
        "Public sharing",
        "End all Hub sessions",
        "Security audit",
        "Feedback",
      ])
      const feedback = screen.getByRole("link", { name: "Feedback" })
      expect(feedback).toHaveAttribute("href", "https://gh.io/replica-feedback")
      expect(feedback).toHaveAttribute("target", "_blank")
      expect(feedback).toHaveAttribute("rel", "noopener noreferrer")
      for (const link of container.querySelectorAll("aside a")) {
        if (link === feedback) continue
      }
      expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
        "href",
        prototypeWorkspaceData.prototypesPath,
      )
      expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute(
        "href",
        prototypeWorkspaceData.newPrototypePath,
      )
      expect(screen.queryByRole("link", { name: "Templates" })).not.toBeInTheDocument()
      expect(screen.getAllByRole("link", { name: "Security audit" })).toHaveLength(1)
      expect(screen.getByRole("link", { name: "Security audit" })).toHaveAttribute(
        "aria-current",
        "page",
      )
      const repositorySelector = screen
        .getByRole("button", { name: prototypeWorkspaceData.repositorySelectorLabel })
        .closest<HTMLElement>(".repository-selector")
      expect(repositorySelector?.parentElement).toBe(container.querySelector("aside"))
      expect(container.querySelector(".repository-navigation__sections")).not.toContainElement(
        repositorySelector,
      )
      const account = container.querySelector(".repository-navigation__account")!
      expect(account.querySelector("a")).toBe(feedback)
      expect([...account.querySelectorAll("button")]).toEqual([
        screen.getByRole("button", { name: collapsed ? "Expand sidebar" : "Collapse sidebar" }),
        screen.getByRole("button", { name: prototypeWorkspaceData.accountMenuLabel }),
      ])
      fireEvent.click(screen.getByRole("button", { name: prototypeWorkspaceData.accountMenuLabel }))
      expect(screen.queryByRole("menuitem", { name: "Hub administration" })).not.toBeInTheDocument()
    },
  )

  it("does not infer Hub links from repository audit permission", () => {
    render(
      <RepositoryNavigation
        collapsed={false}
        onCollapsedChange={() => undefined}
        data={prototypeWorkspaceData}
      />,
    )
    expect(screen.getByRole("link", { name: "Security audit" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Hub administrators" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument()
  })
})
