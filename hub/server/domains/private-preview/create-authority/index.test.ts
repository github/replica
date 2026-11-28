import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { privatePreviewAddress } from "../../../utils/private-preview-address"
import { createPrivatePreviewAuthority } from "."

type Dependencies = Parameters<typeof createPrivatePreviewAuthority>[0]
type Viewer = Awaited<ReturnType<Dependencies["restoreSession"]>> & object

const address = privatePreviewAddress("901", "1201")!
const path = "dist/style.css"
const file = { storageKey: "synthetic-style", byteLength: 20 }
const allowedFile = { ...file, path }
const readerOrigin = "https://reader.example.test"

function readerSession(sessionDigest: string, buildId: string) {
  return {
    buildId,
    sessionDigest,
    readerOrigin,
    tokenDigest: randomBytes(32).toString("hex"),
    challengeDigest: null,
    now: new Date(),
    // Outlasts the fake performance clock advanced past the remembered-result lifetime.
    expiresAt: new Date(Date.now() + 60 * 60_000),
  }
}

function fixture() {
  const viewer: Viewer = {
    userId: randomUUID(),
    membershipId: randomUUID(),
    role: "MEMBER",
    sessionProvider: "github",
  }
  const target = { buildId: randomUUID(), repositoryId: randomUUID(), startPage: "/" }
  const sessionDigest = randomBytes(32).toString("hex")
  const restoreSession = vi.fn<Dependencies["restoreSession"]>().mockResolvedValue(viewer)
  const isRepositoryVisible = vi.fn<Dependencies["isRepositoryVisible"]>().mockResolvedValue(true)
  const hasCurrentRepositoryAccess = vi
    .fn<Dependencies["hasCurrentRepositoryAccess"]>()
    .mockResolvedValue(true)
  const findTarget = vi.fn<Dependencies["findTarget"]>().mockResolvedValue(target)
  const read = vi
    .fn<Dependencies["access"]["read"]>()
    .mockImplementation(() => Promise.resolve(readerSession(sessionDigest, target.buildId)))
  const findDistFile = vi.fn<Dependencies["findDistFile"]>().mockResolvedValue(file)
  const authority = createPrivatePreviewAuthority({
    readerOrigin,
    restoreSession,
    isRepositoryVisible,
    hasCurrentRepositoryAccess,
    findTarget,
    access: {
      clock: vi.fn(() => Promise.resolve(new Date())),
      read,
      issue: vi.fn<Dependencies["access"]["issue"]>(),
      exchange: vi.fn<Dependencies["access"]["exchange"]>(),
    },
    findDistFile,
    storage: { read: vi.fn<Dependencies["storage"]["read"]>() },
  })
  return {
    viewer,
    target,
    sessionDigest,
    restoreSession,
    isRepositoryVisible,
    hasCurrentRepositoryAccess,
    findTarget,
    read,
    findDistFile,
    authority,
    requestFile: (requested = address, token = randomBytes(32).toString("base64url")) =>
      authority.authorizeFile(token, requested, path, false),
  }
}

function deferred<Value = boolean>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe("createPrivatePreviewAuthority()", () => {
  describe("authorizeFile()", () => {
    it("shares one in-flight repository check between concurrent file requests", async () => {
      const { viewer, target, isRepositoryVisible, hasCurrentRepositoryAccess, requestFile } =
        fixture()
      const check = deferred()
      hasCurrentRepositoryAccess.mockReturnValue(check.promise)

      const requests = [requestFile(), requestFile(), requestFile()]
      await vi.waitFor(() => expect(isRepositoryVisible).toHaveBeenCalledTimes(3))
      await new Promise((settle) => setImmediate(settle))

      expect(hasCurrentRepositoryAccess).toHaveBeenCalledExactlyOnceWith(
        viewer,
        target.repositoryId,
        BigInt(address.repositoryId),
      )
      check.resolve(true)
      await expect(Promise.all(requests)).resolves.toEqual([allowedFile, allowedFile, allowedFile])
    })

    it("reuses an allowed repository check for five minutes and then checks again", async () => {
      vi.useFakeTimers({ toFake: ["performance"] })
      const { hasCurrentRepositoryAccess, requestFile } = fixture()

      await expect(requestFile()).resolves.toEqual(allowedFile)
      vi.advanceTimersByTime(5 * 60_000 - 1)
      await expect(requestFile()).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(1)
      await expect(requestFile()).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
    })

    it.each(["denies access", "is unavailable"] as const)(
      "checks again after the repository check %s",
      async (outcome) => {
        const { hasCurrentRepositoryAccess, requestFile } = fixture()
        const unavailable = new Error("Synthetic repository authority outage")
        if (outcome === "denies access") hasCurrentRepositoryAccess.mockResolvedValueOnce(false)
        else hasCurrentRepositoryAccess.mockRejectedValueOnce(unavailable)

        const first = requestFile()

        if (outcome === "denies access") await expect(first).resolves.toBeNull()
        else await expect(first).rejects.toBe(unavailable)
        await expect(requestFile()).resolves.toEqual(allowedFile)
        expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
      },
    )

    it.each([
      "another Hub session of the same user",
      "a changed role in the same Hub session",
      "another Build",
    ] as const)("does not reuse an allowed repository check for %s", async (change) => {
      const {
        viewer,
        target,
        sessionDigest,
        restoreSession,
        hasCurrentRepositoryAccess,
        findTarget,
        read,
        requestFile,
      } = fixture()
      await expect(requestFile()).resolves.toEqual(allowedFile)

      let requested = address
      if (change === "another Hub session of the same user") {
        read.mockResolvedValue(readerSession(randomBytes(32).toString("hex"), target.buildId))
      } else if (change === "a changed role in the same Hub session") {
        restoreSession.mockResolvedValue({ ...viewer, role: "ADMINISTRATOR" })
      } else {
        const otherTarget = { ...target, buildId: randomUUID() }
        requested = privatePreviewAddress("901", "1202")!
        findTarget.mockImplementation((candidate) =>
          Promise.resolve(candidate.runId === requested.runId ? otherTarget : target),
        )
        read.mockResolvedValue(readerSession(sessionDigest, otherTarget.buildId))
      }

      await expect(requestFile(requested)).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
    })

    it.each([
      ["the Hub session ends", "session-ended"],
      ["the repository is no longer visible", null],
    ] as const)(
      "forgets an allowed repository check when %s",
      async (revocation, revokedResult) => {
        const {
          viewer,
          restoreSession,
          isRepositoryVisible,
          hasCurrentRepositoryAccess,
          requestFile,
        } = fixture()
        await expect(requestFile()).resolves.toEqual(allowedFile)

        if (revocation === "the Hub session ends") restoreSession.mockResolvedValueOnce(null)
        else isRepositoryVisible.mockResolvedValueOnce(false)
        await expect(requestFile()).resolves.toBe(revokedResult)
        restoreSession.mockResolvedValue(viewer)
        isRepositoryVisible.mockResolvedValue(true)

        await expect(requestFile()).resolves.toEqual(allowedFile)
        expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
      },
    )

    it("keeps an allowed repository check when a Build in another repository fails its local check", async () => {
      const { target, hasCurrentRepositoryAccess, findTarget, requestFile } = fixture()
      const otherRepository = privatePreviewAddress("902", "1201")!
      findTarget.mockImplementation((candidate) =>
        Promise.resolve(candidate.repositoryId === address.repositoryId ? target : null),
      )
      await expect(requestFile()).resolves.toEqual(allowedFile)

      await expect(requestFile(otherRepository)).resolves.toBeNull()

      await expect(requestFile()).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledOnce()
    })

    it("forgets allowed checks for other Builds in a repository when GitHub denies one of its Builds", async () => {
      const { target, sessionDigest, hasCurrentRepositoryAccess, findTarget, read, requestFile } =
        fixture()
      const otherBuild = { ...target, buildId: randomUUID() }
      const otherAddress = privatePreviewAddress(address.repositoryId, "1202")!
      findTarget.mockImplementation((candidate) =>
        Promise.resolve(candidate.runId === otherAddress.runId ? otherBuild : target),
      )
      function requestOtherBuild() {
        read.mockResolvedValueOnce(readerSession(sessionDigest, otherBuild.buildId))
        return requestFile(otherAddress)
      }
      await expect(requestOtherBuild()).resolves.toEqual(allowedFile)

      hasCurrentRepositoryAccess.mockResolvedValueOnce(false)
      await expect(requestFile()).resolves.toBeNull()

      await expect(requestOtherBuild()).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(3)
    })

    it.each([
      ["the Hub session ends", "session-ended"],
      ["the repository is no longer visible", null],
    ] as const)(
      "withholds a file whose repository check was in flight when %s",
      async (revocation, revokedResult) => {
        const { restoreSession, isRepositoryVisible, hasCurrentRepositoryAccess, requestFile } =
          fixture()
        const check = deferred()
        hasCurrentRepositoryAccess.mockReturnValueOnce(check.promise)

        const waiting = requestFile()
        await vi.waitFor(() => expect(hasCurrentRepositoryAccess).toHaveBeenCalledOnce())
        if (revocation === "the Hub session ends") restoreSession.mockResolvedValueOnce(null)
        else isRepositoryVisible.mockResolvedValueOnce(false)
        await expect(requestFile()).resolves.toBe(revokedResult)
        check.resolve(true)

        await expect(waiting).resolves.toBeNull()
        await expect(requestFile()).resolves.toEqual(allowedFile)
        expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
      },
    )

    it("withholds a file whose allowed check was in use when a launch sees GitHub deny access", async () => {
      const {
        target,
        sessionDigest,
        hasCurrentRepositoryAccess,
        findDistFile,
        authority,
        requestFile,
      } = fixture()
      const lookup = deferred<typeof file>()
      findDistFile.mockImplementation((_, requested) =>
        requested === path ? lookup.promise : Promise.resolve(null),
      )

      const waiting = requestFile()
      await vi.waitFor(() => expect(findDistFile).toHaveBeenCalledWith(target.buildId, path))
      hasCurrentRepositoryAccess.mockResolvedValueOnce(false)
      await expect(authority.launch(sessionDigest, address, target.buildId)).resolves.toBe("denied")
      lookup.resolve(file)

      await expect(waiting).resolves.toBeNull()
    })

    it("withholds a file whose allowed check was in use when its renewal is denied", async () => {
      vi.useFakeTimers({ toFake: ["performance"] })
      const { target, hasCurrentRepositoryAccess, findDistFile, requestFile } = fixture()
      const lookup = deferred<typeof file>()
      findDistFile.mockReturnValueOnce(lookup.promise)

      const waiting = requestFile()
      await vi.waitFor(() => expect(findDistFile).toHaveBeenCalledWith(target.buildId, path))
      vi.advanceTimersByTime(5 * 60_000)
      hasCurrentRepositoryAccess.mockResolvedValueOnce(false)
      await expect(requestFile()).resolves.toBeNull()
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
      lookup.resolve(file)

      await expect(waiting).resolves.toBeNull()
    })

    it("withholds a file whose allowed check was evicted for capacity when a launch sees GitHub deny access", async () => {
      const {
        target,
        sessionDigest,
        read,
        hasCurrentRepositoryAccess,
        findDistFile,
        authority,
        requestFile,
      } = fixture()
      const lookup = deferred<typeof file>()
      findDistFile.mockImplementation((_, requested) =>
        Promise.resolve(requested === path ? file : null),
      )
      findDistFile.mockReturnValueOnce(lookup.promise)

      const waiting = requestFile()
      await vi.waitFor(() => expect(findDistFile).toHaveBeenCalledWith(target.buildId, path))
      read.mockImplementation((tokenDigest) =>
        Promise.resolve(readerSession(tokenDigest, target.buildId)),
      )
      await Promise.all(Array.from({ length: 1024 }, () => requestFile()))
      hasCurrentRepositoryAccess.mockResolvedValueOnce(false)
      await expect(authority.launch(sessionDigest, address, target.buildId)).resolves.toBe("denied")
      lookup.resolve(file)

      await expect(waiting).resolves.toBeNull()
    })

    it("withholds a file whose allowed check was in use when a launch sees GitHub deny access after a failed renewal", async () => {
      vi.useFakeTimers({ toFake: ["performance"] })
      const {
        target,
        sessionDigest,
        hasCurrentRepositoryAccess,
        findDistFile,
        authority,
        requestFile,
      } = fixture()
      const unavailable = new Error("Synthetic repository authority outage")
      const lookup = deferred<typeof file>()
      findDistFile.mockImplementation((_, requested) =>
        Promise.resolve(requested === path ? file : null),
      )
      findDistFile.mockReturnValueOnce(lookup.promise)

      const waiting = requestFile()
      await vi.waitFor(() => expect(findDistFile).toHaveBeenCalledWith(target.buildId, path))
      vi.advanceTimersByTime(5 * 60_000)
      hasCurrentRepositoryAccess.mockRejectedValueOnce(unavailable)
      await expect(requestFile()).rejects.toBe(unavailable)
      hasCurrentRepositoryAccess.mockResolvedValueOnce(false)
      await expect(authority.launch(sessionDigest, address, target.buildId)).resolves.toBe("denied")
      lookup.resolve(file)

      await expect(waiting).resolves.toBeNull()
    })

    it("checks GitHub again after a launch finds the repository no longer visible", async () => {
      const {
        target,
        sessionDigest,
        isRepositoryVisible,
        hasCurrentRepositoryAccess,
        authority,
        requestFile,
      } = fixture()
      await expect(requestFile()).resolves.toEqual(allowedFile)

      isRepositoryVisible.mockResolvedValueOnce(false)
      await expect(authority.launch(sessionDigest, address, target.buildId)).resolves.toBe("denied")
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledOnce()

      await expect(requestFile()).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(2)
    })

    it("makes room for another viewer by forgetting an old allowed check when 1,024 are remembered", async () => {
      const { target, read, hasCurrentRepositoryAccess, requestFile } = fixture()
      read.mockImplementation((tokenDigest) =>
        Promise.resolve(readerSession(tokenDigest, target.buildId)),
      )
      const tokens = Array.from({ length: 1024 }, () => randomBytes(32).toString("base64url"))
      await expect(
        Promise.all(tokens.map((token) => requestFile(address, token))),
      ).resolves.toEqual(tokens.map(() => allowedFile))

      await expect(requestFile()).resolves.toEqual(allowedFile)
      await expect(requestFile(address, tokens[1023])).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(1025)

      await expect(requestFile(address, tokens[0])).resolves.toEqual(allowedFile)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(1026)
    })

    it("rejects another viewer without checking GitHub while 1,024 checks are in flight", async () => {
      const { target, read, hasCurrentRepositoryAccess, requestFile } = fixture()
      read.mockImplementation((tokenDigest) =>
        Promise.resolve(readerSession(tokenDigest, target.buildId)),
      )
      const check = deferred()
      hasCurrentRepositoryAccess.mockReturnValue(check.promise)
      const waiting = Array.from({ length: 1024 }, () => requestFile())
      await vi.waitFor(() => expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(1024))
      hasCurrentRepositoryAccess.mockResolvedValue(true)

      await expect(requestFile()).rejects.toThrow()
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledTimes(1024)

      check.resolve(true)
      await expect(Promise.all(waiting)).resolves.toEqual(waiting.map(() => allowedFile))
    })
  })
})
