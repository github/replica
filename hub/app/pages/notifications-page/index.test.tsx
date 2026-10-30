import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { NotificationsPage } from "."
import stories from "./stories"

describe("NotificationsPage()", () => {
  it("offers repository navigation instead of an empty selector without repository access", () => {
    render(
      <NotificationsPage
        {...stories.args}
        data={{ ...stories.args.data, repository: null, securityAuditPath: null }}
      />,
      { wrapper: HubThemeProvider },
    )

    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute(
      "href",
      "/repositories",
    )
    expect(screen.queryByRole("link", { name: "Prototypes" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: stories.args.data.repository.repositorySelectorLabel }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Inbox, 1 unread items" })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})
