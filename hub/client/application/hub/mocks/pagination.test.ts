import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { PrototypeRecord } from "../contracts/types"
import { getAuthors } from "../requests/get-authors"
import { getBuildHistory } from "../requests/get-build-history"
import { getRepository } from "../requests/get-repository"
import { getSession } from "../requests/get-session"
import { settingsRequest } from "../requests/settings-request"
import { settingsWorkspaceResponseSchema } from "../settings-contracts"
import { createMockHandlers } from "./create-mock-handlers"
import { createMockStore } from "./create-mock-store"

describe("mock collection pagination", () => {
  it("serves complete 24-prototype pages and applies search and author filters before paging", async () => {
    vi.stubEnv("MODE", "development")
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const request = new Request(`${store.origin}/repositories/2001`)
    const first = await getRepository(request, 2001)

    expect(first.pagination.pageSize).toBe(24)
    expect(first.pagination.totalCount).toBeGreaterThan(48)
    const records: PrototypeRecord[] = [...first.prototypes]
    for (let page = 2; page <= first.pagination.pageCount; page += 1) {
      const next = await getRepository(new Request(`${request.url}?page=${page}`), 2001)
      expect(next.pagination).toMatchObject({
        page,
        pageSize: 24,
        totalCount: first.pagination.totalCount,
        pageCount: first.pagination.pageCount,
      })
      expect(next.prototypes).toHaveLength(
        Math.min(24, first.pagination.totalCount - (page - 1) * 24),
      )
      records.push(...next.prototypes)
    }
    expect(first.prototypes).toHaveLength(24)
    expect(records).toHaveLength(first.pagination.totalCount)
    expect(new Set(records.map(({ id }) => id)).size).toBe(records.length)
    const viewer = (await getSession(request)).viewer
    if (!viewer) throw new Error("The default collection requires a signed-in viewer.")
    const owned = records.filter(({ authorLogin }) => authorLogin === viewer.login)
    const mine = await getRepository(new Request(`${request.url}?author=me`), 2001)
    expect(mine.pagination.totalCount).toBe(owned.length)
    expect(mine.prototypes.map(({ id }) => id)).toEqual(owned.slice(0, 24).map(({ id }) => id))
    const author = first.authors.find(({ login }) => login !== viewer.login)
    if (!author) throw new Error("The collection must support another author filter.")
    const example = records.find(({ authorLogin }) => authorLogin === author.login)
    if (!example) throw new Error("An available author must have a prototype.")
    const q = example.name.toUpperCase()
    const filtered = await getRepository(
      new Request(`${request.url}?${new URLSearchParams({ q, author: author.id })}`),
      2001,
    )
    const expected = records.filter(
      (record) =>
        record.authorLogin === author.login &&
        [record.name, record.branchName, record.description ?? ""].some((value) =>
          value.toUpperCase().includes(q),
        ),
    )
    expect(filtered.pagination.totalCount).toBe(expected.length)
    expect(filtered.prototypes.map(({ id }) => id)).toEqual(
      expected.slice(0, 24).map(({ id }) => id),
    )
    const empty = await getRepository(new Request(`${store.origin}/repositories/2002`), 2002)
    expect(empty.prototypes).toEqual([])
    expect(empty.pagination).toEqual({ page: 1, pageSize: 24, totalCount: 0, pageCount: 1 })
    const forcedEmpty = await fetch(`${store.origin}/api/repositories/2001`, {
      headers: { "X-Replica-Mock-Scenario": "empty" },
    })
    await expect(forcedEmpty.json()).resolves.toMatchObject({
      prototypes: [],
      pagination: { page: 1, pageSize: 24, totalCount: 0, pageCount: 1 },
    })
  })

  it("serves 25 Builds per history page without gaps or duplicates through the last page", async () => {
    vi.stubEnv("MODE", "development")
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const url = `${store.origin}/repositories/2001/prototypes/1/builds`
    const first = await getBuildHistory(new Request(url), 2001, 1)

    expect(first.pagination.pageSize).toBe(25)
    expect(first.pagination.totalCount).toBeGreaterThan(50)
    expect(first.builds).toHaveLength(25)
    const numbers = first.builds.map(({ number }) => number)
    for (let page = 2; page <= first.pagination.pageCount; page += 1) {
      const next = await getBuildHistory(new Request(`${url}?page=${page}`), 2001, 1)
      expect(next.pagination).toMatchObject({
        page,
        pageSize: 25,
        totalCount: first.pagination.totalCount,
      })
      expect(next.builds).toHaveLength(Math.min(25, first.pagination.totalCount - (page - 1) * 25))
      numbers.push(...next.builds.map(({ number }) => number))
    }
    expect(numbers).toHaveLength(first.pagination.totalCount)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers).toEqual([...numbers].sort((left, right) => right - left))
    const empty = await getBuildHistory(
      new Request(`${store.origin}/repositories/2001/prototypes/3/builds`),
      2001,
      3,
    )
    expect(empty.builds).toEqual([])
    expect(empty.pagination.pageSize).toBe(25)
    const forcedEmpty = await fetch(`${store.origin}/api/repositories/2001/prototypes/1/builds`, {
      headers: { "X-Replica-Mock-Scenario": "empty" },
    })
    await expect(forcedEmpty.json()).resolves.toMatchObject({
      builds: [],
      pagination: { page: 1, pageSize: 25, totalCount: 0, pageCount: 1 },
    })
  })

  it("advances 20-author cursors without repeats and searches login and display name", async () => {
    vi.stubEnv("MODE", "development")
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const options = {
      origin: store.origin,
      repositoryId: 2001,
      query: "",
      cursor: null,
      signal: new AbortController().signal,
    }
    const first = await getAuthors(options)

    expect(first.authors).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    const authors = [...first.authors]
    let cursor = first.nextCursor
    while (cursor !== null) {
      const next = await getAuthors({ ...options, cursor })
      expect(next.authors.length).toBeGreaterThan(0)
      expect(next.authors.length).toBeLessThanOrEqual(20)
      authors.push(...next.authors)
      expect(new Set(authors.map(({ id }) => id)).size).toBe(authors.length)
      if (next.nextCursor !== null) expect(next.nextCursor).not.toBe(cursor)
      cursor = next.nextCursor
    }
    expect(authors.length).toBeGreaterThan(20)
    expect(new Set(authors.map(({ id }) => id)).size).toBe(authors.length)
    const named = authors.find(({ name }) => name && name.length > 3)
    if (!named?.name) throw new Error("The author search needs a named user.")
    for (const query of [named.login.toUpperCase(), named.name.toUpperCase()]) {
      const filtered = await getAuthors({ ...options, query })
      const expected = authors.filter((author) =>
        [author.login, author.name ?? ""].some((value) => value.toUpperCase().includes(query)),
      )
      expect(filtered.authors).toEqual(expected.slice(0, 20))
    }
  })

  it("serves 50 notifications per page and applies the unread filter before pagination", async () => {
    vi.stubEnv("MODE", "development")
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const url = `${store.origin}/notifications`
    const first = await settingsRequest(
      new Request(url),
      "workspace",
      settingsWorkspaceResponseSchema,
    )

    expect(first.notifications.items).toHaveLength(50)
    expect(first.notifications.limit).toBe(50)
    expect(first.notifications.hasMore).toBe(true)
    const notifications = [...first.notifications.items]
    let hasMore = first.notifications.hasMore
    for (let page = 2; hasMore; page += 1) {
      const next = await settingsRequest(
        new Request(`${url}?page=${page}`),
        "workspace",
        settingsWorkspaceResponseSchema,
      )
      expect(next.notifications.items.length).toBeGreaterThan(0)
      expect(next.notifications.items.length).toBeLessThanOrEqual(50)
      expect(next.notifications.unreadCount).toBe(first.notifications.unreadCount)
      notifications.push(...next.notifications.items)
      expect(new Set(notifications.map(({ id }) => id)).size).toBe(notifications.length)
      hasMore = next.notifications.hasMore
    }
    expect(notifications.length).toBeGreaterThan(50)
    const unread = await settingsRequest(
      new Request(`${url}?unread=true`),
      "workspace",
      settingsWorkspaceResponseSchema,
    )
    expect(unread.notifications.unreadOnly).toBe(true)
    expect(unread.notifications.items).toEqual(
      notifications.filter(({ read }) => !read).slice(0, 50),
    )
    expect(unread.notifications.unreadCount).toBe(notifications.filter(({ read }) => !read).length)
  })

  it("serves 50 audit records per page and keeps repository and Hub scopes separate", async () => {
    vi.stubEnv("MODE", "development")
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    store.settings.mutate({ operation: "copilot-disconnect", confirmed: true })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const url = `${store.origin}/settings/audit?repositoryId=2001`
    const first = await settingsRequest(
      new Request(url),
      "workspace",
      settingsWorkspaceResponseSchema,
    )

    expect(first.audit.events).toHaveLength(50)
    expect(first.audit.nextPage).toBe(2)
    const events = [...first.audit.events]
    let page = first.audit.nextPage
    while (page !== null) {
      const next = await settingsRequest(
        new Request(`${url}&page=${page}`),
        "workspace",
        settingsWorkspaceResponseSchema,
      )
      expect(next.audit.events.length).toBeGreaterThan(0)
      expect(next.audit.events.length).toBeLessThanOrEqual(50)
      events.push(...next.audit.events)
      expect(new Set(events.map(({ id }) => id)).size).toBe(events.length)
      if (next.audit.nextPage !== null) expect(next.audit.nextPage).toBe(page + 1)
      page = next.audit.nextPage
    }
    expect(events.length).toBeGreaterThan(50)
    expect(new Set(events.map(({ id }) => id)).size).toBe(events.length)
    expect(events.every(({ repositoryId }) => repositoryId === 2001)).toBe(true)
    const otherRepository = await settingsRequest(
      new Request(`${store.origin}/settings/audit?repositoryId=2002`),
      "workspace",
      settingsWorkspaceResponseSchema,
    )
    expect(otherRepository.audit.events).toEqual([])
    const hub = await settingsRequest(
      new Request(`${store.origin}/settings/audit?scope=hub`),
      "workspace",
      settingsWorkspaceResponseSchema,
    )
    expect(hub.audit.accessDenied).toBe(false)
    expect(hub.audit.scope).toBe("hub")
    expect(hub.audit.events.some(({ repositoryId }) => repositoryId === null)).toBe(true)
    expect(first.audit.events.some(({ repositoryId }) => repositoryId === null)).toBe(false)
  })
})
