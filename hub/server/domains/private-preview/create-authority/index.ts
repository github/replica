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
  ): Promise<boolean>
  findTarget(this: void, address: PrivatePreviewAddress): Promise<PrivatePreviewTarget | null>
  findDistFile(
    this: void,
    buildId: string,
    path: string,
  ): Promise<{ storageKey: string; byteLength: number } | null>
}

const signedOut = Symbol("signed out")

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
  async function withAccess<Result>(
    sessionDigest: string,
    address: PrivatePreviewAddress,
    read: (target: PrivatePreviewTarget) => Result | Promise<Result>,
    expectedBuildId?: string,
  ): Promise<Result | null | typeof signedOut> {
    const viewer = await restoreSession(sessionDigest)
    if (!viewer) return signedOut
    const target = await findTarget(address)
    if (
      !target ||
      (expectedBuildId && target.buildId !== expectedBuildId) ||
      !(await isRepositoryVisible(viewer, target.repositoryId))
    )
      return null
    const result = await read(target)
    if (!(await hasCurrentRepositoryAccess(viewer, target.repositoryId))) return null
    const currentTarget = await findTarget(address)
    if (currentTarget?.buildId !== target.buildId) return null
    const current = await restoreSession(sessionDigest)
    if (!current) return signedOut
    if (
      current.userId !== viewer.userId ||
      current.membershipId !== viewer.membershipId ||
      current.externalIdentityId !== viewer.externalIdentityId ||
      current.sessionProvider !== viewer.sessionProvider ||
      current.role !== viewer.role ||
      !(await isRepositoryVisible(current, target.repositoryId))
    )
      return null
    return result
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
      // An ended reader or Hub session lets the reader renew a prototype navigation through Hub.
      const session = await access.read(hashAuthenticationValue(token), readerOrigin, null)
      if (!session) return "session-ended"
      const file = await withAccess(
        session.sessionDigest,
        address,
        async ({ buildId }) => {
          let selectedPath = path
          let artifact = await findDistFile(buildId, selectedPath)
          if (!artifact && allowEntryPointFallback && path !== "dist/index.html") {
            selectedPath = "dist/index.html"
            artifact = await findDistFile(buildId, selectedPath)
          }
          if (
            !artifact ||
            artifact.byteLength < 0 ||
            artifact.byteLength > maximumPrivatePreviewFileBytes
          )
            return null
          return { ...artifact, path: selectedPath }
        },
        session.buildId,
      )
      if (file === signedOut) return "session-ended"
      if (!file) return null
      return session.expiresAt > (await access.clock()) ? file : "session-ended"
    },
  }
}
