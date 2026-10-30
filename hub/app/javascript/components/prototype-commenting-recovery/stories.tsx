import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@primer/react-brand/esm"
import { useState, type ComponentProps } from "react"
import { CommentingRecovery } from "."

function RecoveryExample(props: ComponentProps<typeof CommentingRecovery>) {
  const [open, setOpen] = useState(true)
  const [requested, setRequested] = useState(false)
  return (
    <>
      <Button
        onClick={() => {
          setRequested(false)
          setOpen(true)
        }}
      >
        Show commenting dialog
      </Button>
      {open ? (
        <CommentingRecovery
          {...props}
          requested={props.requested || requested}
          onFix={() => setRequested(true)}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

const meta = {
  title: "Prototype canvas/Commenting recovery",
  component: CommentingRecovery,
  render: (args) => <RecoveryExample {...args} />,
  args: {
    busy: false,
    requested: false,
    onFix: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof CommentingRecovery>
export default meta
type Story = StoryObj<typeof meta>
export const MissingBridge: Story = {}
export const FixRequested: Story = { args: { requested: true } }
export const FixRequestFailed: Story = { args: { error: "Could not reach Copilot. Try again." } }
export const RequestingFix: Story = { args: { busy: true } }
