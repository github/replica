import { randomBytes } from "node:crypto"

import { hashAuthenticationValue } from "../../authentication/hash-authentication-value/index.ts"
import { normalizeBuildArtifactPath } from "../../build-artifacts/normalize-build-artifact-path/index.ts"
import { declaresPreviewMount } from "../../build-preview/declares-preview-mount/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import type { PrivatePreviewAddress } from "../../../utils/private-preview-address/index.ts"
import { normalizeStartPage } from "../../../utils/normalize-start-page/index.ts"
import type { createPrivatePreviewAccessStore } from "../../../repositories/private-previews/create-private-preview-access-store/index.ts"
import {
  grantLifetime,
  maximumPrivatePreviewFileBytes,
  maximumPrivatePreviewManifestBytes,
  privatePreviewManifestPath,
  type PrivatePreviewAuthority,
  type PrivatePreviewTarget,
} from "../types.ts"

interface Viewer {
  userId: string
  membershipId: string
  role: "ADMINISTRATOR" | "MEMBER"
  externalIdentityId?: string | null
  sessionProvider: string | null
}

interface Dependencies<CurrentViewer extends Viewer> {
  readerOrigin: string
  storage: Pick<ArtifactStorage, "read">
  access: ReturnType<typeof createPrivatePreviewAccessStore>
  restoreSession(this: void, digest: string): Promise<CurrentViewer | null>
  isRepositoryVisible(this: void, viewer: CurrentViewer, repositoryId: string): Promise<boolean>
  hasCurrentRepositoryAccess(
    this: void,
    viewer: CurrentViewer,
    repositoryId: string,
    githubRepositoryId: bigint,
  ): Promise<boolean>
  findTarget(this: void, address: PrivatePreviewAddress): Promise<PrivatePreviewTarget | null>
  findDistFile(
    this: void,
    buildId: string,
    path: string,
  ): Promise<{ storageKey: string; byteLength: number } | null>
}

const signedOut = Symbol("signed out")
export const filePermissionLifetime = 5 * 60_000
const maximumFilePermissions = 1024

function granted<Result>(value: Result | null | typeof signedOut) {
  return value === signedOut ? null : value
}

export function createPrivatePreviewAuthority<CurrentViewer extends Viewer>({
  readerOrigin,
  storage,
  access,
  restoreSession,
  isRepositoryVisible,
  hasCurrentRepositoryAccess,
  findTarget,
  findDistFile,
}: Dependencies<CurrentViewer>): PrivatePreviewAuthority {
  const filePermissions = new Map<
    string,
    {
      sessionDigest: string
      githubRepositoryId: string
      allowed: Promise<boolean>
      expiresAt: number
      pending: boolean
    }
  >()

  // A failed check forgets only that repository, so it cannot deny another repository's load.
  function forgetFilePermissions(sessionDigest: string, address?: PrivatePreviewAddress) {
    for (const [key, entry] of filePermissions) {
      if (
        entry.sessionDigest === sessionDigest &&
        (!address || entry.githubRepositoryId === address.repositoryId)
      )
        filePermissions.delete(key)
    }
  }

  function checkRepositoryAccess(
    viewer: CurrentViewer,
    target: PrivatePreviewTarget,
    address: PrivatePreviewAddress,
  ) {
    // findTarget matched this immutable GitHub identity, so the check needs no repository lookup.
    return hasCurrentRepositoryAccess(viewer, target.repositoryId, BigInt(address.repositoryId))
  }

  // Shares one in-flight check and remembers only an allowed result for this viewer and exact Build.
  function filePermission(
    sessionDigest: string,
    viewer: CurrentViewer,
    address: PrivatePreviewAddress,
    target: PrivatePreviewTarget,
  ) {
    const key = JSON.stringify([
      sessionDigest,
      viewer.userId,
      viewer.membershipId,
      viewer.externalIdentityId,
      viewer.sessionProvider,
      viewer.role,
      address.repositoryId,
      target.repositoryId,
      target.buildId,
    ])
    const now = performance.now()
    const previous = filePermissions.get(key)
    if (previous && (previous.pending || previous.expiresAt > now)) return previous.allowed
    if (previous) filePermissions.delete(key)
    if (filePermissions.size >= maximumFilePermissions) {
      const settled = [...filePermissions].find(([, entry]) => !entry.pending)
      if (!settled) throw new Error("Too many pending private preview permission checks.")
      filePermissions.delete(settled[0])
    }
    const entry = {
      sessionDigest,
      githubRepositoryId: address.repositoryId,
      allowed: Promise.resolve(false),
      expiresAt: now + filePermissionLifetime,
      pending: true,
    }
    entry.allowed = checkRepositoryAccess(viewer, target, address).then(
      (allowed) => {
        entry.pending = false
        // A session end or failed check while pending withholds the result from every waiter.
        const current = filePermissions.get(key) === entry
        if (!allowed) forgetFilePermissions(sessionDigest, address)
        return allowed && current
      },
      (error: unknown) => {
        if (filePermissions.get(key) === entry) filePermissions.delete(key)
        throw error
      },
    )
    filePermissions.set(key, entry)
    return entry.allowed
  }

  async function stillLocallyAuthorized(
    sessionDigest: string,
    viewer: CurrentViewer,
    address: PrivatePreviewAddress,
    target: PrivatePreviewTarget,
  ) {
    const [current, currentTarget] = await Promise.all([
      restoreSession(sessionDigest),
      findTarget(address),
    ])
    if (!current) {
      forgetFilePermissions(sessionDigest)
      return signedOut
    }
    if (
      currentTarget?.buildId === target.buildId &&
      currentTarget.repositoryId === target.repositoryId &&
      current.userId === viewer.userId &&
      current.membershipId === viewer.membershipId &&
      current.externalIdentityId === viewer.externalIdentityId &&
      current.sessionProvider === viewer.sessionProvider &&
      current.role === viewer.role &&
      (await isRepositoryVisible(current, target.repositoryId))
    )
      return true
    forgetFilePermissions(sessionDigest, address)
    return false
  }

  async function withAccess<Result>(
    sessionDigest: string,
    address: PrivatePreviewAddress,
    read: (target: PrivatePreviewTarget) => Result | Promise<Result>,
    expectedBuildId?: string,
  ): Promise<Result | null | typeof signedOut> {
    const viewer = await restoreSession(sessionDigest)
    if (!viewer) {
      forgetFilePermissions(sessionDigest)
      return signedOut
    }
    const target = await findTarget(address)
    if (
      !target ||
      (expectedBuildId && target.buildId !== expectedBuildId) ||
      !(await isRepositoryVisible(viewer, target.repositoryId))
    )
      return null
    const result = await read(target)
    if (!(await checkRepositoryAccess(viewer, target, address))) {
      forgetFilePermissions(sessionDigest, address)
      return null
    }
    const current = await stillLocallyAuthorized(sessionDigest, viewer, address, target)
    return current === true ? result : current === signedOut ? signedOut : null
  }

  async function isCompatible(target: PrivatePreviewTarget, address: PrivatePreviewAddress) {
    const manifest = await findDistFile(target.buildId, privatePreviewManifestPath)
    if (
      !manifest ||
      manifest.byteLength < 1 ||
      manifest.byteLength > maximumPrivatePreviewManifestBytes
    )
      return false
    const result = await storage.read(manifest.storageKey)
    if (result.status === "unavailable") throw new Error("Private preview manifest is unavailable.")
    if (result.status !== "ok" || result.bytes.byteLength !== manifest.byteLength) return false
    return declaresPreviewMount(result.bytes, address.mount)
  }

  return {
    async launchDeadline() {
      return new Date((await access.clock()).getTime() + grantLifetime)
    },
    async launch(sessionDigest, address, buildId) {
      return (
        granted(
          await withAccess(
            sessionDigest,
            address,
            async (target) => ((await isCompatible(target, address)) ? "allowed" : "incompatible"),
            buildId,
          ),
        ) ?? "denied"
      )
    },
    async issue(sessionDigest, address, challengeDigest, intent) {
      if (intent.expiresAt <= (await access.clock())) return null
      const target = granted(
        await withAccess(
          sessionDigest,
          address,
          async (candidate) => ((await isCompatible(candidate, address)) ? candidate : null),
          intent.buildId,
        ),
      )
      if (!target) return null
      const grant = randomBytes(32).toString("base64url")
      const issued = await access.issue({
        id: intent.id,
        tokenDigest: hashAuthenticationValue(grant),
        sessionDigest,
        buildId: target.buildId,
        readerOrigin,
        challengeDigest,
        expiresAt: intent.expiresAt,
      })
      return issued ? grant : null
    },
    async exchange(grant, address, challengeDigest) {
      const grantDigest = hashAuthenticationValue(grant)
      const handoff = await access.read(grantDigest, readerOrigin, challengeDigest)
      if (!handoff) return null
      const startPage = granted(
        await withAccess(
          handoff.sessionDigest,
          address,
          (target) => normalizeStartPage(target.startPage),
          handoff.buildId,
        ),
      )
      if (!startPage) return null
      const token = randomBytes(32).toString("base64url")
      const exchanged = await access.exchange({
        grantDigest,
        tokenDigest: hashAuthenticationValue(token),
        readerOrigin,
        challengeDigest,
      })
      return exchanged ? { access: token, startPage, buildId: handoff.buildId } : null
    },
    async authorizeFile(token, address, path, allowEntryPointFallback) {
      if (
        normalizeBuildArtifactPath(path) !== path ||
        !path.startsWith("dist/") ||
        path === privatePreviewManifestPath
      )
        return null
      const started = performance.now()
      // An ended reader or Hub session lets the reader renew a prototype navigation through Hub.
      const session = await access.read(hashAuthenticationValue(token), readerOrigin, null)
      if (!session) return "session-ended"
      const { sessionDigest } = session
      const viewer = await restoreSession(sessionDigest)
      if (!viewer) {
        forgetFilePermissions(sessionDigest)
        return "session-ended"
      }
      const target = await findTarget(address)
      if (
        !target ||
        target.buildId !== session.buildId ||
        !(await isRepositoryVisible(viewer, target.repositoryId))
      ) {
        forgetFilePermissions(sessionDigest, address)
        return null
      }
      if (!(await filePermission(sessionDigest, viewer, address, target))) return null

      let selectedPath = path
      let artifact = await findDistFile(target.buildId, selectedPath)
      if (!artifact && allowEntryPointFallback && path !== "dist/index.html") {
        selectedPath = "dist/index.html"
        artifact = await findDistFile(target.buildId, selectedPath)
      }
      if (
        !artifact ||
        artifact.byteLength < 0 ||
        artifact.byteLength > maximumPrivatePreviewFileBytes
      )
        return null
      const current = await stillLocallyAuthorized(sessionDigest, viewer, address, target)
      if (current === signedOut) return "session-ended"
      if (!current) return null
      // Advance the lookup's database time locally rather than querying the clock again.
      const now = session.now.getTime() + (performance.now() - started)
      if (session.expiresAt.getTime() <= now) return "session-ended"
      return { ...artifact, path: selectedPath }
    },
  }
}
