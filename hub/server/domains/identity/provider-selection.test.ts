import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "#server/create-app"
import { createFixture } from "#server/domains/identity/create-service/test/create-fixture"
import type { IdentityService, IdentitySettings } from "#server/utils/identity-contracts/types"

const settings: IdentitySettings = {
  origin: "http://127.0.0.1",
  bootstrapSecret: "synthetic-bootstrap",
  secureCookies: false,
  demoMode: true,
  signInProviders: ["github", "oidc-demo"],
  repositoryProvider: "none",
}

function identityWith(overrides: Partial<IdentityService> & Pick<IdentityService, "start">) {
  return {
    settings: { ...settings },
    service: {
      ...overrides,
    } as IdentityService,
  }
}

async function withApp<T>(
  identity: Parameters<typeof createApp>[0],
  operation: (origin: string) => Promise<T>,
): Promise<T> {
  const server = createServer(createApp(identity))

  try {
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const { port } = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${port}`
    return await operation(origin)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

describe("identity provider selection", () => {
  it("allows bootstrap administrator enrollment only once when attempts overlap", async () => {
    const fixture = createFixture()
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    const firstAttempt = await fixture.begin({
      purpose: "enroll",
      bootstrapSecret: fixture.settings.bootstrapSecret,
    })
    const secondAttempt = await fixture.begin({
      purpose: "enroll",
      bootstrapSecret: fixture.settings.bootstrapSecret,
    })
    const firstResult = await fixture.service.complete(
      "first-code",
      firstAttempt.state,
      firstAttempt.browserToken,
    )
    const first = await fixture.service.current(firstResult.token!)
    fixture.github.identify.mockResolvedValue({
      ...fixture.profile,
      providerId: "different-account",
      login: "different-user",
    })

    await expect(
      fixture.service.complete("second-code", secondAttempt.state, secondAttempt.browserToken),
    ).rejects.toThrow()

    expect(first.user.administrator).toBe(true)
    expect(fixture.snapshot().users).toEqual([
      expect.objectContaining({
        id: first.user.id,
        providerId: fixture.profile.providerId,
        administrator: true,
      }),
    ])
  })

  it("creates an OIDC Hub session without GitHub credentials or repository integration", async () => {
    const fixture = createFixture({
      demoMode: true,
      signInProviders: ["oidc-demo"],
      repositoryProvider: "none",
    })

    expect(await fixture.service.configuration()).toEqual({
      demoMode: true,
      credentialProvider: "database",
      signInProviders: [{ name: "oidc-demo", configured: true }],
      repositoryProvider: "none",
    })

    const { token } = await fixture.service.signInWithOidcDemo({
      subject: "enterprise-user-1001",
      login: "mona",
      name: "Mona Lisa",
    })
    const current = await fixture.service.current(token)

    expect(current.user).toEqual(
      expect.objectContaining({
        provider: "oidc-demo",
        providerId: "enterprise-user-1001",
        login: "mona",
        name: "Mona Lisa",
      }),
    )
    expect(current.session.userId).toBe(current.user.id)
    expect(fixture.github.authorize).not.toHaveBeenCalled()
    expect(fixture.github.identify).not.toHaveBeenCalled()
    expect(fixture.github.admitted).not.toHaveBeenCalled()
    await expect(fixture.service.permission(token, "synthetic", "repository")).rejects.toThrow(
      "GitHub repository integration is not configured",
    )
  })

  it("creates a demo-only GitHub session with repository access without using OAuth clients", async () => {
    const fixture = createFixture({
      demoMode: true,
      signInProviders: ["github"],
      repositoryProvider: "github",
    })
    await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)

    const { token } = await fixture.service.signInWithGitHubDemo({
      subject: "github-user-1001",
      login: "octodemo",
      name: "Octo Demo",
    })
    const current = await fixture.service.current(token)

    expect(current.user).toEqual(
      expect.objectContaining({
        provider: "github",
        providerId: "github-user-1001",
        login: "octodemo",
        name: "Octo Demo",
      }),
    )
    expect(await fixture.service.permission(token, "github", "replica")).toBe("read")
    expect(fixture.github.permission).toHaveBeenCalledWith(
      fixture.credentials,
      expect.objectContaining({
        providerId: "github-user-1001",
        login: "octodemo",
      }),
      "github",
      "replica",
    )
    expect(fixture.github.authorize).not.toHaveBeenCalled()
    expect(fixture.github.identify).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: "demo mode is off",
      options: {
        demoMode: false,
        signInProviders: ["github"] as const,
        repositoryProvider: "github" as const,
      },
      configure: true,
      error: "The local GitHub sign-in simulation is not enabled.",
    },
    {
      name: "GitHub sign-in is disabled",
      options: {
        demoMode: true,
        signInProviders: ["oidc-demo"] as const,
        repositoryProvider: "github" as const,
      },
      configure: true,
      error: "The local GitHub sign-in simulation is not enabled.",
    },
    {
      name: "GitHub credentials are unconfigured",
      options: {
        demoMode: true,
        signInProviders: ["github"] as const,
        repositoryProvider: "github" as const,
      },
      configure: false,
      error: "Configure the GitHub App before signing in.",
    },
    {
      name: "the GitHub repository provider is not selected",
      options: {
        demoMode: true,
        signInProviders: ["github"] as const,
        repositoryProvider: "none" as const,
      },
      configure: true,
      error: "The GitHub sign-in simulation requires GitHub repository integration.",
    },
  ])("rejects GitHub demo sign-in when $name", async ({ options, configure, error }) => {
    const fixture = createFixture({
      ...options,
      signInProviders: [...options.signInProviders],
    })
    if (configure) {
      await fixture.service.setup(fixture.settings.bootstrapSecret, fixture.credentials)
    }

    await expect(
      fixture.service.signInWithGitHubDemo({
        subject: "github-user-1001",
        login: "octodemo",
        name: "Octo Demo",
      }),
    ).rejects.toThrow(error)

    expect(fixture.snapshot().sessions).toHaveLength(0)
    expect(fixture.github.authorize).not.toHaveBeenCalled()
    expect(fixture.github.identify).not.toHaveBeenCalled()
  })

  it("dispatches the explicitly selected local GitHub completion route without starting OAuth", async () => {
    const start = vi.fn<IdentityService["start"]>().mockResolvedValue({
      url: "https://github.com/login/oauth/authorize",
      browserToken: "browser-token",
    })
    const signInWithGitHubDemo = vi
      .fn<IdentityService["signInWithGitHubDemo"]>()
      .mockResolvedValue({ token: "github-session-token" })

    await withApp(identityWith({ start, signInWithGitHubDemo }), async (origin) => {
      const response = await fetch(`${origin}/api/auth/github-demo`, {
        method: "POST",
        headers: { origin: settings.origin, "content-type": "application/json" },
        body: JSON.stringify({
          subject: "github-user-1001",
          login: "octodemo",
          name: "Octo Demo",
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ signedIn: true })
      expect(signInWithGitHubDemo).toHaveBeenCalledExactlyOnceWith({
        subject: "github-user-1001",
        login: "octodemo",
        name: "Octo Demo",
      })
      expect(start).not.toHaveBeenCalled()
    })
  })

  it("dispatches the explicitly selected local OIDC route without starting GitHub", async () => {
    const start = vi.fn<IdentityService["start"]>().mockResolvedValue({
      url: "https://github.com/login/oauth/authorize",
      browserToken: "browser-token",
    })
    const signInWithOidcDemo = vi
      .fn<IdentityService["signInWithOidcDemo"]>()
      .mockResolvedValue({ token: "oidc-session-token" })

    await withApp(identityWith({ start, signInWithOidcDemo }), async (origin) => {
      const response = await fetch(`${origin}/api/auth/oidc-demo`, {
        method: "POST",
        headers: { origin: settings.origin, "content-type": "application/json" },
        body: JSON.stringify({
          subject: "enterprise-user-1001",
          login: "mona",
          name: "Mona Lisa",
        }),
      })

      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ signedIn: true })
      expect(signInWithOidcDemo).toHaveBeenCalledExactlyOnceWith({
        subject: "enterprise-user-1001",
        login: "mona",
        name: "Mona Lisa",
      })
      expect(start).not.toHaveBeenCalled()
    })
  })

  it.each([
    {
      name: "initiation",
      request: (origin: string) =>
        fetch(`${origin}/api/auth/github`, {
          method: "POST",
          headers: { origin: settings.origin },
        }),
      expectedBeforeLimit: 200,
    },
    {
      name: "callback",
      request: (origin: string) =>
        fetch(`${origin}/api/auth/github/callback?code=missing-state`, {
          headers: { origin: settings.origin },
          redirect: "manual",
        }),
      expectedBeforeLimit: 400,
    },
  ])(
    "limits auth $name to 60 attempts per five minutes for one request IP",
    async ({ request, expectedBeforeLimit }) => {
      const start = vi.fn<IdentityService["start"]>().mockResolvedValue({
        url: "https://github.com/login/oauth/authorize",
        browserToken: "browser-token",
      })
      let now = Date.now()
      vi.spyOn(Date, "now").mockImplementation(() => now)

      await withApp(identityWith({ start }), async (origin) => {
        for (let attempt = 0; attempt < 60; attempt++) {
          expect((await request(origin)).status).toBe(expectedBeforeLimit)
        }

        const limited = await request(origin)

        expect(limited.status).toBe(429)
        expect(await limited.json()).toEqual(
          expect.objectContaining({
            code: "rate_limited",
          }),
        )

        now += 5 * 60_000
        expect((await request(origin)).status).toBe(expectedBeforeLimit)
      })
    },
  )
})
