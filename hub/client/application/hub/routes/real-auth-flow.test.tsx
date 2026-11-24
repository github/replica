import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentType } from "react"
import {
  createBrowserRouter,
  RouterProvider,
  useLoaderData,
  type ActionFunction,
  type LoaderFunction,
  type RouteObject,
} from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

type RouteModule = {
  default?: ComponentType<{ loaderData: unknown }>
  clientLoader?: LoaderFunction
  clientAction?: ActionFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
  handle?: unknown
}

const routeModules = import.meta.glob<RouteModule>([
  "../root.tsx",
  "./**/index.tsx",
  "!./fixtures/**",
])

function applicationRoute(entry: RouteConfigEntry): RouteObject {
  const modulePath =
    entry.file === "root.tsx" ? "../root.tsx" : `./${entry.file.replace(/^routes\//, "")}`
  const loadModule = routeModules[modulePath]
  if (!loadModule) throw new Error(`Missing application route module: ${entry.file}`)
  const common = {
    id: entry.id ?? entry.file.replace(/\.tsx$/, ""),
    path: entry.path,
    lazy: async () => {
      const module = await loadModule()
      const Page = module.default
      return {
        loader: module.clientLoader,
        action: module.clientAction,
        ErrorBoundary: module.ErrorBoundary,
        HydrateFallback: module.HydrateFallback,
        handle: module.handle,
        // Data routers expose loader data through a hook, unlike framework route props.
        Component: Page ? () => <Page loaderData={useLoaderData()} /> : undefined,
      }
    },
  }
  return entry.index
    ? { ...common, index: true }
    : { ...common, children: entry.children?.map(applicationRoute) }
}

describe("Real authentication route integration", () => {
  it.each([
    {
      label: "signed-out home in real development",
      path: "/",
      mode: "development",
      dev: true,
      authenticated: false,
      providers: ["github"],
      button: "Sign in with GitHub",
      action: "/api/auth/github/start",
    },
    {
      label: "signed-out Entra home in real development",
      path: "/",
      mode: "development",
      dev: true,
      authenticated: false,
      providers: ["entra"],
      button: "Sign in with Microsoft Entra",
      action: "/api/auth/entra/start",
    },
    {
      label: "signed-out local home in real development",
      path: "/",
      mode: "development",
      dev: true,
      authenticated: false,
      providers: ["local"],
      button: "Sign in as local developer",
      action: "/api/auth/local/start",
    },
    {
      label: "the legacy sign-in URL in development with the former mock mode selected",
      path: "/sign-in",
      destination: "/",
      mode: "mock",
      dev: true,
      authenticated: false,
      providers: ["local"],
      button: "Sign in as local developer",
      action: "/api/auth/local/start",
    },
    {
      label: "a signed-out repositories visit",
      path: "/repositories",
      destination: "/",
      mode: "development",
      dev: true,
      authenticated: false,
      providers: ["github"],
      button: "Sign in with GitHub",
      action: "/api/auth/github/start",
    },
    {
      label: "restored empty workspace in a production build, even with mock mode selected",
      path: "/",
      mode: "mock",
      dev: false,
      authenticated: true,
      providers: ["github"],
      button: "Sign out",
      action: "/api/auth/session/sign-out",
    },
    {
      label: "administrator enrollment in real development",
      path: "/admin-enrollment",
      mode: "development",
      dev: true,
      authenticated: false,
      providers: ["github"],
      button: "Verify with GitHub",
      action: "/api/auth/github/admin-enrollment/start",
    },
    {
      label: "Entra administrator enrollment in real development",
      path: "/admin-enrollment",
      mode: "development",
      dev: true,
      authenticated: false,
      providers: ["entra"],
      button: "Verify with Microsoft Entra",
      action: "/api/auth/entra/admin-enrollment/start",
    },
  ])(
    "connects $label to real authentication and leaves its POST native",
    async ({ path, destination = path, mode, dev, authenticated, providers, button, action }) => {
      vi.stubEnv("MODE", mode)
      vi.stubEnv("DEV", dev)
      const api = stubHubFetch(
        http.get(`${window.location.origin}/api/auth/providers`, () =>
          Response.json({ providers }),
        ),
        http.get(`${window.location.origin}/api/auth/session`, () =>
          authenticated
            ? Response.json({
                authenticated: true,
                membershipId: "11111111-1111-4111-8111-111111111111",
                userId: "22222222-2222-4222-8222-222222222222",
                provider: "github",
                login: "octocat",
                name: "The Octocat",
                role: "ADMINISTRATOR",
              })
            : new Response(null, { status: 401 }),
        ),
        http.get(`${window.location.origin}/api/workspace`, () => {
          if (!authenticated)
            return Response.json({ error: "Sign in to continue." }, { status: 401 })
          return Response.json({
            viewer: {
              id: "22222222-2222-4222-8222-222222222222",
              provider: "github",
              login: "octocat",
              name: "The Octocat",
              avatarUrl: null,
            },
            repositories: [],
            capabilities: {
              createPrototypes: false,
              reviewPrototypes: false,
              manageSharing: false,
              administerHub: true,
            },
          })
        }),
      )
      function requests() {
        return api.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)
      }
      const [{ default: routes }, { HubThemeProvider }] = await Promise.all([
        import("../routes"),
        import("@hooks/use-hub-theme"),
      ])
      window.history.replaceState(null, "", path)
      const router = createBrowserRouter(
        [applicationRoute({ id: "root", file: "root.tsx", children: routes })],
        { window },
      )
      onTestFinished(() => router.dispose())
      await act(async () => {
        await vi.waitFor(() => expect(router.state.initialized).toBe(true), { timeout: 10_000 })
      })
      render(
        <HubThemeProvider>
          <RouterProvider router={router} />
        </HubThemeProvider>,
      )

      if (authenticated) {
        expect(
          await screen.findByRole("heading", { name: "No repositories available" }),
        ).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "Account menu for @octocat" }))
      }
      const submit = await screen.findByRole(authenticated ? "menuitem" : "button", {
        name: button,
      })
      const allowedRequests = authenticated
        ? ["GET /api/auth/session", "GET /api/workspace"]
        : ["GET /api/auth/providers", "GET /api/auth/session"]
      if (!authenticated && path === "/repositories") {
        allowedRequests.push("GET /api/workspace")
        expect(screen.queryByRole("navigation", { name: "Hub navigation" })).not.toBeInTheDocument()
      }
      await vi.waitFor(() => {
        expect(requests()).toEqual(expect.arrayContaining(allowedRequests))
        expect(router.state.initialized).toBe(true)
        expect(router.state.navigation.state).toBe("idle")
      })
      expect(requests().every((request) => allowedRequests.includes(request))).toBe(true)
      expect(router.state.location.pathname).toBe(destination)
      const form = authenticated
        ? document.querySelector<HTMLFormElement>(`form[action="${action}"]`)
        : submit instanceof HTMLButtonElement
          ? submit.form
          : submit.closest("form")
      if (!form) throw new Error("The authentication control must submit a native form.")
      expect(form.method).toBe("post")
      const submitAction =
        submit instanceof HTMLButtonElement
          ? (submit.getAttribute("formaction") ?? form.action)
          : form.action
      expect(new URL(submitAction, window.location.href).pathname).toBe(action)
      if (path === "/admin-enrollment") {
        fireEvent.change(screen.getByLabelText(/^Bootstrap secret/), {
          target: { value: "local-test-bootstrap-secret" },
        })
      }

      const submitEvent = new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: authenticated ? null : submit,
      })
      expect(form.dispatchEvent(submitEvent)).toBe(true)

      expect(router.state.location.pathname).toBe(destination)
      expect(
        screen.getByRole(authenticated ? "menuitem" : "button", { name: button }),
      ).toBeInTheDocument()
      expect(requests().every((request) => allowedRequests.includes(request))).toBe(true)
      if (authenticated) {
        await act(async () => {
          await router.navigate("/repositories")
        })
        expect(router.state.location.pathname).toBe("/repositories")
        expect(
          screen.getByRole("heading", { name: "No repositories available" }),
        ).toBeInTheDocument()
        expect(requests().every((request) => allowedRequests.includes(request))).toBe(true)
      }
    },
    15_000,
  )
})
