import type { Meta, StoryObj } from "@storybook/react-vite"

import { SharedBuildsShowPage } from "."

const previewUrl = `data:text/html,${encodeURIComponent(`
  <!doctype html>
  <html>
    <body style="margin:0;font-family:system-ui;background:#f6f8fa">
      <main style="padding:4rem">
        <h1>Welcome to the prototype</h1>
        <p>Shared from github/prototype by The Octocat.</p>
      </main>
    </body>
  </html>
`)}`

const meta = {
  title: "Hub/Pages/Shared Build",
  component: SharedBuildsShowPage,
  args: {
    data: {
      frameTitle: "Partner review shared prototype",
      label: "Partner review",
      pageTitle: "Partner review · Shared prototype",
      previewUrl,
      productName: "Replica Hub",
    },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SharedBuildsShowPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: "Full viewport" }
