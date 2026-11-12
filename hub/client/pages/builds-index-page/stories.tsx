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
      builds: [
        {
          ...successfulBuild,
          number: 3,
          numberLabel: "build 3",
          path: "/repositories/2001/prototypes/1/builds/3",
          state: "running",
          stateLabel: "Running",
        },
        {
          ...successfulBuild,
          number: 2,
          numberLabel: "build 2",
          path: "/repositories/2001/prototypes/1/builds/2",
          state: "failed",
          stateLabel: "Failed",
        },
        successfulBuild,
      ],
      buildOptions: [
        {
          number: 3,
          label: "v3",
          path: "/repositories/2001/prototypes/1/builds/3",
          state: "running",
          stateLabel: "Running",
        },
        {
          number: 2,
          label: "v2",
          path: "/repositories/2001/prototypes/1/builds/2",
          state: "failed",
          stateLabel: "Failed",
        },
        ...data.buildOptions,
      ],
      latestBuild: { number: 3, state: "running", stateLabel: "Running" },
      nextPagePath:
        "/repositories/2001/prototypes/1/builds?before=1&before_at=2026-09-14T12%3A00%3A00.000000Z",
    },
  },
}
