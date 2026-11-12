import { FilterIcon, SearchIcon } from "@primer/octicons-react"
import { ActionMenu } from "@primer/react-brand"
import { useState } from "react"
import type { KeyboardEvent } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { HubSwitch } from "@components/hub-switch"

import type { ReviewCommentFilterControlsProps } from "./types"

import "./styles.css"

function selectParticipantOnKeyDown(event: KeyboardEvent<HTMLLIElement>) {
  if (event.key !== " " && event.key !== "Enter") return

  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.click()
}

export function ReviewCommentFilterControls({
  compact = false,
  filters,
  participants,
  showPins,
  copy,
  onFiltersChange,
  onShowPinsChange,
}: ReviewCommentFilterControlsProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterControlsActive =
    filters.currentBuildOnly ||
    filters.currentPageOnly ||
    filters.showResolved ||
    !filters.showRead ||
    filters.onlyMine ||
    filters.participant !== null ||
    !showPins
  const selectedParticipant = participants.find(
    (participant) => participant.login === filters.participant,
  )
  const selectedParticipantLabel =
    filters.participant === null
      ? copy.allParticipantsLabel
      : selectedParticipant?.name
        ? `${selectedParticipant.name} (@${selectedParticipant.login})`
        : `@${filters.participant}`

  return (
    <div
      className={`review-comment-filter-controls${compact ? " review-comment-filter-controls--compact" : ""}`}
    >
      <div className="review-comment-filter-controls__search">
        <div className="review-comment-filter-controls__search-field">
          {!compact ? (
            <SearchIcon
              className="review-comment-filter-controls__search-icon"
              size={16}
              aria-hidden="true"
            />
          ) : null}
          <input
            type="search"
            className="review-comment-filter-controls__input"
            aria-label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
            value={filters.search}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          />
        </div>

        <HubIconButton
          icon={FilterIcon}
          aria-label={copy.filterLabel}
          description={copy.filterLabel}
          aria-expanded={filtersOpen}
          variant={compact ? "default" : "invisible"}
          className={`review-comment-filter-controls__button${filtersOpen || filterControlsActive ? " review-comment-filter-controls__button--active" : ""}`}
          onClick={() => setFiltersOpen((open) => !open)}
        />
      </div>

      {filtersOpen ? (
        <div className="review-comment-filter-controls__filters">
          <div className="review-comment-filter-controls__participant">
            <span>{copy.participantFilterLabel}</span>

            <ActionMenu
              size="small"
              selectionVariant="single"
              menuAlignment="end"
              onSelect={(login) =>
                onFiltersChange({ ...filters, participant: login === "" ? null : login })
              }
            >
              <ActionMenu.Button
                className="review-comment-filter-controls__participant-trigger"
                variant="secondary"
                size="small"
                aria-label={`${copy.participantFilterLabel}: ${selectedParticipantLabel}`}
              >
                <span className="review-comment-filter-controls__participant-name">
                  {selectedParticipantLabel}
                </span>
              </ActionMenu.Button>
              <ActionMenu.Overlay aria-label={copy.participantFilterLabel}>
                <ActionMenu.Item
                  value=""
                  selected={filters.participant === null}
                  role="menuitemradio"
                  onKeyDownCapture={selectParticipantOnKeyDown}
                >
                  {copy.allParticipantsLabel}
                </ActionMenu.Item>

                {participants.map((participant) => (
                  <ActionMenu.Item
                    key={participant.login}
                    value={participant.login}
                    selected={filters.participant === participant.login}
                    role="menuitemradio"
                    onKeyDownCapture={selectParticipantOnKeyDown}
                  >
                    {participant.name
                      ? `${participant.name} (@${participant.login})`
                      : `@${participant.login}`}
                  </ActionMenu.Item>
                ))}
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>

          <div className="review-comment-filter-controls__toggle">
            <span id="review-comments-current-build">{copy.currentBuildFilterLabel}</span>

            <HubSwitch
              aria-labelledby="review-comments-current-build"
              checked={filters.currentBuildOnly}
              size="small"
              onChange={(checked) => onFiltersChange({ ...filters, currentBuildOnly: checked })}
            />
          </div>

          <div className="review-comment-filter-controls__toggle">
            <span id="review-comments-current-page">{copy.currentPageFilterLabel}</span>

            <HubSwitch
              aria-labelledby="review-comments-current-page"
              checked={filters.currentPageOnly}
              size="small"
              onChange={(checked) => onFiltersChange({ ...filters, currentPageOnly: checked })}
            />
          </div>

          <div className="review-comment-filter-controls__toggle">
            <span id="review-comments-show-resolved">{copy.showResolvedLabel}</span>

            <HubSwitch
              aria-labelledby="review-comments-show-resolved"
              checked={filters.showResolved}
              size="small"
              onChange={(checked) => onFiltersChange({ ...filters, showResolved: checked })}
            />
          </div>

          <div className="review-comment-filter-controls__toggle">
            <span id="review-comments-unread-only">{copy.unreadOnlyLabel}</span>

            <HubSwitch
              aria-labelledby="review-comments-unread-only"
              checked={!filters.showRead}
              size="small"
              onChange={(checked) => onFiltersChange({ ...filters, showRead: !checked })}
            />
          </div>

          <div className="review-comment-filter-controls__toggle">
            <span id="review-comments-only-mine">{copy.onlyMineLabel}</span>

            <HubSwitch
              aria-labelledby="review-comments-only-mine"
              checked={filters.onlyMine}
              size="small"
              onChange={(checked) => onFiltersChange({ ...filters, onlyMine: checked })}
            />
          </div>

          <div className="review-comment-filter-controls__toggle">
            <span id="review-comments-show-pins">{copy.showPinsLabel}</span>

            <HubSwitch
              aria-labelledby="review-comments-show-pins"
              checked={showPins}
              size="small"
              onChange={onShowPinsChange}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
