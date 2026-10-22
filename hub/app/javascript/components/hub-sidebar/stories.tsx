import { Button } from "@primer/react-brand"
import { useState, type ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubSidebar } from "."

function SidebarDemo(props: ComponentProps<typeof HubSidebar>) {
  const [open, setOpen] = useState(props.open)
  return (
    <div
      style={{
        position: "relative",
        height: "28rem",
        width: "min(30rem, 100%)",
        overflow: "hidden",
      }}
    >
      <Button size="small" onClick={() => setOpen(true)}>
        Open sidebar
      </Button>
      <HubSidebar {...props} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

const meta = {
  title: "Components/Sidebar",
  component: HubSidebar,
  render: (args) => <SidebarDemo {...args} />,
  args: {
    title: "Replica Hub",
    open: true,
    closeLabel: "Close Hub",
    onClose: () => {},
    children: <div style={{ padding: "1rem" }}>Customizable sidebar content</div>,
  },
} satisfies Meta<typeof HubSidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}
export const Closed: Story = { args: { open: false } }
export const WithAccessory: Story = {
  args: { title: "Comments", closeLabel: "Close comments", headerAccessory: <span>3</span> },
}
export const CloseBlocked: Story = { args: { closeDisabled: true } }
