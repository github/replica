import { describe, expect, it, vi } from "vitest"

import { createServerFixture } from "#server/routes/test/create-server-fixture"

describe("routes()", () => {
  it("keeps browser and session secrets in secure cookies and omits internal session fields from JSON", async () => {
    const fixture = await createServerFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const start = await fixture.request("/api/auth/github", {
      method: "POST",
      headers: { origin: fixture.settings.origin },
    })
    expect(start.status).toBe(200)
    expect(await start.json()).toEqual({ url: "https://github.com/login/oauth/authorize" })
    const browserCookie = start.headers.getSetCookie()[0]!
    expect(browserCookie).toMatch(/^__Host-replica-oauth=[\w-]{43};/)
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=900"]) {
      expect(browserCookie).toContain(attribute)
    }
    expect(browserCookie).not.toMatch(/domain=/i)
    const state = fixture.github.authorize.mock.calls[0]![1]
    const callback = await fixture.request(
      `/api/auth/github/callback?code=synthetic-code&state=${state}`,
      { headers: { cookie: browserCookie.split(";")[0]! } },
    )
    expect(callback.status).toBe(303)
    expect(callback.headers.get("location")).toBe(`${fixture.settings.origin}/api/session`)
    const cookies = callback.headers.getSetCookie()
    expect(cookies.find((cookie) => cookie.startsWith("__Host-replica-oauth="))).toContain(
      "Expires=Thu, 01 Jan 1970",
    )
    const sessionCookie = cookies.find((cookie) => cookie.startsWith("__Host-replica-session="))!
    expect(sessionCookie).toMatch(/^__Host-replica-session=[\w-]{43};/)
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
      expect(sessionCookie).toContain(attribute)
    }

    const current = await fixture.request("/api/session", {
      headers: { cookie: sessionCookie.split(";")[0]! },
    })
    expect(current.status).toBe(200)
    expect(current.headers.get("cache-control")).toContain("no-store")
    expect(current.headers.get("referrer-policy")).toBe("no-referrer")
    const body = (await current.json()) as {
      session: { id: string; signedInAt: string }
      csrfToken: string
    }
    expect(body).toMatchObject({
      user: { providerId: fixture.profile.providerId },
    })
    expect(Object.keys(body.session).sort()).toEqual(["id", "signedInAt"])
    expect(typeof body.session.id).toBe("string")
    expect(typeof body.session.signedInAt).toBe("string")
    expect(typeof body.csrfToken).toBe("string")
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("tokenDigest")
    expect(serialized).not.toContain("credentialRevision")
    expect(serialized).not.toContain(fixture.credentials.clientSecret)
    expect(serialized).not.toContain(sessionCookie.split(";")[0]!.split("=")[1]!)
  })

  it("rejects missing or foreign origins before a bootstrap mutation reaches the service", async () => {
    const fixture = await createServerFixture()
    const lock = vi.spyOn(fixture.store, "lock")
    const audit = vi.spyOn(fixture.store.read, "audit")
    const state = vi.spyOn(fixture.store.read, "state")
    for (const origin of [undefined, "https://other.example.test"]) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-hub-bootstrap-secret": fixture.settings.bootstrapSecret,
      }
      if (origin) headers.origin = origin
      const result = await fixture.request("/api/setup/github", {
        method: "POST",
        headers,
        body: JSON.stringify(fixture.credentials),
      })
      expect(result.status).toBe(403)
    }
    expect(lock).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
    expect(fixture.snapshot().state.encryptedCredentials).toBeNull()
    const allowed = await fixture.request("/api/setup/github", {
      method: "POST",
      headers: {
        origin: fixture.settings.origin,
        "content-type": "application/json",
        "x-hub-bootstrap-secret": fixture.settings.bootstrapSecret,
      },
      body: JSON.stringify(fixture.credentials),
    })
    expect(allowed.status).toBe(201)
    expect(await allowed.json()).toEqual({ configured: true })
    expect(fixture.snapshot().audits.map(({ event }) => event)).toEqual(["credentials.setup"])
  })

  it("does not accept a callback without its same-browser cookie", async () => {
    const fixture = await createServerFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const attempt = await fixture.begin()

    const result = await fixture.request(
      `/api/auth/github/callback?code=synthetic-code&state=${attempt.state}`,
    )
    expect(result.status).toBe(401)
    expect(fixture.snapshot().sessions).toEqual([])
    expect(fixture.github.identify).not.toHaveBeenCalled()
  })

  it("clears the browser session cookie after sign-out", async () => {
    const fixture = await createServerFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const signedIn = await fixture.signIn()
    const headers = {
      origin: fixture.settings.origin,
      cookie: `__Host-replica-session=${signedIn.token}`,
    }
    const accepted = await fixture.request("/api/session", {
      method: "DELETE",
      headers: { ...headers, "x-csrf-token": signedIn.csrfToken },
    })

    expect(accepted.status).toBe(204)
    expect(accepted.headers.get("set-cookie")).toContain("__Host-replica-session=;")
    await expect(fixture.service.current(signedIn.token)).rejects.toThrow()
  })

  it("requires explicit boolean confirmation before passing replacement credentials to rotation", async () => {
    const fixture = await createServerFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    const credentials = { ...fixture.credentials, clientSecret: "replacement-synthetic-secret" }
    const headers = {
      origin: fixture.settings.origin,
      cookie: `__Host-replica-session=${administrator.token}`,
      "x-csrf-token": administrator.csrfToken,
      "content-type": "application/json",
    }
    for (const confirmed of [undefined, false, "true"]) {
      const rejected = await fixture.request("/api/administration/github-credentials", {
        method: "PUT",
        headers,
        body: JSON.stringify({ credentials, confirmed }),
      })
      expect(rejected.status).toBe(400)
      expect(fixture.provider.read(fixture.snapshot().state)).toEqual(fixture.credentials)
    }
    const accepted = await fixture.request("/api/administration/github-credentials", {
      method: "PUT",
      headers,
      body: JSON.stringify({ credentials, confirmed: true }),
    })

    expect(accepted.status).toBe(204)
    expect(fixture.provider.read(fixture.snapshot().state)).toEqual(credentials)
    expect(await accepted.text()).toBe("")
  })

  it("returns a generic failure without leaking upstream credentials in API responses or logs", async () => {
    const fixture = await createServerFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const signedIn = await fixture.signIn()
    const before = fixture.snapshot()
    const lock = vi.spyOn(fixture.store, "lock")
    const audit = vi.spyOn(fixture.store.read, "audit")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    fixture.github.permission.mockRejectedValue(
      new Error(`GitHub rejected ${fixture.credentials.clientSecret}`),
    )

    const result = await fixture.request("/api/repositories/synthetic/repository/access", {
      headers: { cookie: `__Host-replica-session=${signedIn.token}` },
    })
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain(fixture.credentials.clientSecret)
    expect(JSON.stringify(log.mock.calls)).not.toContain(fixture.credentials.clientSecret)
    expect(fixture.snapshot()).toEqual(before)
    expect(lock).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it("rejects malformed JSON without touching identity storage even when auditing is unavailable", async () => {
    const fixture = await createServerFixture()
    const before = fixture.snapshot()
    fixture.failAudit()
    const lock = vi.spyOn(fixture.store, "lock")
    const audit = vi.spyOn(fixture.store.read, "audit")
    const state = vi.spyOn(fixture.store.read, "state")
    const result = await fixture.request("/api/setup/github", {
      method: "POST",
      headers: {
        origin: fixture.settings.origin,
        "x-hub-bootstrap-secret": fixture.settings.bootstrapSecret,
        "content-type": "application/json",
      },
      body: '{"clientSecret":"synthetic-secret",',
    })

    expect(result.status).toBe(400)
    expect(await result.text()).not.toContain("synthetic-secret")
    expect(lock).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(state).not.toHaveBeenCalled()
    expect(fixture.snapshot()).toEqual(before)
  })

  it("preserves CSRF and unauthenticated denials without audit writes when auditing is unavailable", async () => {
    const fixture = await createServerFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const signedIn = await fixture.signIn()
    const before = fixture.snapshot()
    fixture.failAudit()
    const audit = vi.spyOn(fixture.store.read, "audit")
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await fixture.request("/api/session", {
      method: "DELETE",
      headers: {
        origin: fixture.settings.origin,
        cookie: `__Host-replica-session=${signedIn.token}`,
      },
    })

    expect(result.status).toBe(403)
    const body = (await result.json()) as { code: string }
    expect(body.code).toBe("csrf_failed")
    const unauthenticated = await fixture.request("/api/session")
    expect(unauthenticated.status).toBe(401)
    expect(audit).not.toHaveBeenCalled()
    expect(fixture.snapshot()).toEqual(before)
    expect(JSON.stringify(body)).not.toContain(signedIn.token)
    expect(JSON.stringify(log.mock.calls)).not.toContain(signedIn.token)
  })
})
