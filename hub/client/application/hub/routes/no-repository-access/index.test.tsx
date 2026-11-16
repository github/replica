import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import NoRepositoryAccess from "."

describe("NoRepositoryAccess", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ authenticated: false }, { status: 401 })),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it("offers a retry and an explicit account switch as native POST submissions", () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/signed-in/no-access"]}>
          <NoRepositoryAccess />
        </MemoryRouter>
      </ThemeProvider>,
    )

    expect(
      screen.getByRole("heading", {
        name: "You don't have access to any Replica repositories",
      }),
    ).toBeInTheDocument()
    const retry = screen.getByRole<HTMLButtonElement>("button", { name: "Try again" })
    const switchAccount = screen.getByRole<HTMLButtonElement>("button", {
      name: "Sign in as a different GitHub account",
    })
    const form = retry.form!
    expect(switchAccount.form).toBe(form)
    expect(form).toHaveAttribute("method", "post")
    expect(form).toHaveAttribute("action", "/api/auth/github/start")
    expect(retry).toHaveAttribute("type", "submit")
    expect(switchAccount).toHaveAttribute("type", "submit")
    expect(new FormData(form, retry).has("switch_account")).toBe(false)
    expect(new FormData(form, switchAccount).get("switch_account")).toBe("true")
    expect(screen.queryByText(/you signed in as @/i)).not.toBeInTheDocument()
  })

  it("does not claim an arbitrary URL-fragment login as a verified account", () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/signed-in/no-access#login=somebody-else"]}>
          <NoRepositoryAccess />
        </MemoryRouter>
      </ThemeProvider>,
    )

    expect(screen.queryByText(/you signed in as @somebody-else/i)).not.toBeInTheDocument()
  })

  it("displays the account verified by the server, not a URL fragment", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { authenticated: false, reason: "no_repository_access", login: "octocat" },
            { status: 401 },
          ),
        ),
    )
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/signed-in/no-access#login=somebody-else"]}>
          <NoRepositoryAccess />
        </MemoryRouter>
      </ThemeProvider>,
    )

    expect(await screen.findByText(/you signed in as @octocat/i)).toBeInTheDocument()
    expect(screen.queryByText(/you signed in as @somebody-else/i)).not.toBeInTheDocument()
  })

  it("does not display malformed login fragments", () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/signed-in/no-access#login=not%20a%20GitHub%20login"]}>
          <NoRepositoryAccess />
        </MemoryRouter>
      </ThemeProvider>,
    )

    expect(screen.getByText(/your GitHub account can't read/i)).toBeInTheDocument()
    expect(screen.queryByText(/you signed in as @/i)).not.toBeInTheDocument()
  })
})
