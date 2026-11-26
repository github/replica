import { CheckIcon, CopyIcon } from "@primer/octicons-react"
import { useState } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { prototypeLinkCopy } from "@utils/prototype-share-link/en"

export function CopyBuildLinkButton({ url, buildNumber }: { url: string; buildNumber: number }) {
  const [result, setResult] = useState<{ url: string; status: "copied" | "failed" } | null>(null)
  const status = result?.url === url ? result.status : null
  const label =
    status === "copied"
      ? prototypeLinkCopy.copiedBuild(buildNumber)
      : prototypeLinkCopy.copyBuildNumber(buildNumber)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setResult({ url, status: "copied" })
    } catch {
      setResult({ url, status: "failed" })
    }
  }

  return (
    <>
      <HubIconButton
        icon={status === "copied" ? CheckIcon : CopyIcon}
        aria-label={label}
        description={label}
        variant="invisible"
        size="small"
        onClick={() => void copy()}
      />
      <HubVisuallyHidden aria-live="polite">{status === "copied" ? label : ""}</HubVisuallyHidden>
      {status === "failed" ? (
        <span role="alert">
          {prototypeLinkCopy.menuCopyError} <a href={url}>{prototypeLinkCopy.build(buildNumber)}</a>
        </span>
      ) : null}
    </>
  )
}
