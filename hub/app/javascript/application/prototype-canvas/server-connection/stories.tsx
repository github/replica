import type { Meta, StoryObj } from "@storybook/react-vite"
import { waitFor, within } from "storybook/test"

import { useHubTheme } from "@hooks/use-hub-theme"
import { renderMissingPrototypeHtml } from "../../../../../../.github/extensions/replica-prototype/render-missing-prototype-html/index.mjs"
import { installFixture } from "./install-fixture"

function ServerConnection({ scenario }: { scenario: string }) {
  const { resolvedColorMode } = useHubTheme()
  const html = renderMissingPrototypeHtml("storybook-fixture")
    .replace('<html lang="en">', `<html lang="en" style="color-scheme: ${resolvedColorMode}">`)
    .replace(
      '<script nonce="storybook-fixture">',
      `<script>(${installFixture.toString()})(${JSON.stringify(scenario)})</script><script nonce="storybook-fixture">`,
    )
  return (
    <iframe
      key={`${scenario}/${resolvedColorMode}`}
      title="Connect a prototype server"
      sandbox="allow-scripts allow-same-origin"
      srcDoc={html}
      style={{ border: 0, width: "100%", height: "100vh", display: "block" }}
    />
  )
}

const meta = {
  title: "Components/Prototype canvas/Server connection",
  component: ServerConnection,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Uses the extension's real server-connection document with in-memory responses. Scanning, connecting and starting never inspect or run repository processes.",
      },
    },
  },
  args: { scenario: "single" },
  argTypes: {
    scenario: {
      control: "select",
      options: [
        "scanning",
        "empty",
        "single",
        "multiple",
        "script",
        "scripts",
        "starting",
        "start-failed",
        "connecting",
        "connect-failed",
        "scan-failed",
        "status-failed",
        "warnings",
        "startup-unavailable",
      ],
    },
  },
} satisfies Meta<typeof ServerConnection>

export default meta
type Story = StoryObj<typeof meta>

export const Scanning: Story = { args: { scenario: "scanning" } }
export const NoServers: Story = { args: { scenario: "empty" } }
export const SingleServer: Story = {}
export const MultipleServers: Story = { args: { scenario: "multiple" } }
export const StartAvailable: Story = { args: { scenario: "script" } }
export const ScriptSelection: Story = { args: { scenario: "scripts" } }
export const ScanFailed: Story = { args: { scenario: "scan-failed" } }
export const StatusFailed: Story = { args: { scenario: "status-failed" } }
export const DiscoveryWarnings: Story = { args: { scenario: "warnings" } }
export const StartupUnavailable: Story = { args: { scenario: "startup-unavailable" } }
export const Connecting: Story = {
  args: { scenario: "connecting" },
  play: async ({ canvasElement, userEvent }) => {
    const frame = canvasElement.querySelector("iframe")
    await waitFor(() => {
      if (!frame?.contentDocument?.querySelector("#servers button"))
        throw new Error("Waiting for the server choice.")
    })
    if (!frame?.contentDocument?.body) throw new Error("The connection fixture did not load.")
    await userEvent.click(
      within(frame.contentDocument.body).getByRole("button", {
        name: "Connect to http://localhost:5173/",
      }),
    )
  },
}
export const ConnectFailed: Story = {
  ...Connecting,
  args: { scenario: "connect-failed" },
}
export const Starting: Story = {
  args: { scenario: "starting" },
  play: async ({ canvasElement, userEvent }) => {
    const frame = canvasElement.querySelector("iframe")
    await waitFor(() => {
      const start = frame?.contentDocument?.querySelector<HTMLButtonElement>("#start")
      if (!start || start.hidden || start.disabled) throw new Error("Waiting for the start action.")
    })
    if (!frame?.contentDocument?.body) throw new Error("The connection fixture did not load.")
    await userEvent.click(
      within(frame.contentDocument.body).getByRole("button", { name: "Start dev server" }),
    )
  },
}
export const StartFailed: Story = { ...Starting, args: { scenario: "start-failed" } }
