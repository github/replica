import type { BuildRecord, PrototypeResponse } from "@application/hub/contracts/types"
import {
  productMetadataInputSchema,
  productShareInputSchema,
  productSharingSettingsInputSchema,
} from "@application/hub/product-contracts"
import type {
  ProductManagementResponse,
  ProductMetadataInput,
  ProductPublicResponse,
  ProductShareInput,
  ProductShareLink,
  ProductSharingResponse,
  ProductSharingSettingsInput,
  ProductTemplate,
} from "@application/hub/product-contracts/types"

import type { MockFlowContext } from "../flow-context/types"
import { MockStoreError } from "../store-error"

const millisecondsPerDay = 24 * 60 * 60 * 1000
const firstCandidateId = 9001

export function createProductStore(context: MockFlowContext) {
  const { resources, session } = context
  const startPages = new Map<string, string | null>()
  const candidates = resources.repositories.flatMap((repository) =>
    ["exploration", "comparison"].map((name, index) => ({
      id: index + firstCandidateId,
      repositoryId: repository.id,
      branchName: `prototype/${name}`,
      name: name === "exploration" ? "Exploration" : "Comparison",
      description: "Explore a new direction for this prototype.",
      startPage: null,
    })),
  )
  let sharingEnabled = true
  const links: ProductShareLink[] = []
  const seedBuild = resources.builds.find(
    (build) => build.state === "successful" && build.previewUrl,
  )
  if (seedBuild) {
    const now = Date.now()
    for (const [index, state] of ["active", "expired", "revoked"].entries()) {
      links.push({
        id: index + 1,
        shareId: `demo-${state}`,
        repositoryId: seedBuild.repositoryId,
        prototypeId: seedBuild.prototypeId,
        buildNumber: seedBuild.number,
        label:
          state === "active"
            ? "Team review"
            : state === "expired"
              ? "Design review"
              : "Previous review",
        createdBy:
          resources.prototypes.find(
            (prototype) =>
              prototype.repositoryId === seedBuild.repositoryId &&
              prototype.id === seedBuild.prototypeId,
          )?.authorLogin ?? "octocat",
        createdAt: new Date(now - 2 * millisecondsPerDay).toISOString(),
        expiresAt: new Date(
          now + (state === "expired" ? -1 : 7) * millisecondsPerDay,
        ).toISOString(),
        revokedAt: state === "revoked" ? new Date(now - millisecondsPerDay).toISOString() : null,
      })
    }
  }

  function key(repositoryId: string, prototypeId: string) {
    return `${repositoryId}/${prototypeId}`
  }

  function templates(repositoryId: string): ProductTemplate[] {
    context.repositoryRecord(repositoryId)
    const base: ProductTemplate = {
      id: "default",
      name: "Default",
      description: "Start from the default template.",
      route: "/",
      previewUrl: new URL("/previews/index.html?prototype=Default", context.origin).href,
      screenshotUrl: new URL("/previews/desktop.svg", context.origin).href,
      buildNumber: null,
    }
    return [
      base,
      ...resources.prototypes
        .filter((prototype) => prototype.repositoryId === repositoryId)
        .flatMap((prototype) => {
          const build = resources.builds
            .filter(
              (entry) =>
                entry.repositoryId === repositoryId &&
                entry.prototypeId === prototype.id &&
                entry.state === "successful" &&
                entry.previewUrl,
            )
            .sort((left, right) => right.number - left.number)[0]
          if (!build?.previewUrl) return []
          return [
            {
              id: `prototype-${prototype.id}`,
              name: prototype.name,
              description: prototype.description ?? "Explore this prototype.",
              route: startPages.get(key(repositoryId, prototype.id)) ?? "/",
              previewUrl: build.previewUrl,
              screenshotUrl: build.desktopScreenshotUrl,
              buildNumber: build.number,
            },
          ]
        }),
    ]
  }

  function requireEditable(repositoryId: string, prototypeId: string) {
    const response = context.prototypeResponse(repositoryId, prototypeId)
    if (!response.prototype.canEdit) {
      throw new MockStoreError(403, "You do not have permission to edit this prototype.")
    }
    return response
  }

  function addPrototype(
    repositoryId: string,
    name: string,
    description: string | null,
    branchName: string | null,
    startPage: string | null,
  ): PrototypeResponse {
    const viewer = session.requireCapability("createPrototypes")
    context.repositoryRecord(repositoryId)
    const id = String(
      Math.max(0, ...resources.prototypes.map((prototype) => Number(prototype.id))) + 1,
    )
    const now = new Date().toISOString()
    const prototype = {
      id,
      repositoryId,
      name,
      description,
      branchName: branchName ?? `prototype/mock-${id}`,
      authorLogin: viewer.login,
    }
    const preview = new URL("/previews/index.html", context.origin)
    preview.searchParams.set("prototype", name)
    preview.searchParams.set("build", "1")
    const build: BuildRecord = {
      number: 1,
      repositoryId,
      prototypeId: id,
      state: "successful",
      commitSha: String(id).padStart(40, "0"),
      commitAuthorLogin: viewer.login,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      previewUrl: preview.href,
      desktopScreenshotUrl: new URL("/previews/desktop.svg", context.origin).href,
      narrowScreenshotUrl: new URL("/previews/narrow.svg", context.origin).href,
      failureSummary: null,
    }
    resources.prototypes.push(prototype)
    resources.builds.push(build)
    startPages.set(key(repositoryId, id), startPage)
    return context.prototypeResponse(repositoryId, id)
  }

  return {
    getCatalog(repositoryId: string) {
      session.requireViewer()
      return {
        repository: context.repositoryRecord(repositoryId),
        templates: templates(repositoryId),
        canCreate: session.read().capabilities.createPrototypes,
      }
    },

    getTemplate(repositoryId: string, templateId: string) {
      session.requireViewer()
      const template = templates(repositoryId).find((entry) => entry.id === templateId)
      if (!template) throw new MockStoreError(404, "Template not found.")
      return {
        repository: context.repositoryRecord(repositoryId),
        template,
        canCreate: session.read().capabilities.createPrototypes,
        controlsIdentity: context.controlsIdentity([
          "template",
          repositoryId,
          context.repositoryRecord(repositoryId).defaultBranch,
          template.id,
        ]),
      }
    },

    getManagement(repositoryId: string): ProductManagementResponse {
      session.requireViewer()
      return {
        repository: context.repositoryRecord(repositoryId),
        registered: resources.prototypes
          .filter((prototype) => prototype.repositoryId === repositoryId)
          .map(({ id }) => ({
            ...context.prototypeResponse(repositoryId, id).prototype,
            startPage: startPages.get(key(repositoryId, id)) ?? null,
          })),
        candidates: candidates
          .filter((candidate) => candidate.repositoryId === repositoryId)
          .map(({ repositoryId: _repositoryId, ...candidate }) => {
            void _repositoryId
            return { ...candidate }
          }),
        canCreate: session.read().capabilities.createPrototypes,
      }
    },

    updateMetadata(repositoryId: string, prototypeId: string, input: ProductMetadataInput) {
      session.requireCapability("createPrototypes")
      requireEditable(repositoryId, prototypeId)
      const parsed = productMetadataInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new MockStoreError(422, parsed.error.issues.map(({ message }) => message).join(" "))
      }
      const prototype = resources.prototypes.find(
        (entry) => entry.repositoryId === repositoryId && entry.id === prototypeId,
      )!
      prototype.name = parsed.data.name
      prototype.description = parsed.data.description
      startPages.set(key(repositoryId, prototypeId), parsed.data.startPage || null)
      return {
        notice: "Prototype details saved.",
      }
    },

    registerCandidate(repositoryId: string, candidateId: number, input: ProductMetadataInput) {
      session.requireCapability("createPrototypes")
      context.repositoryRecord(repositoryId)
      const index = candidates.findIndex(
        (candidate) => candidate.repositoryId === repositoryId && candidate.id === candidateId,
      )
      if (index === -1) throw new MockStoreError(404, "Available branch not found.")
      const parsed = productMetadataInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new MockStoreError(422, parsed.error.issues.map(({ message }) => message).join(" "))
      }
      const candidate = candidates[index]!
      if (
        resources.prototypes.some(
          (prototype) =>
            prototype.repositoryId === repositoryId &&
            prototype.branchName === candidate.branchName,
        )
      ) {
        throw new MockStoreError(409, "This branch is already listed in Hub.")
      }
      addPrototype(
        repositoryId,
        parsed.data.name,
        parsed.data.description,
        candidate.branchName,
        parsed.data.startPage || null,
      )
      candidates.splice(index, 1)
      return {
        notice: "Prototype added to Hub.",
      }
    },

    getShareLinks(
      repositoryId: string,
      prototypeId: string,
      buildNumber?: number,
    ): ProductSharingResponse {
      session.requireViewer()
      const resource = context.prototypeResponse(repositoryId, prototypeId, buildNumber)
      if (buildNumber === undefined) {
        resource.selectedBuild =
          resource.prototype.builds.find(
            (build) => build.state === "successful" && build.previewUrl,
          ) ?? null
      }
      return {
        resource,
        links: links
          .filter((link) => link.repositoryId === repositoryId && link.prototypeId === prototypeId)
          .map((link) => ({ ...link })),
        enabled: sharingEnabled,
        canManage: session.read().capabilities.manageSharing && resource.prototype.canEdit,
      }
    },

    createShareLink(repositoryId: string, prototypeId: string, input: ProductShareInput) {
      const viewer = session.requireCapability("manageSharing")
      const resource = requireEditable(repositoryId, prototypeId)
      if (!sharingEnabled) throw new MockStoreError(409, "Public sharing is disabled.")
      const parsed = productShareInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new MockStoreError(422, parsed.error.issues.map(({ message }) => message).join(" "))
      }
      const build = resource.prototype.builds.find(
        ({ number }) => number === parsed.data.buildNumber,
      )
      if (!build) throw new MockStoreError(404, "Build not found.")
      if (build.state !== "successful" || !build.previewUrl) {
        throw new MockStoreError(422, "Choose a successful Build with a preview.")
      }
      const id = Math.max(0, ...links.map((link) => link.id)) + 1
      const now = Date.now()
      const link: ProductShareLink = {
        id,
        shareId: `local-${id}`,
        repositoryId,
        prototypeId,
        buildNumber: build.number,
        label: parsed.data.label,
        createdBy: viewer.login,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(
          now + (parsed.data.expiration === "one_day" ? 1 : 7) * millisecondsPerDay,
        ).toISOString(),
        revokedAt: null,
      }
      links.push(link)
      return {
        link: { ...link },
        notice: "Share link created.",
      }
    },

    revokeShareLink(repositoryId: string, prototypeId: string, shareId: string) {
      session.requireCapability("manageSharing")
      requireEditable(repositoryId, prototypeId)
      const link = links.find(
        (entry) =>
          entry.repositoryId === repositoryId &&
          entry.prototypeId === prototypeId &&
          entry.shareId === shareId,
      )
      if (!link) throw new MockStoreError(404, "Share link not found.")
      if (!link.revokedAt) link.revokedAt = new Date().toISOString()
      return { notice: "Share link revoked." }
    },

    getSharingSettings() {
      session.requireViewer()
      return {
        enabled: sharingEnabled,
        canAdminister: session.read().capabilities.administerHub,
        activeLinkCount: links.filter(
          (link) => !link.revokedAt && Date.parse(link.expiresAt) > Date.now(),
        ).length,
      }
    },

    updateSharingSettings(input: ProductSharingSettingsInput) {
      session.requireCapability("administerHub")
      const parsed = productSharingSettingsInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new MockStoreError(422, parsed.error.issues.map(({ message }) => message).join(" "))
      }
      const enabled = parsed.data.operation === "enable"
      if (sharingEnabled === enabled) {
        throw new MockStoreError(
          409,
          "Sharing settings changed. Refresh and confirm the current operation.",
        )
      }
      if (!enabled) {
        const now = new Date().toISOString()
        for (const link of links) if (!link.revokedAt) link.revokedAt = now
      }
      sharingEnabled = enabled
      return {
        notice: enabled ? "Public sharing enabled." : "Public sharing disabled.",
      }
    },

    getPublicShare(shareId: string): ProductPublicResponse {
      const link = links.find((entry) => entry.shareId === shareId)
      if (!link) throw new MockStoreError(404, "Shared preview not found.")
      if (link.revokedAt) return { state: "revoked", label: link.label }
      if (!sharingEnabled) return { state: "disabled", label: link.label }
      if (Date.parse(link.expiresAt) <= Date.now()) return { state: "expired", label: link.label }
      const prototype = resources.prototypes.find(
        (entry) => entry.repositoryId === link.repositoryId && entry.id === link.prototypeId,
      )
      const build = resources.builds.find(
        (entry) =>
          entry.repositoryId === link.repositoryId &&
          entry.prototypeId === link.prototypeId &&
          entry.number === link.buildNumber,
      )
      if (!prototype || build?.state !== "successful" || !build.previewUrl) {
        throw new MockStoreError(404, "Shared Build is unavailable.")
      }
      return {
        state: "active",
        label: link.label,
        prototypeName: prototype.name,
        buildNumber: build.number,
        previewUrl: build.previewUrl,
        expiresAt: link.expiresAt,
      }
    },
  }
}
