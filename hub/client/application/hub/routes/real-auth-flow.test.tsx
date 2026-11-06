import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
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

type RouteModule = {
  default?: ComponentType<{ loaderData: unknown }>
  clientLoader?: LoaderFunction
  clientAction?: ActionFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
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
      label: "restored home in a production build, even with mock mode selected",
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
    "connects $label to the real session shell and leaves its POST native",
    async ({ path, mode, dev, authenticated, providers, button, action }) => {
      vi.stubEnv("MODE", mode)
      vi.stubEnv("DEV", dev)
      const requests: string[] = []
      const server = setupServer(
        http.get(`${window.location.origin}/api/auth/providers`, () =>
          HttpResponse.json({ providers }),
        ),
        http.get(`${window.location.origin}/api/auth/session`, () =>
          authenticated
            ? HttpResponse.json({ authenticated: true, role: "ADMINISTRATOR" })
            : new HttpResponse(null, { status: 401 }),
        ),
      )
      server.events.on("request:start", ({ request }) => {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)
      })
      server.listen({ onUnhandledRequest: "error" })
      onTestFinished(() => server.close())
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

      const submit = await screen.findByRole("button", { name: button })
      await vi.waitFor(() => {
        expect(requests).toEqual(
          expect.arrayContaining(["GET /api/auth/providers", "GET /api/auth/session"]),
        )
        expect(router.state.initialized).toBe(true)
        expect(router.state.navigation.state).toBe("idle")
      })
      expect(
        requests.every((request) =>
          ["GET /api/auth/providers", "GET /api/auth/session"].includes(request),
        ),
      ).toBe(true)
      expect(router.state.location.pathname).toBe(path)
      const form = submit instanceof HTMLButtonElement ? submit.form : submit.closest("form")
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
        submitter: submit,
      })
      expect(form.dispatchEvent(submitEvent)).toBe(true)

      expect(router.state.location.pathname).toBe(path)
      expect(screen.getByRole("button", { name: button })).toBeInTheDocument()
      expect(
        requests.every((request) =>
          ["GET /api/auth/providers", "GET /api/auth/session"].includes(request),
        ),
      ).toBe(true)
    },
    15_000,
  )
})
