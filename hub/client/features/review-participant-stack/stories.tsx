import type { Meta, StoryObj } from "@storybook/react-vite"

import { overflowReviewParticipants } from "@/storybook/fixtures/review/comments"
import { mona, octocat } from "@/storybook/fixtures/users"

import { ReviewParticipantStack } from "."

const meta = {
  title: "Hub/Features/Review/Participant Stack",
  component: ReviewParticipantStack,
  args: {
    participants: [octocat],
    size: "medium",
  },
} satisfies Meta<typeof ReviewParticipantStack>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {}

export const Multiple: Story = {
  args: {
    participants: [octocat, mona],
  },
}

export const Overflow: Story = {
  args: {
    size: "small",
    participants: overflowReviewParticipants,
  },
}
