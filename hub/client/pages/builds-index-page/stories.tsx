import type { Meta, StoryObj } from "@storybook/react-vite"

import { successfulBuild } from "@/storybook/fixtures/builds"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

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

export const RealHistory: Story = {
  args: {
    data: {
      ...data,
      ...Multiple.args?.data,
      branchPath: "/repositories/2001/prototypes/1?build=1",
      buildOptions: [
        ...Array.from({ length: 25 }, (_, index) => {
          const number = 28 - index
          return {
            number,
            label: `v${number}`,
            path: `/repositories/2001/prototypes/1?build=${number}`,
            state: "successful" as const,
            stateLabel: "Successful",
          }
        }),
        ...(Multiple.args?.data?.buildOptions ?? []),
      ],
      closeLabel: "Return to prototype",
      closePath: "/repositories/2001/prototypes/1?build=1",
      latestBuild: { number: 28, state: "successful", stateLabel: "Successful" },
      newPrototypePath: null,
      newestPagePath: "/repositories/2001/prototypes/1/builds?build=1",
      securityAuditPath: null,
      selectedBuild: { number: 1 },
      selectedBuildNumber: 1,
      shareLinksPath: undefined,
      signOutPath: "/api/auth/session/sign-out",
    },
  },
}
