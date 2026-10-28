import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, it, vi } from "vitest"

import { CanvasServerConnection } from "."

describe("CanvasServerConnection()", () => {
  it("starts only the chosen script and shows startup output and failure without losing the choice", async () => {
    vi.useFakeTimers()
    let finish!: (response: Response) => void
    const startup = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi.fn(async (url: string) => {
      if (url === "/api/servers")
        return Response.json({
          servers: [],
          warnings: [],
          development: {
            scripts: [
              { id: "dev", invocation: "npm run dev" },
              { id: "preview", invocation: "npm run preview" },
            ],
            message: "",
          },
        })
      if (url === "/api/server/start") return startup
      if (url === "/api/server/status")
        return Response.json({ startup: { output: "Starting Vite..." } })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetch)
    render(<CanvasServerConnection token="canvas-token" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Dev server script: npm run dev" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "npm run preview" }))
    fireEvent.click(screen.getByRole("button", { name: "Start dev server" }))
    expect(screen.getByRole("button", { name: "Starting dev server..." })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Dev server script: npm run preview" }),
    ).toBeDisabled()
    expect(fetch.mock.calls[1]).toEqual([
      "/api/server/start",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ script: "preview" }) }),
    ])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fetch.mock.calls.filter(([url]) => url === "/api/servers")).toHaveLength(1)
    expect(screen.getByLabelText("Dev server output")).toHaveTextContent("Starting Vite...")
    await act(() => {
      finish(Response.json({ error: "Server did not start." }, { status: 503 }))
      return startup.then(() => undefined)
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Server did not start.")
    expect(screen.getByRole("button", { name: "Dev server script: npm run preview" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Start dev server" })).toBeEnabled()
  })

  it("connects only the selected server and allows another attempt after connection failure", async () => {
    const fetch = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>((url) => {
      if (url === "/api/servers")
        return Promise.resolve(
          Response.json({
            servers: [
              { url: "http://localhost:5173/", command: "node", pid: 1 },
              { url: "http://localhost:4321/", command: "node", pid: 2 },
            ],
            warnings: [],
            development: { scripts: [{ id: "dev", invocation: "npm run dev" }], message: "" },
          }),
        )
      if (url === "/api/server/connect")
        return Promise.resolve(Response.json({ error: "Server stopped." }, { status: 409 }))
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetch)
    render(<CanvasServerConnection token="canvas-token" />)
    await screen.findAllByRole("button", { name: "Connect" })
    expect(screen.queryByRole("button", { name: "Start dev server" })).not.toBeInTheDocument()
    const selected = screen.getByText(/http:\/\/localhost:4321\//).closest("li")!
    fireEvent.click(within(selected).getByRole("button", { name: "Connect" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Server stopped.")
    const connection = fetch.mock.calls.find(([url]) => url === "/api/server/connect")
    expect(connection).toEqual([
      "/api/server/connect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "http://localhost:4321/" }),
      }),
    ])
    expect(connection?.[1]?.headers).toMatchObject({ "X-Replica-Canvas-Token": "canvas-token" })
    fireEvent.click(within(selected).getByRole("button", { name: "Connect" }))
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([url]) => url === "/api/server/connect")).toHaveLength(2),
    )
  })

  it("reports a failed scan and retries without starting a server automatically", async () => {
    vi.useFakeTimers()
    let attempts = 0
    const fetch = vi.fn((url: string) => {
      if (url !== "/api/servers") throw new Error(`Unexpected request: ${url}`)
      return Promise.resolve(
        ++attempts === 1
          ? Response.json({ error: "Could not inspect this checkout." }, { status: 503 })
          : Response.json({ servers: [], warnings: ["One server returned HTTP 503."] }),
      )
    })
    vi.stubGlobal("fetch", fetch)
    render(<CanvasServerConnection token="canvas-token" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Could not inspect this checkout.")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.getByRole("alert")).toHaveTextContent("One server returned HTTP 503.")
    expect(screen.queryByText("Could not inspect this checkout.")).not.toBeInTheDocument()
    expect(screen.getByText("One server returned HTTP 503.")).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("button", { name: "Start dev server" })).not.toBeInTheDocument()
  })

  it("refreshes servers every 30 seconds without overlapping scans or resetting the chosen script", async () => {
    vi.useFakeTimers()
    let finish!: (response: Response) => void
    const refresh = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          servers: [],
          warnings: [],
          development: {
            scripts: [
              { id: "dev", invocation: "npm run dev" },
              { id: "preview", invocation: "npm run preview" },
            ],
            message: "",
          },
        }),
      )
      .mockReturnValueOnce(refresh)
      .mockResolvedValue(
        Response.json({
          servers: [{ url: "http://localhost:5173/", command: "node", pid: 1 }],
          warnings: [],
        }),
      )
    vi.stubGlobal("fetch", fetch)
    const { unmount } = render(<CanvasServerConnection token="canvas-token" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(screen.getByRole("button", { name: "Dev server script: npm run dev" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "npm run preview" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    await act(async () => {
      finish(
        Response.json({
          servers: [],
          warnings: [],
          development: {
            scripts: [
              { id: "dev", invocation: "npm run dev" },
              { id: "preview", invocation: "npm run preview" },
            ],
            message: "",
          },
        }),
      )
      await refresh
    })
    expect(screen.getByRole("button", { name: "Dev server script: npm run preview" })).toBeEnabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Start dev server" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Scan again" })).not.toBeInTheDocument()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
