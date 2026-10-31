import { ActionMenu } from "@primer/react-brand/esm"

import type { PrototypeAuthorResults, PrototypeListing } from "@utils/prototype-listing/types"

import { PrototypeAuthorOptions } from "./options"

import "./styles.css"

/** Offers a searchable, single-selection menu of saved registration authors. */
export function PrototypeAuthorFilter({
  listing,
  onChange,
  onSearch,
}: {
  listing: PrototypeListing
  onChange: (author: string) => void
  onSearch: (
    query: string,
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<PrototypeAuthorResults>
}) {
  const label = `${listing.copy.author}: ${listing.authorLabel}`

  return (
    <div className="prototype-author-filter">
      <ActionMenu size="small" selectionVariant="single" menuAlignment="start" onSelect={onChange}>
        <ActionMenu.Button aria-label={label} variant="secondary">
          <span className="prototype-author-filter__label" title={label}>
            {label}
          </span>
        </ActionMenu.Button>
        <ActionMenu.Overlay aria-label={listing.copy.author}>
          <PrototypeAuthorOptions listing={listing} onSearch={onSearch} />
        </ActionMenu.Overlay>
      </ActionMenu>
    </div>
  )
}
