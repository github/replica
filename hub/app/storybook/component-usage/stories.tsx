import type { Meta, StoryObj } from "@storybook/react-vite"

import { UsageView } from "../../../.storybook/usage-view"

const meta = {
  title: "Hub/Design/Component usage",
  component: UsageView,
  args: { entries: [], storyLinks: {} },
} satisfies Meta<typeof UsageView>

export default meta
type Story = StoryObj<typeof meta>

export const DirectAndTransitive: Story = {
  args: {
    entries: [
      {
        path: "app/components/hub-sidebar/index.tsx",
        usage: {
          consumers: [
            { path: "app/features/review-comments-sidebar/index.tsx", lines: [101] },
            { path: "app/features/prototype-canvas-hub-panel/index.tsx", lines: [1170] },
          ],
          surfaces: [
            "app/application/prototype-canvas/index.tsx",
            "app/application/start-prototype-canvas/index.tsx",
            "app/pages/prototypes-show-page/index.tsx",
          ],
        },
      },
    ],
    storyLinks: {
      "app/features/review-comments-sidebar/index.tsx": [
        {
          id: "hub-features-review-comments-sidebar--empty",
          title: "Hub/Features/Review/Comments Sidebar",
        },
      ],
    },
  },
}

export const NoProductionConsumers: Story = {
  args: {
    entries: [
      {
        path: "app/components/feedback-icon/index.tsx",
        usage: { consumers: [], surfaces: [] },
      },
    ],
  },
}

export const UnmappedStory: Story = {}
