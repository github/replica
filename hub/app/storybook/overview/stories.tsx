import { Heading, Stack, Text } from "@primer/react-brand"
import type { Meta, StoryObj } from "@storybook/react-vite"

const meta = {
  title: "Hub/Design/Overview",
  parameters: {
    docs: {
      description: {
        component:
          "Use Storybook to work on Hub's interface with sample data, without connecting to the API.",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Taxonomy: Story = {
  render: () => (
    <Stack gap="spacious" style={{ maxWidth: "48rem" }}>
      <Stack gap="condensed">
        <Heading as="h1" size="3">
          Replica Hub
        </Heading>

        <Text as="p">
          Work on the Hub and prototype canvas interfaces without starting the API.
        </Text>
        <Text as="p">
          Hub UI uses Primer Brand components and tokens, with Hub controls for app-specific needs.
        </Text>
        <Text as="p">
          Browse reusable elements in Components, the local extension in Prototype canvas, and Hub
          design, pages, and features in Hub.
        </Text>
      </Stack>

      {[
        ["Components", "Small interface elements that can be reused across Hub."],
        [
          "Prototype canvas",
          "The local canvas experience, including its panels, dialogs, and controls.",
        ],
        ["Hub / Design", "Hub-wide design overviews and inventories."],
        ["Hub / Pages", "Complete Hub screens shown with sample data."],
        ["Hub / Features", "Groups of components that help someone complete one task."],
      ].map(([title, description]) => (
        <Stack
          key={title}
          gap="condensed"
          padding="spacious"
          style={{
            backgroundColor: "var(--hub-canvas-default)",
            border: "1px solid var(--hub-border-default)",
            borderRadius: "var(--hub-radius-medium)",
          }}
        >
          <Heading as="h2" size="5">
            {title}
          </Heading>

          <Text>{description}</Text>
        </Stack>
      ))}
    </Stack>
  ),
}
