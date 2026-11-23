import { render, screen } from "@testing-library/react"
import { createMemoryRouter, Outlet, RouterProvider, useLoaderData } from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import routeConfig from "../routes"
import { HubNavigation } from "../hub-navigation"
import Home, { handle as homeHandle } from "../routes/home"
import Repositories, { handle as repositoriesHandle } from "../routes/repositories"
import Workspace, { clientLoader as loadWorkspace } from "../routes/workspace"
import NoRepositoryAccess from "../routes/no-repository-access"

function renderHub(path: string) {
  vi.stubEnv("DEV", true)
  vi.stubEnv("MODE", "development")
  const router = createMemoryRouter(
    [
      {
        path: "/",
        Component: () => (
          <HubNavigation>
            <Outlet />
          </HubNavigation>
        ),
        children: [
          {
            loader: loadWorkspace,
            Component: () => <Workspace loaderData={useLoaderData<typeof loadWorkspace>()} />,
            children: [
              { index: true, Component: Home, handle: homeHandle },
              { path: "repositories", Component: Repositories, handle: repositoriesHandle },
            ],
          },
          { path: "signed-in/no-access", Component: NoRepositoryAccess },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  onTestFinished(() => router.dispose())
  render(
    <HubThemeProvider>
      <RouterProvider router={router} />
    </HubThemeProvider>,
  )
  return router
}

function stubApi(sessionResponse: () => Response, workspaceResponse?: () => Response) {
  const request = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
    if (url.pathname === "/api/auth/providers") {
      return Promise.resolve(Response.json({ providers: ["github"] }))
    }
    if (url.pathname === "/api/auth/session") return Promise.resolve(sessionResponse())
    if (url.pathname === "/api/workspace")
      return Promise.resolve(
        workspaceResponse?.() ?? Response.json({ error: "Sign in to continue." }, { status: 401 }),
      )
    return Promise.reject(new Error(`Unexpected API request: ${url.pathname}`))
  })
  vi.stubGlobal("fetch", request)
  return request
}

function noAccess(login: string | null) {
  return Response.json(
    {
      authenticated: false,
      error: "Your GitHub account no longer has access to a connected repository.",
      login,
      reason: "no_repository_access",
    },
    { status: 401 },
  )
}

describe("repository access recovery redirects", () => {
  it("registers the public recovery route without a redirect loop", async () => {
    expect(routeConfig).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "signed-in/no-access",
          file: "routes/no-repository-access/index.tsx",
        }),
      ]),
    )
    stubApi(() => noAccess("octocat"))
    const router = renderHub("/signed-in/no-access")

    expect(
      await screen.findByRole("heading", {
        name: "You don't have access to any Replica repositories",
      }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/signed-in/no-access")
  })

  it.each([
    ["/", "octocat"],
    ["/", null],
    ["/repositories", "octocat"],
    ["/repositories", null],
  ])("redirects %s after a revoked session with login %s", async (path, login) => {
    stubApi(() => noAccess(login))
    const router = renderHub(path)

    expect(
      await screen.findByRole("heading", {
        name: "You don't have access to any Replica repositories",
      }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/signed-in/no-access")
    const claimedIdentity = screen.queryByText(/you signed in as @/i)
    if (claimedIdentity) {
      expect(login).not.toBeNull()
      expect(claimedIdentity).toHaveTextContent(`@${login}`)
    }
    if (!login) {
      expect(screen.queryByText(/you signed in as @/i)).not.toBeInTheDocument()
    }

    const switchAccount = screen.getByRole<HTMLButtonElement>("button", {
      name: "Sign in as a different GitHub account",
    })
    const form = switchAccount.form!
    const submit = new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: switchAccount,
    })
    expect(form.dispatchEvent(submit)).toBe(true)
  })

  it("allows native sign-out after a revoked session", async () => {
    stubApi(() => noAccess("octocat"))
    const router = renderHub("/repositories")

    const button = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Return to sign in",
    })
    expect(router.state.location.pathname).toBe("/signed-in/no-access")
    const form = button.form!
    expect(form.method).toBe("post")
    const submit = new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: button,
    })
    expect(form.dispatchEvent(submit)).toBe(true)
  })

  it.each(["/", "/repositories"])(
    "keeps an ordinary signed-out session at %s on the normal sign-in path",
    async (path) => {
      stubApi(() => Response.json({ authenticated: false }, { status: 401 }))
      const router = renderHub(path)

      expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe("/")
      expect(
        screen.queryByRole("heading", {
          name: "You don't have access to any Replica repositories",
        }),
      ).not.toBeInTheDocument()
    },
  )

  it.each([
    ["github", "ADMINISTRATOR"],
    ["entra", "MEMBER"],
  ] as const)("keeps a restored %s %s in the workspace", async (provider, role) => {
    stubApi(
      () => new Response(null, { status: 500 }),
      () =>
        Response.json({
          viewer: {
            id: "22222222-2222-4222-8222-222222222222",
            login: "member",
            name: null,
            avatarUrl: null,
            provider,
          },
          repositories: [],
          capabilities: {
            createPrototypes: false,
            reviewPrototypes: false,
            manageSharing: false,
            administerHub: role === "ADMINISTRATOR",
          },
        }),
    )
    const router = renderHub("/repositories")

    expect(await screen.findByRole("heading", { name: "No repositories available" })).toBeVisible()
    expect(router.state.location.pathname).toBe("/repositories")
  })

  it("recovers if the signed-out home subsequently observes a repository revocation", async () => {
    let reads = 0
    stubApi(() =>
      ++reads === 1
        ? Response.json({ authenticated: false }, { status: 401 })
        : noAccess("octocat"),
    )
    const router = renderHub("/")

    expect(
      await screen.findByRole("heading", {
        name: "You don't have access to any Replica repositories",
      }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/signed-in/no-access")
  })

  it("does not turn a non-401 response into a repository-access denial", async () => {
    vi.stubEnv("DEV", true)
    vi.stubEnv("MODE", "development")
    stubApi(() =>
      Response.json(
        { error: "Forbidden", login: "octocat", reason: "no_repository_access" },
        {
          status: 403,
        },
      ),
    )

    await expect(
      loadWorkspace({ request: new Request("http://localhost/") }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
