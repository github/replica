import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { ComponentProps, Ref } from "react"
import { createPortal } from "react-dom"

import { useMentionSource } from "@hooks/use-mention-source"
import type { MentionCandidate } from "@hooks/use-mention-source/context"
import type { MentionSource } from "@hooks/use-mention-source/context"
import { getMentionLogins } from "@utils/get-mention-logins"

import "./styles.css"

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
}

export function MentionInput({ value, onValueChange, onKeyDown, ref, ...props }: Props) {
  const source = useMentionSource()
  const input = useRef<HTMLTextAreaElement | null>(null)
  const popup = useRef<HTMLDivElement | null>(null)
  const retryButton = useRef<HTMLButtonElement | null>(null)
  const listId = useId()
  const [caret, setCaret] = useState(value.length)
  const [dismissed, setDismissed] = useState(false)
  const [result, setResult] = useState<{
    source: MentionSource
    candidates: MentionCandidate[]
    failed: boolean
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 })
  const match = value.slice(0, caret).match(/(?:^|[\s(])@([a-zA-Z0-9-]*)$/)
  const query = match?.[1]?.toLowerCase()
  const open = source !== null && query !== undefined && !dismissed && !props.disabled
  const tooMany = getMentionLogins(value).length > 10
  const failed = result?.source === source && result?.failed
  const waiting = loading || result?.source !== source
  const suggestions = (result?.source === source ? result.candidates : [])
    .filter((candidate) => candidate.login.toLowerCase().includes(query ?? ""))
    .slice(0, 8)
  const activeIndex = Math.min(selected, Math.max(0, suggestions.length - 1))

  useEffect(() => {
    input.current?.setCustomValidity(tooMany ? (source?.copy.limit ?? "") : "")
  }, [source?.copy.limit, tooMany])

  useEffect(() => {
    if (!open || !source) return

    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      void source
        .load()
        .then(
          (people) => {
            if (active) setResult({ source, candidates: people, failed: false })
          },
          () => {
            if (active) setResult({ source, candidates: [], failed: true })
          },
        )
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 150)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, retry, source])

  useLayoutEffect(() => {
    if (!open) return

    function reposition() {
      const bounds = input.current?.getBoundingClientRect()
      if (!bounds) return

      setPosition({
        left: bounds.left,
        width: bounds.width,
        top: Math.max(
          4,
          window.innerHeight - bounds.bottom < 224 ? bounds.top - 224 : bounds.bottom,
        ),
      })
    }
    reposition()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [open])

  function choose(candidate: MentionCandidate) {
    if (query === undefined) return

    const start = caret - query.length - 1
    const token = `@${candidate.login} `
    onValueChange(value.slice(0, start) + token + value.slice(caret))
    setDismissed(true)
    const position = start + token.length
    window.requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(position, position)
      setCaret(position)
    })
  }

  function setInput(
    element: HTMLTextAreaElement | null,
    forwarded: Ref<HTMLTextAreaElement> | undefined,
  ) {
    input.current = element
    if (typeof forwarded === "function") forwarded(element)
    else if (forwarded) forwarded.current = element
  }

  return (
    <div className="mention-input">
      <textarea
        {...props}
        ref={(element) => setInput(element, ref)}
        value={value}
        aria-autocomplete={source ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions.length ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          setCaret(event.currentTarget.selectionStart)
          setDismissed(false)
          setSelected(0)
          onValueChange(event.currentTarget.value)
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={(event) => {
          if (!popup.current?.contains(event.relatedTarget)) setDismissed(true)
        }}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            setDismissed(true)
            return
          }
          if (open && failed && !waiting && event.key === "Tab" && !event.shiftKey) {
            event.preventDefault()
            retryButton.current?.focus()
            return
          }
          if (open && !waiting && !failed && suggestions.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              setSelected(
                (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                  suggestions.length,
              )
              return
            }
            if (
              (event.key === "Enter" || event.key === "Tab") &&
              !event.nativeEvent.isComposing &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey
            ) {
              event.preventDefault()
              const candidate = suggestions[activeIndex]
              if (candidate) choose(candidate)
              return
            }
          }
          onKeyDown?.(event)
        }}
      />
      {tooMany && source?.copy.limit ? <span role="alert">{source.copy.limit}</span> : null}
      {open && source
        ? createPortal(
            <div
              ref={popup}
              id={listId}
              className="mention-input__suggestions"
              style={position}
              onBlur={(event) => {
                if (
                  event.relatedTarget !== input.current &&
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setDismissed(true)
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  event.stopPropagation()
                  setDismissed(true)
                  input.current?.focus()
                } else if (event.key === "Tab" && event.shiftKey) {
                  event.preventDefault()
                  input.current?.focus()
                }
              }}
            >
              {waiting ? (
                <span role="status">{source.copy.loading}</span>
              ) : failed ? (
                <div role="alert">
                  {source.copy.error}{" "}
                  <button
                    ref={retryButton}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setRetry(retry + 1)
                      input.current?.focus()
                    }}
                  >
                    {source.copy.retry}
                  </button>
                </div>
              ) : (
                <ul role="listbox" aria-label={source.copy.suggestions}>
                  {suggestions.map((candidate, index) => (
                    <li
                      key={candidate.githubId}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(candidate)}
                      >
                        @{candidate.login}
                      </button>
                    </li>
                  ))}
                  {!suggestions.length ? <li role="presentation">{source.copy.empty}</li> : null}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
