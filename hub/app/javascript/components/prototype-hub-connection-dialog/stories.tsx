import { createRef, useState, type ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { HubConnectionDialog } from "."
import { copy } from "@utils/prototype-canvas/en"

function ConnectionDemo(args: ComponentProps<typeof HubConnectionDialog>) {
  const [status, setStatus] = useState(args.status)
  const [pairing, setPairing] = useState(args.pairing)
  return (
    <HubConnectionDialog
      {...args}
      status={status}
      pairing={pairing}
      onSelectHub={async (origin) => {
        await args.onSelectHub(origin)
        setStatus({ ...status, state: "disconnected", hubOrigin: origin })
      }}
      onConnect={async (origin) => {
        await args.onConnect(origin)
        if (!args.connecting && !args.error)
          setPairing({
            verificationUrl: "https://hub.example.com/canvas/pair/ABCD1234",
            userCode: "ABCD1234",
          })
      }}
    />
  )
}

const meta = {
  title: "Components/Prototype canvas/Hub connection dialog",
  component: HubConnectionDialog,
  args: {
    status: {
      state: "disconnected",
      repository: "github/prototype",
      hubOrigin: "https://hub.example.com",
    },
    connecting: false,
    error: "",
    onConnect: async () => {},
    onSelectHub: async () => {},
    onResetHub: () => Promise.resolve("https://hub.example.com"),
    onClose: () => {},
    hubButtonRef: createRef<HTMLButtonElement>(),
  },
  render: (args) => <ConnectionDemo {...args} />,
} satisfies Meta<typeof HubConnectionDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Connect: Story = {}
export const Editing: Story = {
  play: async ({ canvas, userEvent }) => {
    const edit = await canvas.findByRole("button", { name: "Edit Hub URL" })
    await userEvent.click(edit)
  },
}
export const ChooseHub: Story = {
  args: { status: { state: "unconfigured", repository: "github/prototype" } },
}
export const OpeningBrowser: Story = { args: { connecting: true } }
export const AwaitingApproval: Story = {
  play: async ({ canvas }) => {
    const group = await canvas.findByRole("group", { name: "Browser approval" })
    if (!group.querySelector("a") || !group.querySelector("button"))
      throw new Error("Pending approval needs joined link and copy actions.")
    if (group.querySelector("a") !== group.ownerDocument.activeElement)
      throw new Error("Pending approval must focus the approval link.")
  },
  args: {
    pairing: {
      verificationUrl: "https://hub.example.com/canvas/pair/ABCD1234",
      userCode: "ABCD1234",
    },
  },
}
export const BrowserUnavailable: Story = {
  args: {
    ...AwaitingApproval.args,
    error: "Could not open your browser. Open or copy the approval link below.",
  },
}
export const ConnectionFailed: Story = {
  args: { error: "Hub could not verify repository access. Retry the connection." },
}
export const RepositoryUnavailable: Story = {
  args: { status: { state: "disconnected", hubOrigin: "https://hub.example.com" } },
}
export const SavingUrl: Story = {
  args: { onSelectHub: () => new Promise(() => {}) },
  play: async (context) => {
    await Editing.play?.(context)
    await context.userEvent.click(context.canvas.getByRole("button", { name: copy.saveHub }))
  },
}
export const SaveFailed: Story = {
  args: {
    onSelectHub: () => Promise.reject(new Error("Could not save the Hub URL. Try again.")),
  },
  play: async (context) => {
    await SavingUrl.play?.(context)
    await context.canvas.findByRole("alert")
  },
}
export const ResettingUrl: Story = {
  args: { onResetHub: () => new Promise(() => {}) },
  play: async (context) => {
    await Editing.play?.(context)
    await context.userEvent.click(context.canvas.getByRole("button", { name: copy.resetHubUrl }))
  },
}
export const ResetFailed: Story = {
  args: {
    onResetHub: () => Promise.reject(new Error("Could not read the repository's Hub URL.")),
  },
  play: async (context) => {
    await ResettingUrl.play?.(context)
    await context.canvas.findByRole("alert")
  },
}
