import { ArrowUpIcon, GitBranchIcon, PencilIcon, PlusIcon } from "@primer/octicons-react"
import { useLayoutEffect, useRef } from "react"
import type { ReactNode, Ref, RefObject } from "react"

import "./styles.css"

export type PrototypeBriefComposerProps = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  labelledBy?: string
  submitLabel: string
  variant?: "new" | "branch"
  expanded?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  branchFrom?: string
  addDetails?: string
  templatePicker?: ReactNode
  hasSavedDetails?: boolean
  onAddDetails?: () => void
  addDetailsButtonRef?: Ref<HTMLButtonElement>
  autoFocus?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

/** Presents the brief field and actions without owning the form or its submission. */
export function PrototypeBriefComposer({
  value,
  onChange,
  placeholder,
  label,
  labelledBy,
  submitLabel,
  variant = "new",
  expanded = false,
  onExpand,
  onCollapse,
  branchFrom,
  addDetails,
  templatePicker,
  hasSavedDetails = false,
  onAddDetails,
  addDetailsButtonRef,
  autoFocus = variant === "new",
  inputRef,
}: PrototypeBriefComposerProps) {
  const localField = useRef<HTMLTextAreaElement>(null)
  const field = inputRef ?? localField
  const isExpanded = variant === "new" || expanded

  useLayoutEffect(() => {
    if (!isExpanded) return

    const textarea = field.current
    if (!textarea) return

    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [isExpanded, value, field])

  useLayoutEffect(() => {
    if (variant === "branch" && expanded) field.current?.focus()
  }, [variant, expanded, field])

  return (
    <div
      className={`prototype-brief-composer prototype-brief-composer--${variant}${isExpanded ? " prototype-brief-composer--expanded" : ""}`}
      onBlur={(event) => {
        if (
          variant === "branch" &&
          expanded &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          onCollapse?.()
        }
      }}
      onKeyDown={(event) => {
        if (variant !== "branch" || !expanded || !onCollapse || event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        if (
          document.activeElement instanceof HTMLElement &&
          event.currentTarget.contains(document.activeElement)
        ) {
          document.activeElement.blur()
        } else {
          onCollapse()
        }
      }}
    >
      {variant === "branch" && branchFrom ? (
        <div className="prototype-brief-composer__compact">
          <button
            type="button"
            className="prototype-brief-composer__expand"
            onClick={onExpand}
            aria-label={value || placeholder}
            tabIndex={isExpanded ? -1 : undefined}
          >
            {value || placeholder}
          </button>
          <button
            className="prototype-brief-composer__submit"
            type="submit"
            disabled={isExpanded || !value.trim()}
            aria-label={submitLabel}
            title={submitLabel}
          >
            <ArrowUpIcon size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div
        className="prototype-brief-composer__expanded"
        aria-hidden={!isExpanded}
        inert={!isExpanded}
      >
        <div className="prototype-brief-composer__expanded-inner">
          <textarea
            ref={field}
            autoFocus={autoFocus}
            aria-label={label}
            aria-labelledby={labelledBy}
            className="prototype-brief-composer__brief"
            placeholder={placeholder}
            value={value}
            rows={5}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />

          <div className="prototype-brief-composer__actions">
            <div className="prototype-brief-composer__secondary">
              {templatePicker}
              {variant === "branch" ? (
                <button
                  type="button"
                  className="prototype-brief-composer__branch-source"
                  onClick={() => field.current?.focus()}
                >
                  <GitBranchIcon size={16} aria-hidden="true" />
                  {branchFrom}
                </button>
              ) : null}
              {addDetails && onAddDetails ? (
                <button
                  ref={addDetailsButtonRef}
                  className="prototype-brief-composer__add-details"
                  type="button"
                  onClick={onAddDetails}
                >
                  {hasSavedDetails ? (
                    <PencilIcon size={16} aria-hidden="true" />
                  ) : (
                    <PlusIcon size={16} aria-hidden="true" />
                  )}
                  {addDetails}
                </button>
              ) : null}
            </div>

            <button
              className="prototype-brief-composer__submit"
              type="submit"
              disabled={!value.trim()}
              aria-label={submitLabel}
              title={submitLabel}
            >
              <ArrowUpIcon size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
