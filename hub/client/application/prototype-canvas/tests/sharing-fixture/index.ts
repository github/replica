import { expect, vi } from "vitest"

import {
  publicationExamples,
  publicationHub,
  publishPreparation,
} from "@utils/resolve-prototype-publication/fixtures"
import type { HubStatus, PrototypeState } from "@utils/prototype-canvas/types"

/** Gives each case fresh records and fails on requests App might otherwise catch. */
export function sharingFixture(
  initialState?: PrototypeState,
  initialHub: HubStatus = publicationHub,
) {
  const fixture = {
    state: structuredClone(initialState ?? publicationExamples["Unpublished branch"]!.state!),
    hub: structuredClone(initialHub),
    hubError: "",
    remember: false,
  }
  if (!initialState) fixture.state.stats.workingTree = "clean"
  const fetch = vi.fn<(path: string, options?: RequestInit) => Promise<Response>>(
    (path, options) => {
      let data: unknown
      switch (path) {
        case "/api/hub/events":
          return Promise.reject(new Error("No live connection"))
        case "/api/hub/status":
        case "/api/hub/open":
        case "/api/hub/activity":
          if (fixture.hubError)
            return Promise.resolve(Response.json({ error: fixture.hubError }, { status: 503 }))
          data = fixture.hub
          break
        case "/api/state":
        case "/api/refresh":
          data = fixture.state
          break
        case "/api/publish/prepare":
          data = publishPreparation(fixture.state, fixture.remember)
          break
        case "/api/publish/preference": {
          if (typeof options?.body !== "string") throw new Error("Expected a JSON preference.")
          const preference: unknown = JSON.parse(options.body)
          if (
            !preference ||
            typeof preference !== "object" ||
            !("remember" in preference) ||
            typeof preference.remember !== "boolean"
          )
            throw new Error("Expected a boolean publishing preference.")
          fixture.remember = preference.remember
          data = { remember: fixture.remember }
          break
        }
        case "/api/publish":
          fixture.state = {
            ...fixture.state,
            publishRequest: {
              state: "requested",
              requestedAt: new Date().toISOString(),
              commitSha: fixture.state.stats.commitSha,
            },
          }
          data = { message: "Publish requested" }
          break
        case "/api/hub/connect":
          fixture.hub = {
            ...fixture.hub,
            state: "pairing",
            pairing: {
              verificationUrl: "https://hub.example.com/canvas/pair/fixture",
              userCode: "ABCD",
            },
          }
          data = fixture.hub.pairing
          break
        case "/api/hub/share-links/context":
          data = {
            target: "fixture",
            repository: fixture.hub.repository,
            branch: fixture.hub.branch,
            hubOrigin: fixture.hub.hubOrigin,
            prototype: fixture.hub.prototype,
          }
          break
        case "/api/hub/share-links/list":
          data = { shareLinks: [], hasMore: false, nextCursor: null }
          break
        case "/api/hub/comments":
          data = { comments: [], hasMore: false, nextCursor: null }
          break
        case "/api/agent/next":
          data = { command: null }
          break
        default:
          // Soft assertions fail the case even when App handles the rejected request.
          expect.soft([path], "Unexpected canvas requests").toEqual([])
          return Promise.reject(new Error(`Unexpected canvas request: ${path}`))
      }
      return Promise.resolve(Response.json(data))
    },
  )
  vi.stubGlobal("fetch", fetch)
  return { fixture, fetch }
}
