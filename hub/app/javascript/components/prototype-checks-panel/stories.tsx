import type { Meta, StoryObj } from "@storybook/react-vite"

import { ChecksPanel } from "./index"
import type { ChecksState } from "@utils/prototype-checks/types"

const state: ChecksState = {
  state: "ready",
  checks: [
    {
      id: "lint",
      name: "Lint",
      runner: "command",
      automatic: true,
      status: "completed",
      outcome: "pass",
      summary: "No lint diagnostics.",
      error: null,
      criteria: [],
      findings: [],
    },
    {
      id: "design-review",
      name: "Design-system review",
      runner: "agent",
      status: "running",
      outcome: null,
      summary: null,
      error: null,
      automatic: false,
      criteria: [],
      findings: [],
    },
  ],
}
const meta = {
  title: "Canvas/Prototype checks",
  component: ChecksPanel,
  args: {
    state,
    error: null,
    busy: false,
    onAction: () => Promise.resolve(true),
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: "40rem", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChecksPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Running: Story = {}
export const Passed: Story = {
  args: {
    state: {
      ...state,
      checks: [
        {
          ...state.checks[0]!,
          id: "code-quality",
          name: "Code-quality source review",
          runner: "agent",
          outcome: "pass",
          summary: "Source-visible code-quality expectations passed.",
          readCoverage: {
            version: 1,
            files: [
              {
                file: "src/settings.tsx",
                required: true,
                status: "read",
                readBytes: 50989,
                totalBytes: 50989,
              },
            ],
          },
          criteria: [
            {
              id: "typing",
              name: "Type safety and lint patterns",
              status: "pass",
              evidence: "- External responses are validated before use in src/settings.tsx.",
            },
            {
              id: "react",
              name: "React hooks and state",
              status: "pass",
              evidence: "- Polling timers are cleaned up when the Settings page unmounts.",
            },
            {
              id: "async",
              name: "Errors and async behavior",
              status: "pass",
              evidence: "- Failed saves surface a visible error instead of reporting success.",
            },
          ],
        },
      ],
    },
  },
}
export const Unconfigured: Story = {
  args: { state: { ...state, state: "unconfigured", checks: [] } },
}
export const IncompleteReadCoverage: Story = {
  args: {
    state: {
      ...state,
      checks: [
        {
          ...state.checks[1]!,
          status: "completed",
          outcome: "unverified",
          summary: "Source review is incomplete.",
          criteria: [
            {
              id: "react",
              name: "React hooks and state",
              status: "unverified",
              coverageReason: "incomplete",
              evidence: "- Full review of the remaining Settings source is still needed.",
            },
          ],
          readCoverage: {
            version: 1,
            files: [
              {
                file: "src/settings.tsx",
                required: true,
                status: "partial",
                reason: "partial_read",
                readBytes: 4096,
                totalBytes: 50989,
              },
              {
                file: "src/use-settings.ts",
                required: true,
                status: "unread",
                reason: "not_read",
                readBytes: 0,
                totalBytes: 2048,
              },
              {
                file: "src/image.png",
                required: false,
                status: "blocked",
                reason: "binary",
                readBytes: 0,
                totalBytes: 1024,
              },
            ],
          },
        },
      ],
    },
  },
}
export const Findings: Story = {
  args: {
    state: {
      ...state,
      checks: [
        {
          id: "design-review",
          runner: "agent",
          automatic: false,
          status: "completed",
          error: null,
          name: "Design-system review",
          outcome: "fail",
          summary: "Use the approved button component.",
          runId: "example",
          criteria: [
            {
              id: "usage",
              name: "Supported component usage",
              status: "fail",
              evidence: "The save button uses a custom element.",
            },
          ],
          findings: [
            {
              id: "button",
              severity: "error",
              criterionId: "usage",
              title: "Use the approved button",
              description: "Replace this custom button with the design-system component.",
              evidence: "The Settings page renders a custom button.",
              file: "src/settings.tsx",
              line: 24,
            },
          ],
        },
      ],
    },
  },
}
