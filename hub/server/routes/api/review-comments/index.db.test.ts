import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { prisma } from "../../../integrations/prisma"
import { createProductRouteDependencies } from "../product/create-product-route-dependencies"
import type { AuthenticationRouteDependencies } from "../auth/types"

const anchor = {
  schemaVersion: 1,
  kind: "element",
  route: { pathname: "/checkout", search: "", hash: "" },
  selector: "#delivery-address",
  accessibleName: "Delivery address",
  tagName: "section",
  selectedText: "",
  rect: { x: 24, y: 120, width: 640, height: 240 },
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 40 },
  elementOffset: { x: 0.25, y: 0.5 },
}

type Session = Awaited<ReturnType<AuthenticationRouteDependencies["currentSession"]["restore"]>>

async function withServer(
  restore: AuthenticationRouteDependencies["currentSession"]["restore"],
  operation: (baseUrl: string) => Promise<void>,
) {
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore },
    signOut: { applicationOrigin: "http://127.0.0.1:5173", secureCookie: false, end: vi.fn() },
  }
  const server = createServer(
    createApp({
      authentication,
      product: createProductRouteDependencies({
        authorizeReviewMutation: () => Promise.resolve(true),
      }),
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

async function createMember(login: string, name: string | null): Promise<NonNullable<Session>> {
  const user = await prisma.user.create({
    data: { profile: { create: { provider: "github", login, name } } },
  })
  return {
    membershipId: randomUUID(),
    userId: user.id,
    provider: "github",
    login,
    name,
    role: "MEMBER",
  }
}

async function createReviewTarget() {
  const repository = await prisma.repository.create({
    data: {
      nameWithOwner: `team/review-${randomUUID()}`,
      defaultBranch: "main",
    },
  })
  const prototype = await prisma.prototype.create({
    data: {
      repositoryId: repository.id,
      branchName: "prototype/checkout",
      name: "Checkout",
      registeredAt: new Date("2026-11-01T00:00:00Z"),
    },
  })
  const build = await prisma.build.create({
    data: {
      prototypeId: prototype.id,
      number: 12,
      state: "successful",
    },
  })
  const path = `/api/repositories/${repository.id}/prototypes/${prototype.id}/review-comments`
  return { repository, prototype, build, path }
}

const sessionHeaders = {
  cookie: "hub_session=member-session",
  "content-type": "application/json",
  origin: "http://127.0.0.1:5173",
}

describe("review comments API", () => {
  it("rejects cross-origin review mutations before saving data", async () => {
    const target = await createReviewTarget()
    const member = await createMember("mona", "Mona")
    const restore = vi.fn().mockResolvedValue(member)

    await withServer(restore, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: {
          cookie: sessionHeaders.cookie,
          "content-type": sessionHeaders["content-type"],
          origin: "https://attacker.example",
        },
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Cross-origin comment",
            anchor,
          },
        }),
      })

      expect(response.status).toBe(403)
      expect(await prisma.reviewThread.count()).toBe(0)
    })
  })

  it("requires a live member session and hides removed repositories", async () => {
    const target = await createReviewTarget()
    const member = await createMember("mona", "Mona")
    const restore = vi.fn().mockResolvedValue(member)

    await withServer(restore, async (baseUrl) => {
      const unsigned = await fetch(`${baseUrl}${target.path}`)
      expect(unsigned.status).toBe(401)
      expect(await unsigned.json()).toEqual({ error: "Sign in to continue." })

      const createdResponse = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Created before repository removal.",
            anchor,
          },
        }),
      })
      expect(createdResponse.status).toBe(201)
      const created = (await createdResponse.json()) as { comments: { id: number }[] }
      const root = created.comments[0]
      if (!root) throw new Error("Expected a root comment")
      expect(root.id).toEqual(expect.any(Number))
      expect(root.id).toBeGreaterThan(0)
      await prisma.repository.update({
        where: { id: target.repository.id },
        data: { removedAt: new Date("2026-11-13T00:00:00Z") },
      })

      const hidden = await fetch(`${baseUrl}${target.path}`, { headers: sessionHeaders })
      expect(hidden.status).toBe(404)
      const hiddenBody = (await hidden.json()) as { error?: unknown }
      expect(typeof hiddenBody.error).toBe("string")
      const hiddenReply = await fetch(`${baseUrl}${target.path}/${root.id}/replies`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "Reply after repository removal" } }),
      })
      expect(hiddenReply.status).toBe(404)

      const missing = await fetch(
        `${baseUrl}/api/repositories/${randomUUID()}/prototypes/${randomUUID()}/review-comments`,
        { headers: sessionHeaders },
      )
      expect(missing.status).toBe(404)
    })
  })

  it("creates and lists the same complete canonical thread", async () => {
    const target = await createReviewTarget()
    const member = await createMember("mona", "Mona")
    const restore = vi.fn().mockResolvedValue(member)

    await withServer(restore, async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Please align this section.",
            anchor,
          },
        }),
      })
      expect(createdResponse.status).toBe(201)
      const created = (await createdResponse.json()) as {
        comments: {
          id: number
          kind: string
          buildNumber: number
          anchor: typeof anchor
          body: string
          author: { login: string; name: string | null }
          resolutionHistory: unknown[]
          resolvedAt: string | null
          resolvedBy: unknown
        }[]
      }
      expect(created.comments).toHaveLength(1)
      expect(created.comments[0]).toMatchObject({
        kind: "root",
        buildNumber: 12,
        anchor,
        body: "Please align this section.",
        author: {
          login: "mona",
          name: "Mona",
        },
        resolutionHistory: [],
        resolvedAt: null,
        resolvedBy: null,
      })
      expect(Number.isInteger(created.comments[0]?.id)).toBe(true)

      const listedResponse = await fetch(`${baseUrl}${target.path}`, {
        headers: sessionHeaders,
      })
      expect(listedResponse.status).toBe(200)
      expect(await listedResponse.json()).toEqual({
        comments: created.comments,
        nextCursor: null,
        hasMore: false,
      })
    })
  })

  it("does not return review data after the session is revoked during the read", async () => {
    const target = await createReviewTarget()
    const member = await createMember("mona", "Mona")
    const restore = vi.fn().mockResolvedValue(member)

    await withServer(restore, async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Do not return this after revocation.",
            anchor,
          },
        }),
      })
      expect(createdResponse.status).toBe(201)
      restore.mockReset().mockResolvedValueOnce(member).mockResolvedValueOnce(null)

      const response = await fetch(`${baseUrl}${target.path}`, { headers: sessionHeaders })

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "Sign in to continue." })
    })
  })

  it("allows only the stable author UUID to edit or delete a comment", async () => {
    const target = await createReviewTarget()
    const author = await createMember("mona", "Mona")
    const otherMember = await createMember("hubot", "Hubot")
    const restore = vi.fn().mockResolvedValue(author)

    await withServer(restore, async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Original text",
            anchor,
          },
        }),
      })
      expect(createdResponse.status).toBe(201)
      const created = (await createdResponse.json()) as {
        comments: { id: number }[]
      }
      const root = created.comments[0]
      if (!root) throw new Error("Expected a root comment")
      const commentPath = `${target.path}/${root.id}`

      restore.mockResolvedValue(otherMember)
      const forbiddenEdit = await fetch(`${baseUrl}${commentPath}`, {
        method: "PATCH",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "Changed by another reviewer" } }),
      })
      expect(forbiddenEdit.status).toBe(403)
      const forbiddenDelete = await fetch(`${baseUrl}${commentPath}`, {
        method: "DELETE",
        headers: sessionHeaders,
      })
      expect(forbiddenDelete.status).toBe(403)
      const unchangedResponse = await fetch(`${baseUrl}${target.path}`, {
        headers: sessionHeaders,
      })
      expect(unchangedResponse.status).toBe(200)
      const unchanged = (await unchangedResponse.json()) as {
        comments: { id: number; body: string | null; deletedAt: string | null }[]
      }
      expect(unchanged.comments.find(({ id }) => id === root.id)).toMatchObject({
        body: "Original text",
        deletedAt: null,
      })

      restore.mockResolvedValue(author)
      const editedResponse = await fetch(`${baseUrl}${commentPath}`, {
        method: "PATCH",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "Edited by the author" } }),
      })
      expect(editedResponse.status).toBe(200)
      const edited = (await editedResponse.json()) as {
        comments: {
          id: number
          body: string
          editedAt: string | null
          anchor: typeof anchor
          buildNumber: number
        }[]
      }
      expect(edited.comments).toHaveLength(1)
      expect(edited.comments[0]).toMatchObject({
        id: root.id,
        body: "Edited by the author",
        anchor,
        buildNumber: target.build.number,
      })
      expect(edited.comments[0]?.editedAt).not.toBeNull()

      const deletedResponse = await fetch(`${baseUrl}${commentPath}`, {
        method: "DELETE",
        headers: sessionHeaders,
      })
      expect(deletedResponse.status).toBe(200)
      const deleted = (await deletedResponse.json()) as {
        comments: {
          id: number
          body: string | null
          editedAt: string | null
          deletedAt: string | null
        }[]
      }
      expect(deleted.comments).toHaveLength(1)
      expect(deleted.comments[0]).toMatchObject({
        id: root.id,
        body: null,
        editedAt: null,
      })
      expect(deleted.comments[0]?.deletedAt).not.toBeNull()
    })
  })

  it("rejects replies while resolved and accepts them after reopening", async () => {
    const target = await createReviewTarget()
    const member = await createMember("mona", "Mona")
    const restore = vi.fn().mockResolvedValue(member)

    await withServer(restore, async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Resolve after the fix.",
            anchor,
          },
        }),
      })
      expect(createdResponse.status).toBe(201)
      const created = (await createdResponse.json()) as { comments: { id: number }[] }
      const root = created.comments[0]
      if (!root) throw new Error("Expected a root comment")
      const resolutionPath = `${target.path}/${root.id}/resolution`
      const repliesPath = `${target.path}/${root.id}/replies`

      const resolvedResponse = await fetch(`${baseUrl}${resolutionPath}`, {
        method: "POST",
        headers: sessionHeaders,
      })
      expect(resolvedResponse.status).toBe(200)
      const resolved = (await resolvedResponse.json()) as {
        comments: { resolutionHistory: { state: string }[] }[]
      }
      expect(resolved.comments[0]?.resolutionHistory.map(({ state }) => state)).toEqual([
        "resolved",
      ])

      const rejectedReply = await fetch(`${baseUrl}${repliesPath}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "Reply while resolved" } }),
      })
      expect(rejectedReply.status).toBe(422)
      expect(await rejectedReply.json()).toEqual({
        errors: ["Resolved review threads must be reopened before replying"],
      })

      const reopenedResponse = await fetch(`${baseUrl}${resolutionPath}`, {
        method: "DELETE",
        headers: sessionHeaders,
      })
      expect(reopenedResponse.status).toBe(200)
      const reopened = (await reopenedResponse.json()) as {
        comments: { resolutionHistory: { state: string }[] }[]
      }
      expect(reopened.comments[0]?.resolutionHistory.map(({ state }) => state)).toEqual([
        "resolved",
        "reopened",
      ])

      const acceptedReply = await fetch(`${baseUrl}${repliesPath}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "Reply after reopening" } }),
      })
      expect(acceptedReply.status).toBe(201)
      expect(await acceptedReply.json()).toMatchObject({
        comments: [
          {
            kind: "reply",
            rootId: root.id,
            body: "Reply after reopening",
            author: { login: member.login, name: member.name },
          },
          { id: root.id, kind: "root" },
        ],
      })
    })
  })

  it("returns the reply created by this request when timestamps do not preserve insertion order", async () => {
    const target = await createReviewTarget()
    const member = await createMember("mona", "Mona")
    const restore = vi.fn().mockResolvedValue(member)

    await withServer(restore, async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}${target.path}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          review_comment: {
            build_number: target.build.number,
            body: "Root",
            anchor,
          },
        }),
      })
      const created = (await createdResponse.json()) as { comments: { id: number }[] }
      const root = created.comments[0]
      if (!root) throw new Error("Expected a root comment")
      const repliesPath = `${target.path}/${root.id}/replies`
      const firstResponse = await fetch(`${baseUrl}${repliesPath}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "First reply" } }),
      })
      const first = (await firstResponse.json()) as { comments: { id: number }[] }
      const firstReply = first.comments[0]
      if (!firstReply) throw new Error("Expected a reply")
      await prisma.reviewComment.update({
        where: { publicId: firstReply.id },
        data: { createdAt: new Date("2099-01-01T00:00:00Z") },
      })

      const secondResponse = await fetch(`${baseUrl}${repliesPath}`, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ review_comment: { body: "Second reply" } }),
      })

      expect(secondResponse.status).toBe(201)
      expect(await secondResponse.json()).toMatchObject({
        comments: [
          { kind: "reply", body: "Second reply", rootId: root.id },
          { kind: "root", id: root.id },
        ],
      })
    })
  })
})
