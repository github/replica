import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"

import reviewStory from "../stories"

import { PrototypeDescriptionDialog } from "."

function DescriptionStory(props: ComponentProps<typeof PrototypeDescriptionDialog>) {
  const [editing, setEditing] = useState(props.editing)
  return <PrototypeDescriptionDialog {...props} editing={editing} onEditingChange={setEditing} />
}

const meta = {
  title: "Hub/Features/Review/Prototype description",
  component: PrototypeDescriptionDialog,
  render: (args, context) => <DescriptionStory key={context.id} {...args} />,
  args: {
    data: reviewStory.args.data,
    onBranch: () => {},
    onClose: () => {},
    editing: false,
    onEditingChange: () => {},
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PrototypeDescriptionDialog>

export default meta
type Story = StoryObj<typeof meta>

export const WithDescription: Story = {}

export const WithoutDescription: Story = {
  args: {
    data: {
      ...reviewStory.args.data,
      prototypeDescription: null,
      author: { avatarUrl: null, label: "Author unavailable", url: null },
    },
  },
}

export const Visitor: Story = {
  args: {
    data: {
      ...reviewStory.args.data,
      detailsEditPath: undefined,
    },
  },
}
