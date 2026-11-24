import type {
  BuildRecord,
  PrototypeResponse,
  RepositoryRecord,
} from "@application/hub/contracts/types"

export function previewRecords({
  repositoryId = "11111111-1111-4111-8111-111111111111",
  prototypeId = "22222222-2222-4222-8222-222222222222",
  name = "Welcome",
  canEdit = true,
  canReview = false,
  canManageSharing = false,
  canBranch = true,
} = {}) {
  const repository: RepositoryRecord = {
    id: repositoryId,
    nameWithOwner: "github/prototype",
    defaultBranch: "main",
    capabilities: {
      reviewPrototypes: canReview,
      manageSharing: canManageSharing,
      browseTemplates: canBranch,
    },
  }
  const historical: BuildRecord = {
    number: 1,
    repositoryId,
    prototypeId,
    state: "successful",
    commitSha: "a".repeat(40),
    commitAuthorProvider: "github",
    commitAuthorLogin: "octocat",
    createdAt: "2026-10-01T10:00:00Z",
    startedAt: "2026-10-01T10:01:00Z",
    finishedAt: "2026-10-01T10:02:00Z",
    previewUrl: "https://build-1.example.test/preview/",
    privatePreviewUrl: "https://build-1.example.test/preview/",
    desktopScreenshotUrl: null,
    narrowScreenshotUrl: null,
    failureSummary: null,
  }
  const latest: BuildRecord = {
    ...historical,
    number: 3,
    commitSha: "b".repeat(40),
    previewUrl: "https://build-3.example.test/preview/",
    privatePreviewUrl: "https://build-3.example.test/preview/",
  }
  const response: PrototypeResponse = {
    repository,
    prototype: {
      id: prototypeId,
      repositoryId,
      name,
      branchName: `prototype/${name.toLowerCase()}`,
      description: "Make the welcome flow easier to use.",
      startPage: "/",
      authorLogin: "octocat",
      authorProvider: "github",
      canEdit,
      canManageShareLinks: canManageSharing,
      latestBuild: { number: latest.number, state: latest.state },
      builds: [latest, historical],
    },
    controlsIdentity: `prototype-${prototypeId}`,
    showPrototypeInfo: true,
    canBranch,
    selectedBuild: latest,
  }
  return {
    ...response,
    historical,
    latest,
    galleryPath: `/repositories/${repositoryId}`,
    path: `/repositories/${repositoryId}/prototypes/${prototypeId}`,
  }
}
