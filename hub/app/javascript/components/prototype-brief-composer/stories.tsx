import { useState } from "react"

import type { Meta, StoryObj } from "@storybook/react-vite"

import { PrototypeBriefComposer } from "."

const meta = {
  title: "Components/Prototype Brief Composer",
  component: PrototypeBriefComposer,
  args: {
    value: "",
    onChange: () => undefined,
    placeholder: "What changes would you like to make?",
    label: "What changes would you like to make?",
    submitLabel: "Create branch",
    variant: "branch",
    expanded: false,
    onExpand: () => undefined,
    onCollapse: () => undefined,
    branchFrom: "Branch from: Welcome",
    addDetails: "Add details",
    onAddDetails: () => undefined,
  },
  decorators: [
    (Story) => (
      <form
        onSubmit={(event) => event.preventDefault()}
        style={{ maxWidth: "46rem", margin: "2rem auto" }}
      >
        <Story />
      </form>
    ),
  ],
} satisfies Meta<typeof PrototypeBriefComposer>

export default meta
type Story = StoryObj<typeof meta>

export const Compact: Story = {
  render: function CompactStory(args) {
    const [value, setValue] = useState(args.value)
    const [expanded, setExpanded] = useState(false)

    return (
      <PrototypeBriefComposer
        {...args}
        value={value}
        onChange={setValue}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
      />
    )
  },
}

export const Expanded: Story = {
  args: { value: "Make the navigation easier to scan on small screens." },
  render: function ExpandedStory(args) {
    const [value, setValue] = useState(args.value)
    const [expanded, setExpanded] = useState(true)

    return (
      <PrototypeBriefComposer
        {...args}
        value={value}
        onChange={setValue}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
        onCollapse={() => setExpanded(false)}
      />
    )
  },
}

export const SavedDetails: Story = {
  args: {
    variant: "new",
    value: "A simpler way to compare two prototype builds side by side.",
    placeholder: "Describe the prototype you want to create...",
    label: "What should we create?",
    submitLabel: "Create prototype",
    addDetails: "Edit details",
    hasSavedDetails: true,
  },
}
