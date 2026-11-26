import { describe, expect, it, vi } from "vitest"

import { ControlsConnection, type SavedControls } from "."
import type { ControlsEnvelope, ScopeSnapshot } from "../prototype-controls-protocol"

describe("ControlsConnection()", () => {
  it("can clear saved options without exposing them when the runtime is unavailable", async () => {
    vi.useFakeTimers()
    const frame = document.createElement("iframe")
    document.body.append(frame)
    let saved: SavedControls = {
      identity: "checkout",
      scopes: { page: { title: "Saved" } },
    }
    const declaration = {
      version: 1,
      scope: "page",
      container: "#page",
      controls: [
        {
          id: "title",
          label: "Title",
          type: "text",
          default: "Default",
          binding: { type: "field", selector: "#title" },
        },
      ],
    } as const
    let runtimeAvailable = false
    function state() {
      return {
        runtimeAvailable,
        status: "no-controls",
        scopes: [],
        ...(runtimeAvailable ? { inactiveDeclarations: [declaration] } : {}),
      }
    }
    const api = vi.fn((options?: RequestInit) => {
      if (options?.method === "POST") saved = { ...saved, scopes: {} }
      return Promise.resolve(structuredClone(saved))
    })
    const commands: ControlsEnvelope[] = []
    let sequence = 0
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((data: ControlsEnvelope) => {
      if (data.protocol !== "replica:controls") return
      commands.push(data)
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://prototype.local",
            source: frame.contentWindow,
            data: {
              protocol: "replica:controls",
              version: 1,
              epoch: data.epoch,
              requestId: data.requestId,
              type: "reply",
              sequence: ++sequence,
              state: state(),
            },
          }),
        )
      })
    })
    const connection = new ControlsConnection(frame, "http://prototype.local", api)
    try {
      connection.start()
      expect(connection.getControlValuesError()).toBeTruthy()
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getSnapshot().runtimeAvailable).toBe(false)
      expect(connection.getSnapshot().hasResettableValues).toBe(true)
      expect(connection.getControlValues()).toEqual({})
      expect(connection.getControlValuesError()).toBeTruthy()

      const epoch = commands[0]!.epoch
      function sendSnapshot() {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://prototype.local",
            source: frame.contentWindow,
            data: {
              protocol: "replica:controls",
              version: 1,
              epoch,
              requestId: "event",
              type: "snapshot",
              sequence: ++sequence,
              state: state(),
            },
          }),
        )
      }
      runtimeAvailable = true
      sendSnapshot()
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getControlValuesError()).toBeFalsy()
      expect(connection.getControlValues()).toEqual({ page: { title: "Saved" } })

      runtimeAvailable = false
      sendSnapshot()
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getControlValuesError()).toBeTruthy()
      expect(connection.getControlValues()).toEqual({})

      const reset = connection.resetAll()
      await vi.advanceTimersByTimeAsync(0)
      await reset
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ identity: "checkout", reset: true }),
        }),
      )
      expect(saved.scopes).toEqual({})
      expect(connection.getSnapshot().hasResettableValues).toBe(false)
      expect(connection.getControlValuesError()).toBeFalsy()
      expect(commands.some((entry) => entry.command?.operation === "reset-all")).toBe(false)
    } finally {
      connection.stop()
      frame.remove()
    }
  })

  it("removes legacy app-owned values from an unvisited inactive set but keeps ordinary values", async () => {
    vi.useFakeTimers()
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const activeDeclaration = {
      version: 1,
      scope: "home",
      controls: [
        {
          id: "title",
          label: "Title",
          type: "text",
          default: "Default",
          binding: { type: "query", key: "title", mode: "in-place" },
        },
      ],
    } as const
    const inactiveDeclaration = {
      version: 1,
      scope: "page",
      container: "#page",
      controls: [
        {
          id: "route",
          label: "Route",
          type: "text",
          default: "/default",
          binding: {
            type: "api",
            object: "routing",
            read: "read",
            write: "write",
            pollMs: 250,
            initial: "app",
          },
        },
        {
          id: "filter",
          label: "Filter",
          type: "text",
          default: "All",
          binding: { type: "field", selector: "#filter" },
        },
      ],
    } as const
    const scope: ScopeSnapshot = {
      declaration: activeDeclaration,
      fingerprint: JSON.stringify(activeDeclaration),
      snapshot: {
        revision: 0,
        values: { title: "Default" },
        visible: { title: true },
        groups: {},
        actions: {},
      },
    }
    let saved: SavedControls = {
      identity: "checkout",
      scopes: { page: { route: "/legacy", filter: "Open" } },
    }
    const storageWrites: object[] = []
    const api = vi.fn((options?: RequestInit) => {
      if (options?.method === "POST" && typeof options.body === "string") {
        const body = JSON.parse(options.body) as {
          identity: string
          scope: string
          values: Record<string, unknown>
        }
        storageWrites.push(body)
        saved = { ...saved, scopes: { ...saved.scopes, [body.scope]: body.values } }
      }
      return Promise.resolve(structuredClone(saved))
    })
    const commands: ControlsEnvelope[] = []
    let sequence = 0
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((data: ControlsEnvelope) => {
      if (data.protocol !== "replica:controls") return
      commands.push(data)
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://prototype.local",
            source: frame.contentWindow,
            data: {
              protocol: "replica:controls",
              version: 1,
              epoch: data.epoch,
              requestId: data.requestId,
              type: "reply",
              sequence: ++sequence,
              state: {
                runtimeAvailable: true,
                status: "ready",
                scopes: [structuredClone(scope)],
                inactiveDeclarations: [inactiveDeclaration],
              },
            },
          }),
        )
      })
    })
    const connection = new ControlsConnection(frame, "http://prototype.local", api)
    try {
      connection.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getSnapshot().loading).toBe(false)
      expect(connection.getControlValues().page).toEqual({ filter: "Open" })
      expect(storageWrites).toContainEqual({
        identity: "checkout",
        scope: "page",
        values: { filter: "Open" },
      })
      expect(saved.scopes.page).toEqual({ filter: "Open" })
      const queries = commands
        .filter((entry) => entry.command?.operation === "url")
        .map((entry) => entry.command?.query)
      expect(queries.length).toBeGreaterThan(0)
      expect(queries.every((query) => !new URLSearchParams(query).has("rc.page.route"))).toBe(true)
      expect(
        queries.some((query) => new URLSearchParams(query).get("rc.page.filter") === '"Open"'),
      ).toBe(true)
    } finally {
      connection.stop()
      frame.remove()
    }
  })

  it("persists ordinary values but keeps app-owned values out of storage and copied links", async () => {
    vi.useFakeTimers()
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const declaration = {
      version: 1,
      scope: "initialRoute",
      controls: [
        {
          id: "page",
          label: "Page",
          type: "text",
          default: "/default",
          binding: {
            type: "api",
            object: "routing",
            read: "read",
            write: "write",
            pollMs: 250,
            initial: "app",
          },
        },
        {
          id: "title",
          label: "Title",
          type: "text",
          default: "Default",
          binding: { type: "query", key: "title", mode: "in-place" },
        },
      ],
    } as const
    const snapshot = {
      revision: 0,
      values: { page: "/current", title: "Default" } as Record<string, string>,
      visible: { page: true, title: true },
      groups: {},
      actions: {},
    }
    const scope: ScopeSnapshot = {
      declaration,
      fingerprint: JSON.stringify(declaration),
      snapshot,
    }
    let saved: SavedControls = {
      identity: "checkout",
      scopes: { initialRoute: { page: "/legacy", title: "Saved title" } },
    }
    const storageWrites: object[] = []
    const api = vi.fn((options?: RequestInit) => {
      if (options?.method === "POST" && typeof options.body === "string") {
        const body = JSON.parse(options.body) as {
          identity: string
          scope: string
          values: Record<string, unknown>
        }
        storageWrites.push(body)
        saved = { ...saved, scopes: { initialRoute: body.values } }
      }
      return Promise.resolve(structuredClone(saved))
    })
    const commands: ControlsEnvelope[] = []
    let sequence = 0
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((data: ControlsEnvelope) => {
      if (data.protocol !== "replica:controls") return
      commands.push(data)
      queueMicrotask(() => {
        if (data.command?.operation === "restore") {
          snapshot.values.title = data.command.values?.title as string
          snapshot.revision++
        }
        if (data.command?.operation === "update") {
          snapshot.values[data.command.id!] = data.command.value as string
          snapshot.revision++
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "http://prototype.local",
            source: frame.contentWindow,
            data: {
              protocol: "replica:controls",
              version: 1,
              epoch: data.epoch,
              requestId: data.requestId,
              type: "reply",
              sequence: ++sequence,
              state: { runtimeAvailable: true, status: "ready", scopes: [structuredClone(scope)] },
            },
          }),
        )
      })
    })
    const connection = new ControlsConnection(frame, "http://prototype.local", api)
    try {
      connection.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getSnapshot().loading).toBe(false)
      expect(connection.getSnapshot().scopes[0]?.snapshot.values).toEqual({
        page: "/current",
        title: "Saved title",
      })
      expect(storageWrites).toContainEqual({
        identity: "checkout",
        scope: "initialRoute",
        values: { title: "Saved title" },
      })
      expect(connection.getControlValues()).toEqual({ initialRoute: { title: "Saved title" } })
      expect(
        commands
          .filter((entry) => entry.command?.operation === "url")
          .map((entry) => entry.command?.query),
      ).toEqual(["rc.initialRoute.title=%22Saved+title%22"])

      await connection.command("update", "initialRoute", "page", "/next")
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getSnapshot().scopes[0]?.snapshot.values.page).toBe("/next")
      expect(connection.getControlValues()).toEqual({ initialRoute: { title: "Saved title" } })
      expect(storageWrites).toHaveLength(1)
      expect(saved.scopes.initialRoute).toEqual({ title: "Saved title" })

      await connection.command("update", "initialRoute", "title", "Default")
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.getControlValues()).toEqual({ initialRoute: {} })
      expect(saved.scopes.initialRoute).toEqual({})
      expect(connection.getSnapshot().hasResettableValues).toBe(true)
    } finally {
      connection.stop()
      frame.remove()
    }
  })
})
