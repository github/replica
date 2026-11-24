import type { Meta, StoryObj } from "@storybook/react-vite"

import { successfulBuild } from "@/storybook/fixtures/builds"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"
import { signedInRepository, signedInWorkspace } from "@/storybook/fixtures/signed-in-workspace"

import { BuildsIndexPage } from "."
import type { BuildsIndexPageData } from "./types"

const data: BuildsIndexPageData = {
  ...prototypeWorkspaceData,
  builds: [],
  buildsHeading: "History",
  closePath: "/repositories/2001/prototypes/1",
  emptyLabel: "No Builds have been recorded.",
  pageTitle: "prototype/welcome Builds",
  nextPageLabel: "Older Builds",
  nextPagePath: null,
  newestPageLabel: "Newest Builds",
  newestPagePath: null,
  shareLinksLabel: "Share links",
  shareLinksPath: "/repositories/2001/prototypes/1/share_links",
}

const meta = {
  title: "Hub/Pages/Builds/Index",
  component: BuildsIndexPage,
  args: { data },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BuildsIndexPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: {
    data: {
      ...data,
      buildOptions: [],
      closePath: "/repositories/2001/prototypes/1",
      selectedBuild: undefined,
      shareLinksLabel: undefined,
      shareLinksPath: undefined,
    },
  },
}

export const Single: Story = {
  args: {
    data: { ...data, builds: [successfulBuild] },
  },
}

export const UnlinkedAuthor: Story = {
  args: {
    data: {
      ...data,
      builds: [
        {
          ...successfulBuild,
          author: { avatarUrl: null, label: "By Sam", url: null },
        },
      ],
    },
  },
}

export const Multiple: Story = {
  args: {
    data: {
      ...data,
      buildOptions: [
        { number: 3, label: "v3", path: null, state: "running", stateLabel: "Running" },
        { number: 2, label: "v2", path: null, state: "failed", stateLabel: "Failed" },
        ...data.buildOptions,
      ],
      builds: [
        {
          ...successfulBuild,
          number: 3,
          numberLabel: "build 3",
          path: null,
          state: "running",
          stateLabel: "Running",
        },
        {
          ...successfulBuild,
          number: 2,
          numberLabel: "build 2",
          path: null,
          state: "failed",
          stateLabel: "Failed",
        },
        successfulBuild,
      ],
      latestBuild: { number: 3, state: "running", stateLabel: "Running" },
    },
  },
}

const prototypePath = `${signedInRepository.prototypesPath}/prototypes/00000000-0000-4000-8000-000000000201`
const pinnedBuildPath = `${prototypePath}?build=28`
const pinnedHistoryPath = `${prototypePath}/builds?build=28`
const addedTime = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})
const middleBuilds: BuildsIndexPageData["builds"] = Array.from({ length: 25 }, (_, index) => {
  const number = 55 - index
  const created = new Date(Date.UTC(2026, 8, 14, 12, -30 * index))
  const shortCommitSha = number.toString(16).padStart(7, "0")
  const state = index === 0 ? "queued" : index === 1 ? "superseded" : "successful"
  return {
    ...successfulBuild,
    number,
    numberLabel: `Build ${number}`,
    path: state === "successful" ? `${prototypePath}?build=${number}` : null,
    commitLabel: `Commit ${shortCommitSha}`,
    shortCommitSha,
    commitSha: shortCommitSha.padEnd(40, "a"),
    createdAt: created.toISOString(),
    createdLabel: `Added to Hub ${addedTime.format(created)}`,
    state,
    stateLabel:
      state === "queued" ? "Queued" : state === "superseded" ? "Superseded" : "Successful",
  }
})

export const RealHistory: Story = {
  name: "Middle page with a pinned Build",
  args: {
    data: {
      ...data,
      ...signedInRepository,
      authenticityToken: "",
      branchPath: pinnedBuildPath,
      builds: middleBuilds,
      buildOptions: [
        ...middleBuilds.map(({ number, path, state, stateLabel }) => ({
          number,
          label: `v${number}`,
          path,
          state,
          stateLabel,
        })),
        {
          number: 28,
          label: "v28",
          path: pinnedBuildPath,
          state: "successful",
          stateLabel: "Successful",
        },
      ],
      closeLabel: "Return to prototype",
      closePath: pinnedBuildPath,
      historyPath: pinnedHistoryPath,
      latestBuild: { number: 80, state: "successful", stateLabel: "Successful" },
      newestPagePath: pinnedHistoryPath,
      nextPagePath: `${pinnedHistoryPath}&page=3`,
      pageTitle: "Welcome · Build history",
      prototypeName: "Welcome",
      repositoryPath: signedInRepository.prototypesPath,
      securityAuditPath: null,
      selectedBuild: { number: 28 },
      selectedBuildNumber: 28,
      shareLinksPath: undefined,
      signOutPath: signedInWorkspace.signOutPath,
    },
  },
}
