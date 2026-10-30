import { Heading, Stack, Text } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

const meta = {
  title: "Hub/Design/Overview",
  parameters: {
    docs: {
      description: {
        component:
          "Storybook is Replica Hub's presentation workbench. Components, features, and pages use display-ready fixtures without Rails, Superglue, GitHub access, or persisted review data.",
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
          Build and review the Hub and prototype canvas interfaces without running the application.
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
        ["Components", "Small reusable interface elements with no product workflow knowledge."],
        [
          "Prototype canvas",
          "The local canvas experience, including its panels, dialogs, and controls.",
        ],
        ["Hub / Design", "Hub-wide design overviews and inventories."],
        ["Hub / Pages", "Complete Hub surfaces driven by Oaken-based fixtures."],
        ["Hub / Features", "Hub workflow compositions that accept display-ready props."],
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
