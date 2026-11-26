import { expect, it } from "vitest"

import { prototypeResponseSchema } from "@application/hub/contracts"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { prototypeShowData } from "."

it("offers the pinned private Hub link when the Build has no embed", () => {
  const repository = { id: "2001", nameWithOwner: "example/repository", defaultBranch: "main" }
  const workspace: WorkspaceResponse = {
    viewer: { id: "123", login: "octocat", name: null, provider: "github", avatarUrl: null },
    repositories: [repository],
  }
  const privatePreviewUrl = "https://hub.example.com/api/private-preview/launch/2001/4001"
  const build = {
    number: 2,
    repositoryId: repository.id,
    prototypeId: "1",
    state: "successful",
    commitSha: null,
    commitAuthorLogin: null,
    createdAt: "2026-12-20T12:00:00Z",
    startedAt: null,
    finishedAt: null,
    previewUrl: null,
    privatePreviewUrl,
    desktopScreenshotUrl: null,
    narrowScreenshotUrl: null,
    failureSummary: null,
  }
  const response = prototypeResponseSchema.parse({
    repository,
    prototype: {
      id: "1",
      repositoryId: repository.id,
      name: "Prototype",
      branchName: "prototype/welcome",
      authorLogin: null,
      canEdit: false,
      description: null,
      builds: [build],
    },
    selectedBuild: build,
  })

  expect(
    prototypeShowData(workspace, response, new URLSearchParams("build=2&view=minimized")),
  ).toMatchObject({
    emptyHeading: "Private preview",
    emptyLabel: "This Build opens in a separate tab.",
    privatePreviewUrl,
    minimizedPreview: false,
    buildPinned: true,
  })
})

it("uses the per-prototype sharing decision rather than repository or edit access in hosted mode", () => {
  const repository = { id: "2001", nameWithOwner: "example/repository", defaultBranch: "main" }
  const workspace: WorkspaceResponse = {
    viewer: { id: "123", login: "octocat", name: null, provider: "github", avatarUrl: null },
    repositories: [
      { ...repository, capabilities: { manageSharing: false, reviewPrototypes: true } },
    ],
  }
  function data(id: string, canManageShareLinks: boolean) {
    return prototypeResponseSchema.parse({
      repository,
      prototype: {
        id,
        repositoryId: repository.id,
        name: "Prototype",
        branchName: "prototype/welcome",
        authorLogin: null,
        canEdit: true,
        canManageShareLinks,
        description: null,
        builds: [],
      },
      selectedBuild: null,
    })
  }
  expect(prototypeShowData(workspace, data("1", true), new URLSearchParams()).shareLinksPath).toBe(
    "/repositories/2001/prototypes/1/share-links",
  )
  expect(
    prototypeShowData(workspace, data("2", false), new URLSearchParams()).shareLinksPath,
  ).toBeUndefined()
})

it("lists the learnings agents applied in the selected Build", () => {
  const repository = { id: "2001", nameWithOwner: "example/repository", defaultBranch: "main" }
  const workspace: WorkspaceResponse = {
    viewer: { id: "123", login: "octocat", name: null, provider: "github", avatarUrl: null },
    repositories: [repository],
  }
  const build = {
    number: 3,
    repositoryId: repository.id,
    prototypeId: "1",
    state: "successful",
    commitSha: "a".repeat(40),
    commitAuthorLogin: null,
    createdAt: "2026-12-20T12:00:00Z",
    startedAt: null,
    finishedAt: null,
    previewUrl: "https://preview.example.com/",
    desktopScreenshotUrl: null,
    narrowScreenshotUrl: null,
    failureSummary: null,
  }
  const response = prototypeResponseSchema.parse({
    repository,
    prototype: {
      id: "1",
      repositoryId: repository.id,
      name: "Prototype",
      branchName: "prototype/welcome",
      authorLogin: null,
      canEdit: false,
      description: null,
      builds: [build],
    },
    selectedBuild: build,
  })
  const sha256 = "b".repeat(64)

  const result = prototypeShowData(workspace, response, new URLSearchParams("build=3"), [
    { id: "mem_1", title: "Label every field", version: 2, after: { sha256, route: "/" } },
  ])

  expect(result.agentReportedUseLabel).toBe("Applied learnings")
  expect(result.agentReportedUse).toMatchObject({
    buildNumber: 3,
    learnings: [
      {
        id: "mem_1",
        label: "Label every field · v2",
        afterScreenshot: {
          url: `/api/repositories/2001/learnings/screenshots/${sha256}`,
          label: "View after screenshot for Label every field",
        },
      },
    ],
  })
  expect(result.agentReportedUse?.learnings[0]?.beforeScreenshot).toBeUndefined()
})
