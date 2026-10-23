import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { GitBranchIcon, SidebarExpandIcon } from "@primer/octicons-react"

import { RepositoryNavigationItem } from "."

describe("RepositoryNavigationItem()", () => {
  it("keeps the selected repository destination as a native link", () => {
    render(
      <RepositoryNavigationItem
        href="/repositories/2001"
        icon={GitBranchIcon}
        label="Prototypes"
        selected
      />,
    )

    const link = screen.getByRole("link", { name: "Prototypes" })
    expect(link).toHaveAttribute("href", "/repositories/2001")
    expect(link).toHaveAttribute("aria-current", "page")
  })

  it("opens external destinations separately without sharing opener access", () => {
    render(
      <RepositoryNavigationItem
        href="https://github.com/github/replica"
        icon={GitBranchIcon}
        label="Source"
        external
      />,
    )

    const link = screen.getByRole("link", { name: "Source" })
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("uses the same row as a labelled collapse button", () => {
    const onClick = vi.fn()
    render(
      <RepositoryNavigationItem
        icon={SidebarExpandIcon}
        label="Collapse sidebar"
        expanded
        onClick={onClick}
      />,
    )

    const button = screen.getByRole("button", { name: "Collapse sidebar" })
    expect(button).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
