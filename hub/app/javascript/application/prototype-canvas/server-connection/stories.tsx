import { useEffect, useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { CanvasServerConnection } from "@features/canvas-server-connection"

import { serverConnectionFixtureResponse } from "./fixture-response"

function ServerConnection({ scenario }: { scenario: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const original = window.fetch.bind(window)
    window.fetch = async (input) => {
      const path =
        typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url
      return serverConnectionFixtureResponse(scenario, path)
    }
    const timer = window.setTimeout(() => setReady(true), 0)
    return () => {
      window.clearTimeout(timer)
      window.fetch = original
    }
  }, [scenario])
  return ready ? (
    <div style={{ padding: "2rem", maxWidth: "48rem", margin: "auto" }}>
      <CanvasServerConnection token="fixture-only" />
    </div>
  ) : null
}

const meta = {
  title: "Prototype canvas/Server connection",
  component: ServerConnection,
  args: { scenario: "single" },
  parameters: { layout: "fullscreen" },
  render: (args) => <ServerConnection key={args.scenario} {...args} />,
} satisfies Meta<typeof ServerConnection>
export default meta
type Story = StoryObj<typeof meta>

export const Scanning: Story = { args: { scenario: "scanning" } }
export const NoServers: Story = { args: { scenario: "empty" } }
export const SingleServer: Story = {}
export const MultipleServers: Story = { args: { scenario: "multiple" } }
export const ScriptSelection: Story = { args: { scenario: "scripts" } }
export const ScriptMenuOpen: Story = {
  args: { scenario: "scripts" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Dev server script: npm run dev" }),
    )
  },
}
export const ScanFailed: Story = { args: { scenario: "scan-failed" } }
export const DiscoveryWarnings: Story = { args: { scenario: "warnings" } }
export const StartupUnavailable: Story = { args: { scenario: "startup-unavailable" } }
export const Connecting: Story = {
  args: { scenario: "connecting" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Connect" }))
  },
}
export const ConnectFailed: Story = { ...Connecting, args: { scenario: "connect-failed" } }
export const Starting: Story = {
  args: { scenario: "starting" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Start dev server" }))
  },
}
export const StartFailed: Story = { ...Starting, args: { scenario: "start-failed" } }
