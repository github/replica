import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"

import { octocatRootComment } from "@/storybook/fixtures/review/comments"
import { reviewCommentsCopy } from "@utils/review-comment/en"
import { useEmojiBurst } from "@hooks/use-emoji-burst"
import type { ReviewReactionContent } from "@utils/review-comment/types"

import { ReviewCommentReactions } from "."
import type { ReviewCommentReactionsProps } from "./types"

function updateReaction() {
  return Promise.resolve(true)
}

function ReactionDemo(props: ReviewCommentReactionsProps) {
  const { burst, canvas } = useEmojiBurst()
  const [comment, setComment] = useState(props.comment)
  async function change(content: ReviewReactionContent, adding: boolean) {
    await new Promise((resolve) => window.setTimeout(resolve, 600))
    const saved = adding ? await props.onAdd(content) : await props.onRemove(content)
    if (!saved) return false

    setComment((current) => {
      const existing = current.reactions.find((reaction) => reaction.content === content)
      const reactions = current.reactions.filter((reaction) => reaction.content !== content)
      const count = (existing?.count ?? 0) + (adding ? 1 : -1)
      if (count > 0) reactions.push({ content, count, viewerHasReacted: adding })
      return { ...current, reactions }
    })
    return true
  }
  return (
    <>
      <ReviewCommentReactions
        {...props}
        comment={comment}
        onAdd={(content) => change(content, true)}
        onRemove={(content) => change(content, false)}
        onBurst={burst}
      />
      {canvas}
    </>
  )
}

const meta = {
  title: "Hub/Features/Review/Comment Reactions",
  component: ReviewCommentReactions,
  render: (args) => <ReactionDemo {...args} />,
  parameters: {
    docs: {
      description: {
        component:
          "Reaction counts, selection, and the add burst respond immediately while the simulated save takes 600ms. Failed saves restore the counts and show an error. Closing the picker keeps focus on Add reaction without reopening its tooltip.",
      },
    },
  },
  args: {
    comment: octocatRootComment,
    mutation: null,
    actionsDisabled: false,
    copy: reviewCommentsCopy,
    onAdd: updateReaction,
    onRemove: updateReaction,
    onBurst: () => undefined,
  },
} satisfies Meta<typeof ReviewCommentReactions>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: {
    comment: { ...octocatRootComment, reactions: [] },
  },
}

export const Single: Story = {}

export const ActionsDisabled: Story = {
  args: {
    actionsDisabled: true,
  },
}

export const FailedSave: Story = {
  args: {
    onAdd: () => Promise.resolve(false),
    onRemove: () => Promise.resolve(false),
  },
}

export const Multiple: Story = {
  args: {
    comment: {
      ...octocatRootComment,
      reactions: [
        { content: "heart", count: 2, viewerHasReacted: true },
        { content: "+1", count: 1, viewerHasReacted: false },
      ],
    },
  },
}
