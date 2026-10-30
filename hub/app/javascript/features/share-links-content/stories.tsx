import { Button } from "@primer/react-brand/esm"
import type { Meta, StoryObj } from "@storybook/react-vite"

import { PrototypeWorkspaceBody } from "@features/prototype-workspace-body"
import { PrototypeWorkspaceHeaderLayout } from "@features/prototype-workspace-header-layout"
import { ShareLinksForm } from "@features/share-links-form"
import { ShareLinkRow } from "@features/share-link-row"
import { ShareLinksContent } from "."

const meta = {
  title: "Hub/Features/Share Links/Content",
  component: ShareLinksContent,
  parameters: { layout: "fullscreen" },
  args: {
    labels: {
      heading: "Share links",
      description: "Share one fixed successful Build without exposing private review data.",
      noBuildHeading: "No successful Build",
      noBuildLabel: "A successful Build is required before creating a share link.",
      emptyHeading: "No active share links",
      emptyLabel: "Create a link when someone needs signed-out access.",
    },
    form: (
      <ShareLinksForm
        data={{
          buildLabel: "Build 1",
          labelLabel: "Label",
          labelMaximumBytes: 100,
          labelPlaceholder: "Usability review",
          expirationLabel: "Expires after",
          expirationOptions: [
            { value: "one_day", label: "1 day" },
            { value: "seven_days", label: "7 days" },
            { value: "thirty_days", label: "30 days" },
            { value: "never", label: "Never" },
          ],
          submitLabel: "Create share link",
        }}
        onSubmit={(event) => event.preventDefault()}
      />
    ),
    hasLinks: false,
    links: null,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--brand-color-canvas-subtle)",
          containerType: "inline-size",
        }}
      >
        <PrototypeWorkspaceHeaderLayout title="prototype/welcome">
          <Button variant="secondary" size="small">
            Close
          </Button>
        </PrototypeWorkspaceHeaderLayout>
        <PrototypeWorkspaceBody>
          <Story />
        </PrototypeWorkspaceBody>
      </div>
    ),
  ],
} satisfies Meta<typeof ShareLinksContent>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const NoBuild: Story = { args: { form: null } }
export const Multiple: Story = {
  args: {
    hasLinks: true,
    links: ["Usability review", "Partner review"].map((label, index) => (
      <ShareLinkRow
        key={label}
        shareLink={{
          id: index + 1,
          label,
          url: "https://replica.example/share/12345678-1234-1234-1234-123456789abc",
          buildLabel: "Build 1",
          createdAt: "2026-10-05T07:00:00Z",
          createdLabel: "Created by @octocat",
          expiresAt: null,
          expiresLabel: "Never expires",
        }}
        copyLabel="Copy link"
        copiedLabel="Copied"
        copyErrorLabel="Copy failed"
      >
        <Button variant="secondary">Open</Button>
      </ShareLinkRow>
    )),
  },
}
