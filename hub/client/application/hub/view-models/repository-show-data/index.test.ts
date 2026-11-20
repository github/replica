import { describe, expect, it } from "vitest"

import { repositoryResponseSchema, workspaceResponseSchema } from "@application/hub/contracts"

import { repositoryShowData } from "."

describe("repositoryShowData()", () => {
  it("uses a GitHub snapshot without joining an unrelated user by login in real data", () => {
    const repository = { id: "1", nameWithOwner: "example/repository", defaultBranch: "main" }
    const workspace = workspaceResponseSchema.parse({
      viewer: { id: "viewer", login: "viewer", name: null, avatarUrl: null },
      repositories: [repository],
    })
    const data = repositoryResponseSchema.parse({
      repository,
      prototypes: [
        {
          id: "2",
          repositoryId: repository.id,
          name: "GitHub snapshot",
          branchName: "proto/github",
          description: null,
          authorId: null,
          authorLogin: "sam",
          authorProvider: "github",
          canEdit: false,
          builds: [],
        },
        {
          id: "3",
          repositoryId: repository.id,
          name: "Explicit owner",
          branchName: "proto/owner",
          description: null,
          authorId: "entra-user",
          authorLogin: "sam",
          authorProvider: "entra",
          canEdit: false,
          builds: [],
        },
      ],
      pagination: { page: 1, pageSize: 20, totalCount: 2, pageCount: 1 },
      authors: [
        {
          id: "entra-user",
          login: "sam",
          name: "Entra user",
          provider: "entra",
          avatarUrl: "https://example.test/entra.png",
        },
      ],
    })

    const { prototypes } = repositoryShowData(workspace, data, new URLSearchParams(), {
      real: true,
    })

    expect.soft(prototypes.find(({ id }) => id === "2")?.author).toEqual({
      avatarUrl: null,
      label: "By @sam",
      ownerLabel: "@sam",
      url: "https://github.com/sam",
    })
    expect(prototypes.find(({ id }) => id === "3")?.author).toEqual({
      avatarUrl: "https://example.test/entra.png",
      label: "By Entra user",
      ownerLabel: "Entra user",
      url: null,
    })
  })
})
