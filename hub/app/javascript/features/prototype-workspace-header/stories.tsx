import type { Meta, StoryObj } from "@storybook/react-vite"

import { replicaBrowseData } from "@/storybook/fixtures/replica-browse"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { octocat } from "@/storybook/fixtures/users"

import { PrototypeWorkspaceHeader } from "."
import type { PrototypeWorkspaceHeaderData } from "./types"

const data: PrototypeWorkspaceHeaderData = {
  author: {
    avatarUrl: octocat.avatarUrl,
    label: "By @octocat",
    url: "https://github.com/octocat",
  },
  branchName: "prototype/welcome",
  branchPath: "/repositories/2001/prototypes/1?build=1",
  buildOptions: [
    {
      number: 1,
      label: "v1",
      path: "/repositories/2001/prototypes/1?build=1",
      state: "successful",
    },
  ],
  buildSelectionLabel: "Choose build",
  closeLabel: "Close",
  historyLabel: "History",
  historyPath: "/repositories/2001/prototypes/1/builds",
  moreActionsLabel: "More actions",
  repositoryPath: "/repositories/2001",
  selectedBuild: {
    detailsLabel: "Build details",
    detailsPath: "/repositories/2001/prototypes/1/builds/1",
    number: 1,
  },
  shareLinksLabel: "Share links",
  shareLinksPath: "/repositories/2001/prototypes/1/share_links?build=1",
  useDarkThemeLabel: "Use dark theme",
  useLightThemeLabel: "Use light theme",
}

function noop() {}

const meta = {
  title: "Hub/Features/Review/Shell Header",
  component: PrototypeWorkspaceHeader,
  parameters: {
    docs: {
      description: {
        component:
          "Build, Comment, and More actions use Primer Brand ActionMenu with small controls.",
      },
    },
  },
  args: {
    data,
    fork: { label: "Branch from here", onClick: noop },
    reviewControls: {
      bridgeReady: true,
      commentCount: 0,
      copy: reviewCommentsCopy,
      hasUnreadComments: false,
      selectionBlocked: false,
      selecting: false,
      sidebarToggleBlocked: false,
      sidebarOpen: false,
      onCancelSelection: noop,
      onStartAreaSelection: noop,
      onStartElementSelection: noop,
      onToggleSidebar: noop,
    },
  },
} satisfies Meta<typeof PrototypeWorkspaceHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const ReplicaBrowse: Story = {
  args: {
    data: replicaBrowseData,
    fork: { label: replicaBrowseData.forkLabel, onClick: noop },
  },
}

export const UnreadComments: Story = {
  args: {
    reviewControls: {
      ...meta.args.reviewControls,
      commentCount: 3,
      hasUnreadComments: true,
    },
  },
}

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ containerType: "inline-size", width: "24rem" }}>
        <Story />
      </div>
    ),
  ],
}

export const NewerBuildFailed: Story = {
  args: {
    data: {
      ...data,
      newerBuildLabel: "The latest update failed. You're viewing an earlier version.",
      buildOptions: [
        ...data.buildOptions,
        {
          number: 2,
          label: "v2",
          path: "/repositories/2001/prototypes/1/builds/2",
          state: "failed",
          stateLabel: "Failed to build",
        },
      ],
    },
  },
}

const longBuildStatus = {
  ...data,
  buildOptions: [
    {
      number: 1,
      label: "v1",
      path: "/repositories/2001/prototypes/1?build=1",
      state: "successful" as const,
      stateLabel: "Pending review (12 checks remaining)",
    },
    {
      number: 2,
      label: "v2",
      path: "/repositories/2001/prototypes/1?build=2",
      state: "failed" as const,
      stateLabel: "Failed to build",
    },
  ],
}

export const LongBuildStatus: Story = {
  args: { data: longBuildStatus },
}

export const NarrowLongBuildStatus: Story = {
  args: { data: longBuildStatus },
  decorators: [
    (Story) => (
      <div style={{ containerType: "inline-size", width: "20rem" }}>
        <Story />
      </div>
    ),
  ],
}

export const ManyBuilds: Story = {
  args: {
    data: {
      ...data,
      buildOptions: Array.from({ length: 18 }, (_, index) => ({
        number: index + 1,
        label: `v${index + 1}`,
        path: `/repositories/2001/prototypes/1?build=${index + 1}`,
        state: "successful" as const,
        stateLabel: index % 3 === 0 ? "Ready to review" : undefined,
      })),
    },
  },
}

export const Unavailable: Story = {
  args: {
    reviewControls: { ...meta.args.reviewControls, bridgeReady: false },
  },
}

export const Selecting: Story = {
  args: {
    reviewControls: { ...meta.args.reviewControls, selecting: true },
  },
}
