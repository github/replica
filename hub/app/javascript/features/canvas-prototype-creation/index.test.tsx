import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, it, vi } from "vitest"

import { CanvasPrototypeCreation } from "."

function catalog() {
  return {
    templates: [
      { id: "default", name: "Default", route: "/" },
      { id: "welcome", name: "Welcome", route: "/settings?tab=profile#details" },
    ],
    promptInstructions: "Build an interactive prototype.",
    templatePageInstructions: "Use the page %{route}.",
    templateLandingPageInstructions: "Set startPage to %{route}.",
    copy: {
      heading: "What should we create?",
      descriptionPlaceholder: "Describe your prototype",
      templateLabel: "Template",
      previewUnavailable: "Preview unavailable",
      addDetails: "Add details",
      editDetails: "Edit details",
      detailsHeading: "Add details (optional)",
      detailsDescription: "Include requirements or constraints.",
      changeLabel: "What should change from today?",
      changePlaceholder: "What is difficult now?",
      audienceLabel: "Who is this for?",
      audiencePlaceholder: "Who will use it?",
      outcomeLabel: "What should someone be able to do?",
      outcomePlaceholder: "What should work?",
      closeDetails: "Close details",
      saveDetails: "Done",
      submitLabel: "Create prototype",
    },
  }
}

function servers() {
  return {
    servers: [{ url: "http://localhost:5173/", command: "node", pid: 123 }],
    warnings: [],
    development: { scripts: [{ id: "dev", invocation: "npm run dev" }], message: "" },
  }
}

describe("CanvasPrototypeCreation()", () => {
  it("loads the connected Hub form without pairing and submits saved details and the selected template", async () => {
    let resolveCatalog!: (response: Response) => void
    const pendingCatalog = new Promise<Response>((resolve) => {
      resolveCatalog = resolve
    })
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/servers") return Response.json(servers())
      if (url === "/api/prototypes/new")
        return options?.method === "POST" ? Response.json({ requested: true }) : pendingCatalog
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetch)
    const onConnect = vi.fn()
    render(
      <CanvasPrototypeCreation
        token="canvas-token"
        status={{ state: "connected" }}
        onConnect={onConnect}
      />,
    )
    expect(screen.getByText("Loading templates from Hub...")).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    await act(() => {
      resolveCatalog(Response.json(catalog()))
      return pendingCatalog.then(() => undefined)
    })
    const brief = await screen.findByRole("textbox", { name: "What should we create?" })
    const serverSection = screen.getByRole("region", { name: "Open an existing prototype" })
    expect(
      brief.compareDocumentPosition(serverSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      within(serverSection).queryByRole("button", { name: "Start dev server" }),
    ).not.toBeInTheDocument()
    expect(within(serverSection).getByRole("button", { name: "Connect" })).toBeInTheDocument()
    fireEvent.change(brief, { target: { value: "Simplify account settings." } })
    fireEvent.click(screen.getByRole("button", { name: "Add details" }))
    const details = screen.getByRole("dialog", { name: "Add details (optional)" })
    fireEvent.change(
      within(details).getByRole("textbox", { name: "What should change from today?" }),
      {
        target: { value: "Group settings" },
      },
    )
    fireEvent.change(within(details).getByRole("textbox", { name: "Who is this for?" }), {
      target: { value: "Administrators" },
    })
    fireEvent.change(
      within(details).getByRole("textbox", { name: "What should someone be able to do?" }),
      {
        target: { value: "Find options" },
      },
    )
    fireEvent.click(within(details).getByRole("button", { name: "Done" }))
    fireEvent.click(screen.getByRole("button", { name: "Template: Default" }))
    fireEvent.click(screen.getByRole("option", { name: "Welcome /settings?tab=profile#details" }))
    fireEvent.click(screen.getByRole("button", { name: "Create prototype" }))
    await screen.findByText("Your brief is in this conversation. Continue with Copilot here.")
    const submitted = fetch.mock.calls.find(([, options]) => options?.method === "POST")
    expect(submitted?.[0]).toBe("/api/prototypes/new")
    expect(JSON.parse(submitted?.[1]?.body as string)).toEqual({
      brief: "Simplify account settings.",
      details: { change: "Group settings", audience: "Administrators", outcome: "Find options" },
      templateId: "welcome",
    })
    expect(
      fetch.mock.calls.every(([url]) => ["/api/servers", "/api/prototypes/new"].includes(url)),
    ).toBe(true)
    expect(onConnect).not.toHaveBeenCalled()
  })

  it("retains the brief and template after failed dispatch so the same draft can be retried", async () => {
    let attempts = 0
    const fetch = vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/servers") return Promise.resolve(Response.json(servers()))
      if (url === "/api/prototypes/new" && options?.method === "POST")
        return Promise.resolve(
          ++attempts === 1
            ? Response.json({ error: "Chat unavailable." }, { status: 503 })
            : Response.json({ requested: true }),
        )
      if (url === "/api/prototypes/new") return Promise.resolve(Response.json(catalog()))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetch)
    render(
      <CanvasPrototypeCreation
        token="canvas-token"
        status={{ state: "connected" }}
        onConnect={vi.fn()}
      />,
    )
    const brief = await screen.findByRole("textbox", { name: "What should we create?" })
    fireEvent.change(brief, { target: { value: "Keep this draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Add details" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Who is this for?" }), {
      target: { value: "Maintainers" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    fireEvent.click(screen.getByRole("button", { name: "Template: Default" }))
    fireEvent.click(screen.getByRole("option", { name: "Welcome /settings?tab=profile#details" }))
    fireEvent.click(screen.getByRole("button", { name: "Create prototype" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Chat unavailable.")
    expect(brief).toHaveValue("Keep this draft")
    expect(screen.getByRole("button", { name: "Template: Welcome" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Create prototype" }))
    await screen.findByText("Your brief is in this conversation. Continue with Copilot here.")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    const submissions = fetch.mock.calls.filter(([, options]) => options?.method === "POST")
    expect(submissions).toHaveLength(2)
    expect(submissions[1]?.[1]?.body).toBe(submissions[0]?.[1]?.body)
    expect(JSON.parse(submissions[1]?.[1]?.body as string)).toMatchObject({
      details: { audience: "Maintainers" },
    })
  })

  it("offers an explicit template retry without showing a local fallback catalog", async () => {
    let attempts = 0
    const fetch = vi.fn((url: string) => {
      if (url === "/api/servers") return Promise.resolve(Response.json(servers()))
      if (url === "/api/prototypes/new")
        return Promise.resolve(
          ++attempts === 1
            ? Response.json({ error: "Hub templates unavailable." }, { status: 503 })
            : Response.json(catalog()),
        )
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetch)
    render(
      <CanvasPrototypeCreation
        token="canvas-token"
        status={{ state: "connected" }}
        onConnect={vi.fn()}
      />,
    )
    expect(await screen.findByRole("alert")).toHaveTextContent("Hub templates unavailable.")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Template: Default" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry templates" }))
    await screen.findByRole("textbox", { name: "What should we create?" })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(attempts).toBe(2)
  })

  it("keeps server discovery available while disconnected and waits for explicit Hub connection", async () => {
    const fetch = vi.fn((url: string) => {
      if (url === "/api/servers") return Promise.resolve(Response.json(servers()))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetch)
    const onConnect = vi.fn()
    render(
      <CanvasPrototypeCreation
        token="canvas-token"
        status={{ state: "disconnected" }}
        onConnect={onConnect}
      />,
    )
    expect(
      screen.getByText("Connect to Hub to create a prototype using your team's templates."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(onConnect).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/servers")
    fireEvent.click(screen.getByRole("button", { name: "Connect to the hub" }))
    expect(onConnect).toHaveBeenCalledOnce()
  })
})
