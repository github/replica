import type { ShareLinksIndexPageData } from "@pages/share-links-index-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { ProductSharingResponse } from "../../product-contracts"
import { prototypeWorkspace } from "../prototype-workspace"
import { resourcePath } from "../resource-path"

export function productShareLinksData(
  workspace: WorkspaceResponse,
  response: ProductSharingResponse,
  search: URLSearchParams,
  origin: string,
): ShareLinksIndexPageData {
  const { resource } = response
  const { repository, prototype, selectedBuild } = resource
  const base = `/repositories/${repository.id}/prototypes/${prototype.id}`
  const selected =
    selectedBuild?.state === "successful" && selectedBuild.previewUrl ? selectedBuild : null
  const now = Date.now()
  const active = response.links.filter(
    (link) => response.enabled && !link.revokedAt && Date.parse(link.expiresAt) > now,
  )
  return {
    ...prototypeWorkspace({
      workspace,
      ...resource,
      selectedBuild: selected,
      search,
      surface: "build",
    }),
    newPrototypePath: resourcePath(`/repositories/${repository.id}/new`, search),
    buildOptions: prototype.builds
      .filter((build) => build.state === "successful" && build.previewUrl)
      .map((build) => ({
        number: build.number,
        label: `v${build.number}`,
        path: resourcePath(`${base}/share-links`, search, { build: build.number }),
        state: build.state,
        stateLabel: "Successful",
      })),
    closePath: resourcePath(base, search, { build: selected?.number ?? null }),
    closeLabel: "Return to prototype",
    alert: null,
    notice: null,
    copyErrorLabel: "Could not copy the link.",
    copiedLabel: "Copied",
    copyLabel: "Copy link",
    deleteLabel: "Revoke link",
    openLabel: "Open local preview",
    description:
      "Create a synthetic link to one fixed successful Build. Links work only inside this local mock session, not on another browser or device.",
    emptyHeading: "No active local share links",
    emptyLabel: "Create a local link to explore signed-out preview behavior.",
    form: {
      buildLabel: selected ? `Build ${selected.number}` : null,
      createPath: resourcePath(`${base}/share-links`, search),
      expirationLabel: "Expires after",
      expirationOptions: [
        { label: "1 day", value: "one_day" },
        { label: "7 days", value: "seven_days" },
      ],
      labelLabel: "Label",
      labelMaximumBytes: 100,
      labelPlaceholder: "Usability review",
      submitLabel: "Create mock share link",
    },
    heading: "Share links",
    noBuildHeading: "No successful Build selected",
    noBuildLabel: "Choose a successful Build with a preview before creating a link.",
    pageTitle: `${prototype.name} share links`,
    shareLinksLabel: "Share links",
    shareLinksPath: resourcePath(`${base}/share-links`, search, {
      build: selected?.number ?? null,
    }),
    managementBuildNumber: selected?.number,
    publicSharingEnabled: response.enabled,
    disabledLabel:
      "Public sharing is disabled in this mock Hub. Only a mock Hub administrator can enable new links.",
    canManage: response.canManage,
    openInNewTab: false,
    readOnlyLabel: "This mock profile can view links but cannot create or revoke them.",
    shareLinks: active.map((link) => ({
      id: link.id,
      label: link.label,
      buildLabel: `Build ${link.buildNumber}`,
      createdAt: link.createdAt,
      createdLabel: `Created by @${link.createdBy}`,
      expiresAt: link.expiresAt,
      expiresLabel: `Expires ${new Date(link.expiresAt).toLocaleDateString()}`,
      url: new URL(`/shared/${link.shareId}`, origin).href,
      deletePath: resourcePath(`${base}/share-links/${link.shareId}`, search),
      deletePrompt: `Revoke the local link “${link.label}”?`,
    })),
    inactiveShareLinks: response.links
      .filter((link) => !active.some((entry) => entry.id === link.id))
      .map((link) => ({
        id: link.id,
        label: link.label,
        stateLabel: link.revokedAt ? "Revoked" : !response.enabled ? "Sharing disabled" : "Expired",
        url: new URL(`/shared/${link.shareId}`, origin).href,
      })),
  }
}
