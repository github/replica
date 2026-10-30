import { useEffect, useState } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { Button, Heading } from "@primer/react-brand"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent, within } from "storybook/test"

import { HubNavigation } from "."

function NavigationStory({ loading = false }: { loading?: boolean }) {
  const [router] = useState(() =>
    createMemoryRouter([
      {
        path: "/",
        element: (
          <HubNavigation>
            <main style={{ padding: "2rem" }}>
              <Heading as="h1" size="4">
                Example workspace
              </Heading>
              {loading ? (
                <a href="/loading">Load another page</a>
              ) : (
                <form method="post" action="/session">
                  <Button type="submit" variant="secondary">
                    Try disconnected action
                  </Button>
                </form>
              )}
            </main>
          </HubNavigation>
        ),
      },
      {
        path: "/loading",
        loader: ({ request }) =>
          new Promise<null>((resolve) => {
            request.signal.addEventListener("abort", () => resolve(null), { once: true })
          }),
        element: <main>Another page</main>,
      },
    ]),
  )
  useEffect(() => () => router.dispose(), [router])
  return <RouterProvider router={router} />
}

const meta = {
  title: "Hub/Features/Application Navigation",
  component: HubNavigation,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HubNavigation>

export default meta
type Story = StoryObj<typeof meta>

export const DisconnectedAction: Story = {
  render: () => <NavigationStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Try disconnected action" }),
    )
    await within(canvasElement).findByRole("alert")
  },
}

export const PendingNavigation: Story = {
  render: () => <NavigationStory loading />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("link", { name: "Load another page" }))
    await within(canvasElement).findByRole("status", { name: "Page loading" })
  },
}
