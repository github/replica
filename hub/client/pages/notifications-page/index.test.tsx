import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import { signedInRepository } from "@/storybook/fixtures/signed-in-workspace"

import { NotificationsPage } from "."
import stories from "./stories"

describe("NotificationsPage()", () => {
  it("keeps Prototypes and Inbox available when the workspace has no repository", () => {
    render(
      <NotificationsPage
        {...stories.args}
        data={{
          ...stories.args.data,
          repository: null,
          emptyRepositoryLabel: "No repository selected",
          securityAuditPath: null,
        }}
      />,
      { wrapper: HubThemeProvider },
    )

    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
      "href",
      "/repositories",
    )
    expect(screen.getByRole("button", { name: "No repository selected" })).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: signedInRepository.repositorySelectorLabel }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Inbox, 1 unread items" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})
