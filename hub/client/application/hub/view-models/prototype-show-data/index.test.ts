import { expect, it } from "vitest"

import { prototypeResponseSchema } from "@application/hub/contracts"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { prototypeShowData } from "."

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
  expect(
    prototypeShowData(workspace, data("1", true), new URLSearchParams(), { real: true })
      .shareLinksPath,
  ).toBe("/repositories/2001/prototypes/1/share-links")
  expect(
    prototypeShowData(workspace, data("2", false), new URLSearchParams(), { real: true })
      .shareLinksPath,
  ).toBeUndefined()
})
