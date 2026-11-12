import { z } from "zod"

import {
  buildSchema,
  prototypeDetailsSchema,
  prototypeSchema,
  repositorySchema,
  userSchema,
} from "@application/hub/contracts"
import type {
  AuthorResults,
  BuildHistoryResponse,
  BuildResponse,
  PrototypeDetails,
  PrototypeRecord,
  PrototypeResponse,
  RepositoryResponse,
  RouteQuery,
  WorkspaceResponse,
} from "@application/hub/contracts/types"

import { createMockSession } from "../create-mock-session"
import { createFixtureSeed } from "../create-fixture-seed"
import type { MockFlowContext } from "../flow-context/types"
import { createReviewStore } from "../create-review-store"
import { createProductStore } from "../create-product-store"
import { createSettingsStore } from "../create-settings-store"
import { MockStoreError } from "../store-error"
import { paginateMockRecords as paginate } from "../paginate-mock-records"

import type { Options } from "./types"

const prototypePageSize = 24
const buildHistoryPageSize = 25
const authorPageSize = 20

const seedSchema = z.object({
  viewerLogin: z.string().min(1),
  users: z.array(userSchema),
  repositories: z.array(repositorySchema),
  prototypes: z.array(prototypeSchema.omit({ builds: true, canEdit: true })),
  builds: z.array(
    buildSchema.extend({
      previewUrl: z.string().nullable(),
      desktopScreenshotUrl: z.string().nullable(),
      narrowScreenshotUrl: z.string().nullable(),
    }),
  ),
})

export function createMockStore({ origin, seed = createFixtureSeed() }: Options) {
  const parsedOrigin = new URL(origin)
  if (!["http:", "https:"].includes(parsedOrigin.protocol)) {
    throw new Error("The mock API origin must use HTTP or HTTPS.")
  }
  const apiOrigin = parsedOrigin.origin
  const data = seedSchema.parse(structuredClone(seed))
  const viewerRecord = data.users.find((user) => user.login === data.viewerLogin)
  if (!viewerRecord) throw new Error("The mock viewer is missing from the fixture users.")
  const session = createMockSession(data.users, viewerRecord.login)
  const controlsIdentities = new Map<string, string>()
  const introductions = new Set<string>()

  const repositories = new Set(data.repositories.map(({ id }) => id))
  const prototypeKeys = new Set(
    data.prototypes.map(({ repositoryId, id }) => `${repositoryId}/${id}`),
  )
  const userLogins = new Set(data.users.map(({ login }) => login))
  const userIds = new Set(data.users.map(({ id }) => id))
  const buildKeys = new Set(
    data.builds.map(
      ({ repositoryId, prototypeId, number }) => `${repositoryId}/${prototypeId}/${number}`,
    ),
  )
  if (
    repositories.size !== data.repositories.length ||
    prototypeKeys.size !== data.prototypes.length ||
    userLogins.size !== data.users.length ||
    userIds.size !== data.users.length ||
    buildKeys.size !== data.builds.length
  ) {
    throw new Error("The mock fixture contains duplicate records.")
  }
  for (const prototype of data.prototypes) {
    if (
      !repositories.has(prototype.repositoryId) ||
      (prototype.authorLogin !== null && !userLogins.has(prototype.authorLogin))
    ) {
      throw new Error("A mock prototype refers to a missing repository or user.")
    }
  }
  const builds = data.builds.map((build) => {
    if (
      !prototypeKeys.has(`${build.repositoryId}/${build.prototypeId}`) ||
      (build.commitAuthorLogin !== null && !userLogins.has(build.commitAuthorLogin))
    ) {
      throw new Error("A mock build refers to a missing prototype or commit author.")
    }
    return buildSchema.parse({
      ...build,
      previewUrl: build.previewUrl ? new URL(build.previewUrl, apiOrigin).href : null,
      desktopScreenshotUrl: build.desktopScreenshotUrl
        ? new URL(build.desktopScreenshotUrl, apiOrigin).href
        : null,
      narrowScreenshotUrl: build.narrowScreenshotUrl
        ? new URL(build.narrowScreenshotUrl, apiOrigin).href
        : null,
    })
  })

  function repositoryRecord(repositoryId: string) {
    const repository = data.repositories.find(({ id }) => id === repositoryId)
    if (!repository) throw new MockStoreError(404, "Repository not found.")
    return { ...repository }
  }

  function controlsIdentity(context: (string | number)[]) {
    const key = JSON.stringify([session.requireViewer().id, ...context])
    let identity = controlsIdentities.get(key)
    if (!identity) {
      identity = crypto.randomUUID()
      controlsIdentities.set(key, identity)
    }
    return identity
  }

  function prototypeRecord(repositoryId: string, prototypeId: string): PrototypeRecord {
    repositoryRecord(repositoryId)
    const prototype = data.prototypes.find(
      ({ id, repositoryId: owner }) => id === prototypeId && owner === repositoryId,
    )
    if (!prototype) throw new MockStoreError(404, "Prototype not found.")
    return {
      ...prototype,
      canEdit:
        session.read().profile !== "reader" &&
        prototype.authorLogin === session.read().viewer?.login,
      builds: builds
        .filter((build) => build.repositoryId === repositoryId && build.prototypeId === prototypeId)
        .sort((left, right) => right.number - left.number)
        .map((build) => ({ ...build })),
    }
  }

  function repositoryAuthors(repositoryId: string) {
    repositoryRecord(repositoryId)
    const logins = new Set(
      data.prototypes
        .filter((prototype) => prototype.repositoryId === repositoryId)
        .map(({ authorLogin }) => authorLogin),
    )
    return data.users.filter(({ login }) => logins.has(login)).map((user) => ({ ...user }))
  }

  function prototypeResponse(
    repositoryId: string,
    prototypeId: string,
    buildNumber?: number,
  ): PrototypeResponse {
    const prototype = prototypeRecord(repositoryId, prototypeId)
    const selectedBuild =
      buildNumber === undefined
        ? (prototype.builds.find((build) => build.state === "successful") ?? null)
        : prototype.builds.find(({ number }) => number === buildNumber)
    if (selectedBuild === undefined) throw new MockStoreError(404, "Build not found.")
    return { repository: repositoryRecord(repositoryId), prototype, selectedBuild }
  }

  const flowContext: MockFlowContext = {
    origin: apiOrigin,
    session,
    resources: { ...data, builds },
    controlsIdentity,
    repositoryRecord,
    prototypeResponse,
  }
  const settings = createSettingsStore(flowContext)

  return {
    origin: apiOrigin,
    session,
    flowContext,
    review: createReviewStore(flowContext),
    product: createProductStore(flowContext),
    settings,
    getWorkspace(): WorkspaceResponse {
      return {
        viewer: session.requireViewer(),
        repositories: data.repositories.map((repository) => ({ ...repository })),
        capabilities: session.read().capabilities,
        navigation: settings.getNavigationState(),
      }
    },

    getRepository(
      repositoryId: string,
      query: Pick<RouteQuery, "q" | "author" | "page"> = { q: "", author: "", page: 1 },
    ): RepositoryResponse {
      const viewer = session.requireViewer()
      const repository = repositoryRecord(repositoryId)
      const authorLogin =
        query.author === "me"
          ? viewer.login
          : data.users.find(({ id }) => id === query.author)?.login
      const search = query.q.toLowerCase()
      const matches = data.prototypes
        .filter((prototype) => prototype.repositoryId === repositoryId)
        .filter((prototype) => !query.author || prototype.authorLogin === authorLogin)
        .filter((prototype) =>
          [prototype.name, prototype.branchName, prototype.description ?? ""].some((value) =>
            value.toLowerCase().includes(search),
          ),
        )
        .map(({ id }) => prototypeRecord(repositoryId, id))
      const page = paginate(matches, query.page, prototypePageSize)
      return {
        repository,
        prototypes: page.records,
        pagination: page.pagination,
        authors: repositoryAuthors(repositoryId),
      }
    },

    getPrototype(
      repositoryId: string,
      prototypeId: string,
      buildNumber?: number,
      minimized = false,
    ): PrototypeResponse {
      const viewer = session.requireViewer()
      const response = prototypeResponse(repositoryId, prototypeId, buildNumber)
      if (response.selectedBuild && response.selectedBuild.state !== "successful") {
        throw new MockStoreError(404, "Successful Build not found.")
      }
      const introduction = JSON.stringify([viewer.id, repositoryId, prototypeId])
      const showPrototypeInfo = !minimized && !introductions.has(introduction)
      if (!minimized) introductions.add(introduction)
      return {
        ...response,
        controlsIdentity: controlsIdentity([
          "prototype",
          repositoryId,
          prototypeId,
          response.prototype.branchName,
        ]),
        showPrototypeInfo,
      }
    },

    getBuild(repositoryId: string, prototypeId: string, buildNumber: number): BuildResponse {
      session.requireViewer()
      const response = prototypeResponse(repositoryId, prototypeId, buildNumber)
      if (!response.selectedBuild) throw new MockStoreError(404, "Build not found.")
      return {
        repository: response.repository,
        prototype: response.prototype,
        build: response.selectedBuild,
      }
    },

    getBuildHistory(repositoryId: string, prototypeId: string, page = 1): BuildHistoryResponse {
      session.requireViewer()
      const prototype = prototypeRecord(repositoryId, prototypeId)
      const selected = paginate(prototype.builds, page, buildHistoryPageSize)
      return {
        repository: repositoryRecord(repositoryId),
        prototype,
        builds: selected.records,
        pagination: selected.pagination,
      }
    },

    getAuthors(repositoryId: string, query = "", cursor: string | null = null): AuthorResults {
      session.requireViewer()
      const search = query.trim().toLowerCase()
      const authors = repositoryAuthors(repositoryId)
        .filter((user) =>
          [user.login, user.name ?? ""].some((value) => value.toLowerCase().includes(search)),
        )
        .sort((left, right) => left.login.localeCompare(right.login))
      const previousIndex = cursor === null ? -1 : authors.findIndex(({ id }) => id === cursor)
      if (cursor !== null && previousIndex === -1) {
        throw new MockStoreError(400, "Unknown author cursor.")
      }
      const page = authors.slice(previousIndex + 1, previousIndex + 1 + authorPageSize)
      const next = authors.length > previousIndex + 1 + authorPageSize ? page.at(-1) : undefined
      return { authors: page, nextCursor: next?.id ?? null }
    },

    updatePrototype(
      repositoryId: string,
      prototypeId: string,
      details: PrototypeDetails,
    ): PrototypeResponse {
      session.requireViewer()
      const prototype = prototypeRecord(repositoryId, prototypeId)
      if (!prototype.canEdit) throw new MockStoreError(403, "You cannot edit this prototype.")
      const parsed = prototypeDetailsSchema.parse(details)
      const target = data.prototypes.find(
        ({ id, repositoryId: owner }) => id === prototypeId && owner === repositoryId,
      )
      if (!target) throw new MockStoreError(404, "Prototype not found.")
      target.name = parsed.name
      target.description = parsed.description
      return prototypeResponse(repositoryId, prototypeId)
    },
  }
}
