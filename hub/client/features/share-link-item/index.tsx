import { TrashIcon } from "@primer/octicons-react"
import { Button } from "@primer/react-brand"

import { HubIconButton } from "@components/hub-icon-button"
import { ShareLinkRow } from "@features/share-link-row"
import type { ShareLinkItemProps } from "./types"

/** Shows one active share link and owns its browser actions. */
export function ShareLinkItem({
  authenticityToken,
  shareLink,
  copiedLabel,
  copyErrorLabel,
  copyLabel,
  deleteLabel,
  openLabel,
  controlQuery = "",
  managementBuildNumber,
  canDelete = true,
  openInNewTab = true,
  busy = false,
}: ShareLinkItemProps) {
  return (
    <ShareLinkRow
      shareLink={shareLink}
      copiedLabel={copiedLabel}
      copyErrorLabel={copyErrorLabel}
      copyLabel={copyLabel}
    >
      <Button
        as="a"
        href={shareLink.url}
        target={openInNewTab ? "_blank" : undefined}
        rel="noreferrer"
        variant="secondary"
      >
        {openLabel}
      </Button>

      {canDelete ? (
        <form
          action={shareLink.deletePath}
          method="post"
          onSubmit={(event) => {
            if (!window.confirm(shareLink.deletePrompt)) event.preventDefault()
          }}
        >
          <input type="hidden" name="_method" value="delete" />
          <input type="hidden" name="authenticity_token" value={authenticityToken} />
          <input type="hidden" name="control_query" value={controlQuery} />
          {managementBuildNumber ? (
            <input type="hidden" name="management_build" value={managementBuildNumber} />
          ) : null}
          <HubIconButton
            type="submit"
            icon={TrashIcon}
            aria-label={deleteLabel}
            title={deleteLabel}
            variant="danger"
            disabled={busy}
          />
        </form>
      ) : null}
    </ShareLinkRow>
  )
}
