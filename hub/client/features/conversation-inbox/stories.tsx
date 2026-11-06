import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { inboxActivities, inboxCopy } from "@/storybook/fixtures/inbox-activity"

import { ConversationInbox } from "."

const meta = {
  title: "Hub/Features/Conversation inbox",
  component: ConversationInbox,
  args: {
    items: inboxActivities,
    copy: inboxCopy,
    mode: "preview",
    unreadOnly: false,
    onFilter: () => {},
    onToggleRead: () => {},
    onViewAll: () => {},
    onOpenActivity: () => {},
  },
  render: function ConversationInboxStory(args) {
    const [unreadOnly, setUnreadOnly] = useState(args.unreadOnly)
    const [items, setItems] = useState(args.items)
    return (
      <div style={{ width: "min(28rem, 100%)" }}>
        <ConversationInbox
          {...args}
          unreadOnly={unreadOnly}
          items={items}
          onFilter={setUnreadOnly}
          onToggleRead={(id) =>
            setItems((previous) =>
              previous.map((item) => (item.id === id ? { ...item, read: !item.read } : item)),
            )
          }
        />
      </div>
    )
  },
} satisfies Meta<typeof ConversationInbox>

export default meta
type Story = StoryObj<typeof meta>

export const Multiple: Story = {}
export const Single: Story = { args: { items: inboxActivities.slice(0, 1) } }
export const Empty: Story = { args: { items: [] } }
