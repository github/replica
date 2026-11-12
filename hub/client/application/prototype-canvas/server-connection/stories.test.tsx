import { render, screen, waitFor } from "@testing-library/react"
import { JSDOM } from "jsdom"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"
import meta from "./stories"

describe("ServerConnection stories", () => {
  it.each([
    ["empty", "No running servers", 0, 0],
    ["single", "Choose a server", 1, 0],
    ["multiple", "Choose a server", 2, 0],
    ["script", "Start your prototype here", 0, 1],
    ["scripts", "Start your prototype here", 0, 2],
    ["scan-failed", "Could not scan", 0, 0],
    ["warnings", "Choose a server", 1, 0],
    ["startup-unavailable", "No running servers", 0, 0],
  ] as const)(
    "renders %s from the real extension document without network access",
    async (scenario, message, servers, scripts) => {
      const unexpectedFetch = vi.fn(() => Promise.reject(new Error("Unexpected network request.")))
      render(<meta.component scenario={scenario} />, { wrapper: HubThemeProvider })
      const html = screen.getByTitle("Connect a prototype server").getAttribute("srcdoc")!
      const dom = new JSDOM(html, {
        runScripts: "dangerously",
        url: "http://fixture.example",
        beforeParse(window) {
          Object.defineProperty(window, "Response", { value: Response })
          window.fetch = unexpectedFetch
        },
      })
      try {
        await waitFor(() =>
          expect(dom.window.document.getElementById("status")?.textContent).toContain(message),
        )
        expect(dom.window.document.querySelectorAll("#servers button")).toHaveLength(servers)
        expect(dom.window.document.querySelectorAll("#scripts option")).toHaveLength(scripts)
        if (scenario === "warnings")
          expect(dom.window.document.getElementById("warnings")?.textContent).toContain("HTTP 503")
        if (scenario === "startup-unavailable")
          expect(dom.window.document.getElementById("consent")?.textContent).toContain(
            "Start the server manually",
          )
        expect(unexpectedFetch).not.toHaveBeenCalled()
      } finally {
        dom.window.close()
      }
    },
  )

  it.each([
    ["starting", "start", "Starting"],
    ["start-failed", "start", "Could not start"],
    ["connecting", "servers button", "Connecting"],
    ["connect-failed", "servers button", "Could not connect"],
  ] as const)("keeps %s entirely inside the fixture", async (scenario, selector, message) => {
    const unexpectedFetch = vi.fn(() => Promise.reject(new Error("Unexpected network request.")))
    render(<meta.component scenario={scenario} />, { wrapper: HubThemeProvider })
    const dom = new JSDOM(screen.getByTitle("Connect a prototype server").getAttribute("srcdoc")!, {
      runScripts: "dangerously",
      url: "http://fixture.example",
      beforeParse(window) {
        Object.defineProperty(window, "Response", { value: Response })
        window.fetch = unexpectedFetch
      },
    })
    try {
      await waitFor(() => {
        const button = dom.window.document.querySelector<HTMLButtonElement>(`#${selector}`)
        expect(button).not.toBeNull()
        expect(button?.hidden).toBe(false)
        expect(button?.disabled).toBe(false)
      })
      dom.window.document.querySelector<HTMLButtonElement>(`#${selector}`)!.click()
      await waitFor(() =>
        expect(dom.window.document.getElementById("status")?.textContent).toContain(message),
      )
      expect(dom.window.location.href).toBe("http://fixture.example/")
      expect(unexpectedFetch).not.toHaveBeenCalled()
    } finally {
      dom.window.close()
    }
  })
})
