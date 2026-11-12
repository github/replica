import { beforeEach, expect, it, vi } from "vitest"
import { urlControlsStorage } from "."

beforeEach(() => {
  window.history.replaceState({ retained: true }, "", "/share/id?source=review#page")
  localStorage.clear()
})

it("does not overwrite the browser URL after its connection is stopped", async () => {
  const controller = new AbortController()
  const api = urlControlsStorage("fixture")
  const request = api({
    ...write({ scope: "page", values: { title: "Too late" } }),
    signal: controller.signal,
  })
  controller.abort()
  await expect(request).rejects.toThrow()
  expect(window.location.search).toBe("?source=review")
})
function write(body: object) {
  return { method: "POST", body: JSON.stringify({ identity: "fixture", ...body }) }
}

it("uses URL settings, never legacy saved viewer values", async () => {
  localStorage.setItem(
    "replica:build-controls:v1:fixture",
    JSON.stringify({ scopes: { page: { title: "Legacy" } } }),
  )
  const api = urlControlsStorage("fixture")
  expect(await api()).toMatchObject({ identity: "fixture", scopes: {} })
  window.history.replaceState(
    window.history.state,
    "",
    "/share/id?rc.page.title=Manual&rc.other.count=3",
  )
  expect(await api()).toMatchObject({ scopes: { page: { title: "Manual" }, other: { count: 3 } } })
})

it("retains inactive scopes and ordinary destination parameters without growing history", async () => {
  const api = urlControlsStorage("fixture")
  const length = window.history.length
  const listener = vi.fn()
  window.addEventListener("replica:controls:url", listener)
  await api(write({ scope: "one", values: { enabled: false } }))
  await api(write({ scope: "two", values: { title: "Hello" } }))
  await api(write({ scope: "one", values: {} }))
  expect(await api()).toMatchObject({ scopes: { two: { title: "Hello" } } })
  expect(window.history.length).toBe(length)
  expect(window.history.state).toEqual({ retained: true })
  expect(new URL(window.location.href).searchParams.get("source")).toBe("review")
  expect(window.location.hash).toBe("#page")
  expect(listener).toHaveBeenCalledTimes(3)
  window.removeEventListener("replica:controls:url", listener)
})

it("restores complete history state and resets all scopes without changing saved preferences", async () => {
  const api = urlControlsStorage("fixture")
  localStorage.setItem("replica:share-controls:v1:prototype", "true")
  await api(write({ scope: "one", values: { count: 3 } }))
  await api(write({ replace: true, scopes: { olderPage: { title: "Older" } } }))
  expect(await api()).toMatchObject({ scopes: { olderPage: { title: "Older" } } })
  await api(write({ reset: true }))
  expect(await api()).toMatchObject({ scopes: {} })
  expect(localStorage.getItem("replica:share-controls:v1:prototype")).toBe("true")
})

it("explicitly rejects identity changes, malformed values, reserved scopes and oversize settings", async () => {
  const api = urlControlsStorage("fixture")
  const reservedScopes: unknown = JSON.parse('{"__proto__":{"title":"Injected"}}')
  for (const input of [
    { identity: "foreign", scope: "page", values: {} },
    { scope: "page", values: { object: {} } },
    { replace: true, scopes: reservedScopes },
    { scope: "page", values: { title: "x".repeat(8192) } },
  ])
    await expect(api(write(input))).rejects.toThrow()
  expect(window.location.search).toBe("?source=review")
})
