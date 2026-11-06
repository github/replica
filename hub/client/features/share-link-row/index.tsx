import { CopyableTextInput } from "@components/copyable-text-input"
import type { ShareLinkRowProps } from "./types"

import "./styles.css"

export function ShareLinkRow({
  shareLink,
  className,
  copiedLabel,
  copyErrorLabel,
  copyLabel,
  urlLabel,
  unavailableLabel,
  highlighted,
  children,
}: ShareLinkRowProps) {
  return (
    <li
      data-share-id={shareLink.id}
      className={`share-link-item${highlighted ? " share-link-item--created" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="share-link-item__layout">
        <div className="share-link-item__details">
          <h3>{shareLink.label}</h3>

          <span className="share-link-item__metadata">
            {shareLink.buildLabel}
            {shareLink.createdLabel ? (
              <>
                {" · "}
                <time dateTime={shareLink.createdAt}>{shareLink.createdLabel}</time>
              </>
            ) : null}
            {" · "}
            {shareLink.expiresAt ? (
              <time dateTime={shareLink.expiresAt}>{shareLink.expiresLabel}</time>
            ) : (
              shareLink.expiresLabel
            )}
          </span>
        </div>

        <div className="share-link-item__actions">
          {unavailableLabel ? (
            <p>{unavailableLabel}</p>
          ) : (
            <CopyableTextInput
              value={shareLink.url}
              label={urlLabel || shareLink.label}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              copyErrorLabel={copyErrorLabel}
            />
          )}

          {children}
        </div>
      </div>
    </li>
  )
}
