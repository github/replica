import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { HubApplication } from "@application/hub-application"
import { HubThemeProvider } from "@hooks/use-hub-theme"

import { createApp } from "../../../../server/create-app"
import { createLogger } from "../../../../server/integrations/pino/create-logger"
import type { AuthenticationRouteDependencies } from "../../../../server/routes/api/auth/types"

async function renderSignIn(provider: "github" | "entra" | "local", label: string) {
  const applicationOrigin = window.location.origin
  const authorizationUrl = "https://identity.example.test/authorize"
  const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true, auditFailed: false })
  const start = vi.fn().mockResolvedValue({
    authorizationUrl,
    browserBinding: "test-browser-binding",
    expiresAt: new Date(Date.now() + 600_000),
  })
  const authentication: AuthenticationRouteDependencies = {
    [provider]: {
      signIn: { applicationOrigin, checkRateLimit, secureCookie: false, start },
      administratorEnrollment: {
        applicationOrigin,
        checkRateLimit,
        secureCookie: false,
        start: vi.fn(),
        verifyBootstrapSecret: vi.fn(),
        writeBootstrapDenial: vi.fn(),
      },
      callback: {
        checkRateLimit,
        secureCookie: false,
        complete: vi.fn(),
        admit: vi.fn(),
      },
    },
    currentSession: { restore: vi.fn() },
    signOut: { applicationOrigin, secureCookie: false, end: vi.fn() },
  }
  const server = createServer(
    createApp({ authentication, logger: createLogger({ level: "silent" }) }),
  )
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const networkFetch = globalThis.fetch
  // Node's fetch needs an absolute URL for the application's same-origin requests.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    networkFetch(
      typeof input === "string" && input.startsWith("/") ? new URL(input, baseUrl) : input,
      init,
    ),
  )
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
  render(
    <HubThemeProvider>
      <MemoryRouter>
        <HubApplication />
      </MemoryRouter>
    </HubThemeProvider>,
  )
  const submitter = await screen.findByRole<HTMLButtonElement>("button", { name: label })
  const form = submitter.form
  if (!form) throw new Error("The sign-in button must submit a form.")

  return {
    authorizationUrl,
    checkRateLimit,
    form,
    start,
    submit: (origin = applicationOrigin) => {
      const body = new URLSearchParams()
      for (const [name, value] of new window.FormData(form, submitter)) {
        if (typeof value !== "string") throw new Error("Sign-in fields must be strings.")
        body.append(name, value)
      }
      return networkFetch(new URL(form.getAttribute("action")!, baseUrl), {
        method: form.method,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
        },
        body: body.toString(),
        redirect: "manual",
      })
    },
  }
}

describe("Home sign-in form contract", () => {
  it.each([
    ["github", "Sign in with GitHub"],
    ["entra", "Sign in with Microsoft Entra"],
    ["local", "Sign in as local developer"],
  ] as const)("starts %s sign-in from its rendered home form", async (provider, label) => {
    const { authorizationUrl, checkRateLimit, start, submit } = await renderSignIn(provider, label)

    const response = await submit()

    expect(response.status, await response.text()).toBe(303)
    expect(response.headers.get("location")).toBe(authorizationUrl)
    expect(response.headers.get("set-cookie")).toContain("hub_auth_browser=")
    expect(checkRateLimit).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledExactlyOnceWith({ switchAccount: false })
  })

  it("rejects a serialized home form from the same host on a different port", async () => {
    const { checkRateLimit, start, submit } = await renderSignIn("github", "Sign in with GitHub")
    const differentOrigin = new URL(window.location.origin)
    differentOrigin.port = differentOrigin.port === "8443" ? "9443" : "8443"

    const response = await submit(differentOrigin.origin)

    expect(response.status).toBe(403)
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("still rejects an unknown field added to the rendered home form", async () => {
    const { checkRateLimit, form, start, submit } = await renderSignIn(
      "github",
      "Sign in with GitHub",
    )
    const unknownField = document.createElement("input")
    unknownField.type = "hidden"
    unknownField.name = "authenticity_token"
    unknownField.value = ""
    form.append(unknownField)

    const response = await submit()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Choose a valid sign-in option." })
    expect(checkRateLimit).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })
})
