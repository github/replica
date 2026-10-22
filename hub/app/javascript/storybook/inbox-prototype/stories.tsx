import type { Meta, StoryObj } from "@storybook/react-vite"

import { InboxPrototype } from "@/storybook/inbox-prototype"

const meta = {
  title: "Hub/Pages/Inbox prototype",
  component: InboxPrototype,
  args: {
    empty: false,
    initialInbox: false,
    initialUnread: false,
    defaultNavigationCollapsed: false,
  },
  render: (args) => (
    <InboxPrototype
      key={`${args.empty}-${args.initialInbox}-${args.initialUnread}-${args.defaultNavigationCollapsed}`}
      {...args}
    />
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof InboxPrototype>

export default meta
type Story = StoryObj<typeof meta>

export const Workspace: Story = {}
export const FullPage: Story = { args: { initialInbox: true } }
export const Empty: Story = { args: { empty: true } }
export const CollapsedSidebar: Story = { args: { defaultNavigationCollapsed: true } }
export const InboxPreview: Story = {
  args: { empty: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.hover(canvas.getByRole("link", { name: "Inbox" }))
  },
}
