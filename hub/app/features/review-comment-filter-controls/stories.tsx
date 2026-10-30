import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { defaultReviewFilters } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { mona, octocat } from "@/storybook/fixtures/users"
import type { ReviewCommentFilters } from "@utils/review-comment/types"

import { ReviewCommentFilterControls } from "."

function FilterDemo({ active = false, search = "" }: { active?: boolean; search?: string }) {
  const [filters, setFilters] = useState<ReviewCommentFilters>(
    active
      ? { ...defaultReviewFilters, search, showRead: false, onlyMine: true }
      : { ...defaultReviewFilters, search },
  )
  const [showPins, setShowPins] = useState(!active)

  return (
    <div style={{ width: "22rem" }}>
      <ReviewCommentFilterControls
        filters={filters}
        participants={[octocat, mona]}
        showPins={showPins}
        copy={reviewCommentsCopy}
        onFiltersChange={setFilters}
        onShowPinsChange={setShowPins}
      />
    </div>
  )
}

const meta = {
  title: "Hub/Features/Review/Comment Filters",
  component: ReviewCommentFilterControls,
  args: {
    filters: defaultReviewFilters,
    participants: [octocat, mona],
    showPins: true,
    copy: reviewCommentsCopy,
    onFiltersChange: () => undefined,
    onShowPinsChange: () => undefined,
  },
} satisfies Meta<typeof ReviewCommentFilterControls>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <FilterDemo />,
}

export const Active: Story = {
  render: () => <FilterDemo active />,
}

export const Searching: Story = {
  render: () => <FilterDemo search="spacing" />,
}
