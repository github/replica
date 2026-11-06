import { useEffect, useMemo } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { createMemoryRouter, RouterProvider } from "react-router"

import MockToolbar from "."

const meta = {
  title: "Hub/Features/Frontend test controls",
  component: MockToolbar,
  parameters: { layout: "fullscreen" },
  render: function ToolbarStory() {
    const router = useMemo(() => createMemoryRouter([{ path: "*", element: <MockToolbar /> }]), [])
    useEffect(() => () => router.dispose(), [router])
    return <RouterProvider router={router} />
  },
} satisfies Meta<typeof MockToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const Controls: Story = {}
