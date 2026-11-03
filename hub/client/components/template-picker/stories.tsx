import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { useState } from "react"

import { templatesData } from "@/storybook/fixtures/templates"

import { TemplatePicker } from "."

const meta = {
  title: "Components/Template Picker",
  component: TemplatePicker,
  args: {
    templates: templatesData.templates.map((template) => ({
      id: template.id,
      name: template.name,
      route: template.id === "default" ? "/" : `/${template.id}`,
      screenshotSrc: template.screenshotSrc,
    })),
    selectedId: "default",
    onChange: fn(),
    label: "Template",
    unavailableLabel: "Preview unavailable",
  },
  render: function Render(args) {
    const [selectedId, setSelectedId] = useState(args.selectedId)
    return (
      <TemplatePicker
        {...args}
        selectedId={selectedId}
        onChange={(id) => {
          setSelectedId(id)
          args.onChange(id)
        }}
      />
    )
  },
} satisfies Meta<typeof TemplatePicker>

export default meta
type Story = StoryObj<typeof meta>

export const Multiple: Story = {}
export const Single: Story = { args: { templates: meta.args.templates.slice(0, 1) } }
export const NoPreview: Story = {
  args: { templates: [{ id: "default", name: "Default", route: "/" }] },
}
