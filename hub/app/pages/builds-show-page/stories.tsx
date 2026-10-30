import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  welcomeFullPageScreenshot,
  welcomeNarrowFullPageScreenshot,
} from "@/storybook/fixtures/builds"
import { prototypeWorkspaceData } from "@/storybook/fixtures/prototype-workspace"

import { BuildsShowPage } from "."
import type { BuildsShowPageData } from "./types"

const data: BuildsShowPageData = {
  ...prototypeWorkspaceData,
  buildOptions: [
    {
      number: 1,
      label: "v1",
      path: "/repositories/2001/prototypes/1/builds/1",
      state: "running",
      stateLabel: "Running",
    },
  ],
  commitAuthor: prototypeWorkspaceData.author,
  commitHeading: "Exact commit",
  commitSha: "a".repeat(40),
  closePath: "/repositories/2001/prototypes/1",
  createdAt: "2026-09-14T12:00:00Z",
  createdLabel: "Added to Hub September 14, 2026",
  heading: "build 1",
  pageTitle: "build 1",
  selectedBuild: undefined,
  state: "running",
  stateLabel: "Running",
  timelineHeading: "Timeline",
  startedAt: "2026-09-14T12:01:00Z",
  startedLabel: "Started September 14, 2026",
  workflowHeading: "GitHub Actions",
  workflowLabel: "View workflow run",
  workflowUrl: "https://github.com/github/prototype/actions/runs/10001",
}

const meta = {
  title: "Hub/Pages/Builds/Show",
  component: BuildsShowPage,
  args: { data },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BuildsShowPage>

export default meta
type Story = StoryObj<typeof meta>

export const InProgress: Story = {}

export const Successful: Story = {
  args: {
    data: {
      ...data,
      buildOptions: prototypeWorkspaceData.buildOptions,
      closePath: "/repositories/2001/prototypes/1?build=1",
      desktopScreenshot: {
        alt: "Desktop screenshot of prototype/welcome",
        label: "Desktop",
        src: welcomeFullPageScreenshot,
      },
      finishedAt: "2026-09-14T12:03:00Z",
      finishedLabel: "Stored September 14, 2026",
      narrowScreenshot: {
        alt: "Narrow screenshot of prototype/welcome",
        label: "Narrow viewport",
        src: welcomeNarrowFullPageScreenshot,
      },
      previewLabel: "Review build",
      previewPath: "/repositories/2001/prototypes/1?build=1",
      publicationHeading: "Stored build output",
      retainedSizeLabel: "Storage used: 24.5 MB",
      screenshotsHeading: "Screenshots",
      selectedBuild: prototypeWorkspaceData.selectedBuild,
      shareLinksLabel: "Share links",
      shareLinksPath: "/repositories/2001/prototypes/1/share_links?build=1",
      state: "successful",
      stateLabel: "Successful",
      workflowCompletedAt: "2026-09-14T12:02:00Z",
      workflowCompletedLabel: "Workflow completed September 14, 2026",
    },
  },
}

export const Failed: Story = {
  args: {
    data: {
      ...data,
      failureHeading: "Build failed",
      failureSummary: "The repository workflow did not produce a valid prototype artifact.",
      buildOptions: [
        {
          number: 1,
          label: "v1",
          path: "/repositories/2001/prototypes/1/builds/1",
          state: "failed",
          stateLabel: "Failed",
        },
      ],
      selectedBuild: undefined,
      state: "failed",
      stateLabel: "Failed",
    },
  },
}
