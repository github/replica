import { describe, expect, it } from "vitest"

import { createFixture } from "#server/domains/identity/create-service/test/create-fixture"

describe("createIdentityService()", () => {
  it("allows only the bootstrap secret to configure database credentials once", async () => {
    const fixture = createFixture()
    const { service, settings, credentials } = fixture

    await expect(service.setup("wrong", credentials)).rejects.toThrow()
    expect(fixture.snapshot().state.encryptedCredentials).toBeNull()
    for (const installationId of [undefined, 7, "0"]) {
      await expect(
        service.setup(settings.bootstrapSecret, { ...credentials, installationId }),
      ).rejects.toThrow()
      expect(fixture.snapshot().state.encryptedCredentials).toBeNull()
    }
    await service.setup(settings.bootstrapSecret, credentials)
    const saved = fixture.snapshot()
    expect(saved.state.encryptedCredentials).not.toContain(credentials.clientSecret)
    expect(fixture.provider.read(saved.state)).toEqual(credentials)
    expect(saved.audits).toHaveLength(1)
    await expect(
      service.setup(settings.bootstrapSecret, { ...credentials, clientSecret: "replacement" }),
    ).rejects.toThrow()
    expect(fixture.snapshot()).toEqual(saved)
  })

  it("does not allow setup or rotation to replace environment credentials", async () => {
    const fixture = createFixture({ environment: true })
    const administrator = await fixture.signIn("enroll")
    const before = fixture.snapshot()

    await expect(
      fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials),
    ).rejects.toThrow()
    await expect(
      fixture.service.rotate(administrator.token, administrator.csrfToken, fixture.credentials),
    ).rejects.toThrow()
    expect(fixture.snapshot()).toEqual(before)
    expect(fixture.provider.read(before.state)).toEqual(fixture.credentials)
  })

  it("binds sign-in to a one-use browser attempt and passes its PKCE verifier to GitHub", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const first = await fixture.begin()
    const second = await fixture.begin()
    expect(first.state).not.toBe(second.state)
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.browserToken).not.toBe(second.browserToken)
    expect(first.verifier.length).toBeGreaterThanOrEqual(43)
    const savedAttempt = fixture.snapshot().attempts[0]!
    expect(savedAttempt.stateDigest).not.toBe(first.state)
    expect(savedAttempt.browserDigest).not.toBe(first.browserToken)

    await expect(
      fixture.service.complete("code", first.state, second.browserToken),
    ).rejects.toThrow()
    const result = await fixture.service.complete("code", second.state, second.browserToken)
    expect(result.token).toEqual(expect.any(String))
    expect(fixture.github.identify).toHaveBeenCalledWith(
      fixture.credentials,
      "code",
      second.verifier,
    )
    await expect(
      fixture.service.complete("code", second.state, second.browserToken),
    ).rejects.toThrow()
    expect(fixture.snapshot().sessions).toHaveLength(1)
    expect(fixture.snapshot().sessions[0]!.tokenDigest).not.toBe(result.token)
  })

  it.each([15 * 60_000 - 1, 15 * 60_000])(
    "enforces the fifteen-minute attempt boundary after %i milliseconds",
    async (elapsed) => {
      const fixture = createFixture()
      await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
      const attempt = await fixture.begin()
      fixture.advance(elapsed)
      const completion = fixture.service.complete("code", attempt.state, attempt.browserToken)

      if (elapsed < 15 * 60_000) {
        expect((await completion).token).toEqual(expect.any(String))
      } else {
        await expect(completion).rejects.toThrow()
        expect(fixture.github.identify).not.toHaveBeenCalled()
        expect(fixture.snapshot().sessions).toEqual([])
      }
    },
  )

  it("keeps immutable GitHub accounts separate when logins change or are reused", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const original = await fixture.signIn()
    fixture.github.identify.mockResolvedValue({ ...fixture.profile, login: "renamed-user" })
    const renamed = await fixture.signIn()
    fixture.github.identify.mockResolvedValue({ ...fixture.profile, providerId: "20002" })
    const reused = await fixture.signIn()

    expect(renamed.user.id).toBe(original.user.id)
    expect(renamed.user.login).toBe("renamed-user")
    expect(reused.user.id).not.toBe(original.user.id)
    expect(reused.user.administrator).toBe(false)
    expect(fixture.snapshot().users).toHaveLength(2)
  })

  it("requires the bootstrap secret for administrator enrollment", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)

    await expect(
      fixture.service.start({ purpose: "enroll", bootstrapSecret: "wrong" }),
    ).rejects.toThrow()
    expect(fixture.github.authorize).not.toHaveBeenCalled()
    const administrator = await fixture.signIn("enroll")
    expect(administrator.user.administrator).toBe(true)
  })

  it("does not let sign-in refresh an older session's authorization", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const first = await fixture.signIn("enroll")
    fixture.advance(5 * 60_000)
    const second = await fixture.signIn()

    expect(second.session.freshAuthorizedAt!.getTime()).toBeGreaterThan(
      first.session.freshAuthorizedAt!.getTime(),
    )
    expect((await fixture.service.current(first.token)).session.freshAuthorizedAt).toEqual(
      first.session.freshAuthorizedAt,
    )
    await expect(
      fixture.service.rotate(first.token, first.csrfToken, fixture.credentials),
    ).rejects.toThrow()
  })

  it("lets an enrolled operator sign in during a repository admission outage after proving identity", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    fixture.github.admitted.mockRejectedValue(new Error("GitHub repository API unavailable"))

    const signedIn = await fixture.signIn()

    expect(signedIn.user.id).toBe(administrator.user.id)
    expect(signedIn.user.administrator).toBe(true)
    expect(fixture.github.admitted).not.toHaveBeenCalled()
  })

  it("does not extend fresh identity proof by the time spent checking repository admission", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    fixture.github.admitted.mockImplementation(() => {
      fixture.advance(5 * 60_000)
      return Promise.resolve(true)
    })

    const signedIn = await fixture.signIn()

    expect(signedIn.session.freshAuthorizedAt!.getTime()).toBe(
      signedIn.session.signedInAt.getTime() - 5 * 60_000,
    )
    await fixture.store.lock((records) => records.enroll(signedIn.user.id))
    await expect(
      fixture.service.rotate(signedIn.token, signedIn.csrfToken, fixture.credentials),
    ).rejects.toThrow()
  })

  it("verification refreshes only its originating session and creates no new session", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const first = await fixture.signIn()
    const second = await fixture.signIn()
    fixture.advance(5 * 60_000)
    await expect(
      fixture.begin({ purpose: "verify", token: first.token, csrfToken: "wrong" }),
    ).rejects.toThrow()
    const attempt = await fixture.begin({
      purpose: "verify",
      token: first.token,
      csrfToken: first.csrfToken,
    })

    expect(await fixture.service.complete("code", attempt.state, attempt.browserToken)).toEqual({})
    const refreshed = await fixture.service.current(first.token)
    expect(refreshed.session.freshAuthorizedAt!.getTime()).toBeGreaterThan(
      first.session.freshAuthorizedAt!.getTime(),
    )
    expect((await fixture.service.current(second.token)).session.freshAuthorizedAt).toEqual(
      second.session.freshAuthorizedAt,
    )
    expect(fixture.snapshot().sessions).toHaveLength(2)
  })

  it("rejects verification by a different immutable GitHub account despite a matching login", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const signedIn = await fixture.signIn()
    fixture.advance(5 * 60_000)
    const attempt = await fixture.begin({
      purpose: "verify",
      token: signedIn.token,
      csrfToken: signedIn.csrfToken,
    })
    fixture.github.identify.mockResolvedValue({
      ...fixture.profile,
      providerId: "different-account",
    })

    await expect(
      fixture.service.complete("code", attempt.state, attempt.browserToken),
    ).rejects.toThrow()
    expect((await fixture.service.current(signedIn.token)).session.freshAuthorizedAt).toEqual(
      signedIn.session.freshAuthorizedAt,
    )
    expect(fixture.snapshot().users).toHaveLength(1)
  })

  it("does not revive a session signed out while its verification callback is exchanging", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const signedIn = await fixture.signIn()
    const attempt = await fixture.begin({
      purpose: "verify",
      token: signedIn.token,
      csrfToken: signedIn.csrfToken,
    })
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.github.identify.mockImplementation(async () => {
      entered()
      await gate
      return { ...fixture.profile }
    })
    const completion = fixture.service.complete("code", attempt.state, attempt.browserToken)
    await started
    await fixture.service.signOut(signedIn.token, signedIn.csrfToken)
    release()

    await expect(completion).rejects.toThrow()
    expect(fixture.snapshot().sessions).toEqual([])
  })

  it.each(["denied", "outage"] as const)("fails sign-in closed for GitHub %s", async (failure) => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const attempt = await fixture.begin()
    if (failure === "denied") fixture.github.admitted.mockResolvedValue(false)
    else fixture.github.identify.mockRejectedValue(new Error("GitHub unavailable"))

    await expect(
      fixture.service.complete("code", attempt.state, attempt.browserToken),
    ).rejects.toThrow()
    expect(fixture.snapshot().sessions).toEqual([])
  })

  it("uses the current repository role even for administrators and fails closed on GitHub outages", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    fixture.github.permission.mockResolvedValueOnce("none").mockResolvedValueOnce("write")

    expect(await fixture.service.permission(administrator.token, "synthetic", "repository")).toBe(
      "none",
    )
    expect(await fixture.service.permission(administrator.token, "synthetic", "repository")).toBe(
      "write",
    )
    expect(fixture.github.permission).toHaveBeenLastCalledWith(
      fixture.credentials,
      expect.objectContaining({ providerId: fixture.profile.providerId }),
      "synthetic",
      "repository",
    )
    fixture.github.permission.mockRejectedValue(new Error("GitHub unavailable"))
    await expect(
      fixture.service.permission(administrator.token, "synthetic", "repository"),
    ).rejects.toThrow()
  })

  it("rechecks session revocation after outbound repository authorization", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const signedIn = await fixture.signIn()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.github.permission.mockImplementation(async () => {
      entered()
      await gate
      return "admin"
    })
    const permission = fixture.service.permission(signedIn.token, "synthetic", "repository")
    await started
    await fixture.service.signOut(signedIn.token, signedIn.csrfToken)
    release()

    await expect(permission).rejects.toThrow()
    await expect(fixture.service.current(signedIn.token)).rejects.toThrow()
  })

  it("requires an administrator, CSRF, confirmation, and proof strictly younger than five minutes for revocation", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const ordinary = await fixture.signIn()
    await expect(fixture.service.revoke(ordinary.token, ordinary.csrfToken, true)).rejects.toThrow()
    const administrator = await fixture.signIn("enroll")
    await expect(fixture.service.revoke(administrator.token, "wrong", true)).rejects.toThrow()
    await expect(
      fixture.service.revoke(administrator.token, administrator.csrfToken, false),
    ).rejects.toThrow()
    fixture.advance(5 * 60_000)
    await expect(
      fixture.service.revoke(administrator.token, administrator.csrfToken, true),
    ).rejects.toThrow()
    expect(fixture.snapshot().sessions).toHaveLength(2)
  })

  it("requires a live administrator session and CSRF for rotation", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const ordinary = await fixture.signIn()
    await expect(
      fixture.service.rotate(ordinary.token, ordinary.csrfToken, fixture.credentials),
    ).rejects.toThrow()
    const administrator = await fixture.signIn("enroll")
    await expect(
      fixture.service.rotate(administrator.token, "wrong", fixture.credentials),
    ).rejects.toThrow()
    await fixture.service.signOut(administrator.token, administrator.csrfToken)
    const before = fixture.snapshot()

    await expect(
      fixture.service.rotate(administrator.token, administrator.csrfToken, fixture.credentials),
    ).rejects.toThrow()
    expect(fixture.snapshot()).toEqual(before)
  })

  it("does not let credential rotation switch the GitHub App, OAuth client, or installation", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    const before = fixture.snapshot()

    for (const changed of [
      { appId: "99999" },
      { clientId: "different-client" },
      { installationId: "8" },
    ]) {
      await expect(
        fixture.service.rotate(administrator.token, administrator.csrfToken, {
          ...fixture.credentials,
          ...changed,
        }),
      ).rejects.toThrow()
      expect(fixture.snapshot()).toEqual(before)
    }
  })

  it("revokes every session and prevents an already-exchanging callback from creating another", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    await fixture.signIn()
    const attempt = await fixture.begin()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.github.identify.mockImplementation(async () => {
      entered()
      await gate
      return { ...fixture.profile }
    })
    const completion = fixture.service.complete("code", attempt.state, attempt.browserToken)
    await started
    fixture.advance(5 * 60_000 - 1)
    await fixture.service.revoke(administrator.token, administrator.csrfToken, true)
    release()

    await expect(completion).rejects.toThrow()
    expect(fixture.snapshot().sessions).toEqual([])
    expect(fixture.snapshot().attempts).toEqual([])
    await expect(fixture.service.current(administrator.token)).rejects.toThrow()
  })

  it("rotates credentials without revoking sessions but invalidates their fresh proof and old callbacks", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    const ordinary = await fixture.signIn()
    const attempt = await fixture.begin()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.github.identify.mockImplementation(async () => {
      entered()
      await gate
      return { ...fixture.profile }
    })
    const completion = fixture.service.complete("code", attempt.state, attempt.browserToken)
    await started
    const replacement = { ...fixture.credentials, clientSecret: "new-synthetic-secret" }
    await fixture.service.rotate(administrator.token, administrator.csrfToken, replacement)
    release()

    await expect(completion).rejects.toThrow()
    expect(fixture.provider.read(fixture.snapshot().state)).toEqual(replacement)
    await expect(fixture.service.current(administrator.token)).resolves.toBeDefined()
    await expect(fixture.service.current(ordinary.token)).resolves.toBeDefined()
    await expect(
      fixture.service.rotate(administrator.token, administrator.csrfToken, fixture.credentials),
    ).rejects.toThrow()
    expect(fixture.snapshot().sessions).toHaveLength(2)
    expect(fixture.snapshot().attempts).toEqual([])
  })

  it("does not revoke sessions when the durable audit cannot be saved", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const administrator = await fixture.signIn("enroll")
    const before = fixture.snapshot()
    fixture.failAudit()

    await expect(
      fixture.service.revoke(administrator.token, administrator.csrfToken, true),
    ).rejects.toThrow()
    expect(fixture.snapshot()).toEqual(before)
  })

  it("limits audit access to administrators and never includes credentials or raw session tokens", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const ordinary = await fixture.signIn()
    await expect(fixture.service.audits(ordinary.token)).rejects.toThrow()
    const administrator = await fixture.signIn("enroll")
    const audits = await fixture.service.audits(administrator.token)

    expect(audits.length).toBeGreaterThan(1)
    const output = JSON.stringify(audits)
    for (const secret of [
      fixture.credentials.clientSecret,
      fixture.credentials.privateKey,
      fixture.settings.bootstrapSecret,
      ordinary.token,
      administrator.token,
    ])
      expect(output).not.toContain(secret)
  })
})
