import { BrowserIcon, CheckIcon, ChevronDownIcon } from "@primer/octicons-react"
import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent } from "react"

import { useOptionalHubTheme } from "@hooks/use-hub-theme"

import type { StartingTemplate } from "./types"
import "./styles.css"

export function TemplatePicker({
  templates,
  selectedId,
  onChange,
  label,
  unavailableLabel,
}: {
  templates: StartingTemplate[]
  selectedId: string
  onChange: (id: string) => void
  label: string
  unavailableLabel: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [failedScreenshots, setFailedScreenshots] = useState<string[]>([])
  const selected = templates.find((template) => template.id === selectedId)
  const theme = useOptionalHubTheme()

  useEffect(() => {
    if (!open) return

    options.current[activeIndex]?.focus()
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return

    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [open])

  function showOptions() {
    if (open) {
      options.current[activeIndex]?.focus()
      return
    }

    setActiveIndex(
      Math.max(
        0,
        templates.findIndex((template) => template.id === selectedId),
      ),
    )
    setOpen(true)
  }

  function closeOptions() {
    setOpen(false)
    trigger.current?.focus()
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeOptions()
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault()
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? templates.length - 1
            : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + templates.length) %
              templates.length
      setActiveIndex(next)
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const next = templates.findIndex((_, offset) =>
        templates[(activeIndex + offset + 1) % templates.length]?.name
          .toLowerCase()
          .startsWith(event.key.toLowerCase()),
      )
      if (next !== -1) {
        event.preventDefault()
        setActiveIndex((activeIndex + next + 1) % templates.length)
      }
    }
  }

  return (
    <div
      ref={root}
      className="template-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="template-picker__trigger"
        aria-label={`${label}: ${selected?.name ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeOptions() : showOptions())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            showOptions()
          } else if (event.key === "Escape" && open) {
            event.preventDefault()
            event.stopPropagation()
            closeOptions()
          }
        }}
      >
        <BrowserIcon size={16} aria-hidden="true" />
        <span>
          {label}: {selected?.name}
        </span>
        <ChevronDownIcon size={16} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="template-picker__menu"
          onKeyDown={handleKeys}
        >
          {templates.map((template, index) => {
            const screenshotSrc =
              theme?.resolvedColorMode === "dark" && template.darkScreenshotSrc
                ? template.darkScreenshotSrc
                : template.screenshotSrc
            return (
              <button
                key={template.id}
                ref={(element) => {
                  options.current[index] = element
                }}
                type="button"
                role="option"
                aria-label={`${template.name} ${template.route}`}
                aria-selected={template.id === selectedId}
                tabIndex={index === activeIndex ? 0 : -1}
                className="template-picker__option"
                onFocus={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(template.id)
                  closeOptions()
                }}
              >
                <span className="template-picker__preview">
                  {screenshotSrc && !failedScreenshots.includes(screenshotSrc) ? (
                    <img
                      src={screenshotSrc}
                      alt=""
                      onError={() => {
                        setFailedScreenshots((previous) => [...previous, screenshotSrc])
                      }}
                    />
                  ) : (
                    <span role="img" aria-label={unavailableLabel}>
                      <BrowserIcon size={24} aria-hidden="true" />
                    </span>
                  )}
                </span>
                <span className="template-picker__text">
                  <span className="template-picker__name">{template.name}</span>
                  <span className="template-picker__route">{template.route}</span>
                </span>
                {template.id === selectedId ? <CheckIcon size={16} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
