import type { Meta, StoryObj } from "@storybook/react-vite"

import { ShareLinksForm } from "."

const meta = {
  title: "Hub/Features/Share Links/Form",
  component: ShareLinksForm,
  args: {
    data: {
      buildLabel: "Build 1",
      labelLabel: "Label",
      labelPlaceholder: "For example, usability review",
      labelMaximumBytes: 100,
      expirationLabel: "Expires after",
      expirationOptions: [
        { value: "one_day", label: "One day" },
        { value: "seven_days", label: "Seven days" },
        { value: "thirty_days", label: "Thirty days" },
        { value: "never", label: "Never" },
      ],
      submitLabel: "Create share link",
    },
    onSubmit: (event) => event.preventDefault(),
  },
} satisfies Meta<typeof ShareLinksForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Busy: Story = { args: { busy: true, disabled: true, fieldsDisabled: true } }
export const Invalid: Story = {
  args: {
    error: "Enter a label containing no more than 100 UTF-8 bytes.",
  },
}
