import type { ShareLinksIndexPageData } from "@pages/share-links-index-page/types"

import type { WorkspaceResponse } from "../../contracts/types"
import type { ProductSharingResponse } from "../../product-contracts/types"
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
    copyErrorLabel: "Copy failed",
    copiedLabel: "Copied",
    copyLabel: "Copy link",
    deleteLabel: "Delete link",
    openLabel: "Open",
    description:
      "Anyone with a link can view this Build without signing in. The prototype may expose sensitive or customer information. Check its content before creating a public link.",
    emptyHeading: "No active share links",
    emptyLabel: "Create a link when someone needs signed-out access.",
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
      submitLabel: "Create share link",
    },
    heading: "Share links",
    noBuildHeading: "No successful Build",
    noBuildLabel: "A successful Build is required before creating a share link.",
    pageTitle: `${prototype.name} share links`,
    shareLinksLabel: "Share links",
    shareLinksPath: resourcePath(`${base}/share-links`, search, {
      build: selected?.number ?? null,
    }),
    managementBuildNumber: selected?.number,
    publicSharingEnabled: response.enabled,
    disabledLabel:
      "Public sharing is disabled for this Hub. No public links can be created or opened. A Hub administrator must explicitly enable sharing; previously revoked links never return.",
    canManage: response.canManage,
    openInNewTab: false,
    readOnlyLabel:
      "You can view share links, but you do not have permission to create or delete them.",
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
      deletePrompt: `Delete “${link.label}”?`,
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
