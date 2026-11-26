import { describe, expect, it, vi } from "vitest"

import { ControlsConnection, type SavedControls } from "."
import type { ControlsEnvelope, ScopeSnapshot } from "../prototype-controls-protocol"

describe("ControlsConnection()", () => {
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
