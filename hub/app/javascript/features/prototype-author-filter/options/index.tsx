import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent } from "react"

import { ActionMenu, Button, TextInput } from "@primer/react-brand/esm"

import { HubSpinner } from "@components/hub-spinner"
import type { PrototypeAuthorResults, PrototypeListing } from "@utils/prototype-listing/types"

/** Loads author choices only while the menu is mounted and cancels stale searches. */
export function PrototypeAuthorOptions({
  listing,
  onSearch,
  handler,
}: {
  listing: PrototypeListing
  onSearch: (
    query: string,
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<PrototypeAuthorResults>
  handler?: (author: string) => void
}) {
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState<string | null>(null)
  const [results, setResults] = useState<PrototypeAuthorResults | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const copy = listing.copy

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      onSearch(query, cursor, controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) setResults(value)
        },
        () => {
          if (!controller.signal.aborted) setFailed(true)
        },
      )
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, cursor, retry, onSearch])

  function selectOnKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.key !== " " && event.key !== "Enter") return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.click()
  }

  const choiceProps = { handler, type: "single" as const, onKeyDownCapture: selectOnKeyDown }

  return (
    <>
      <li
        role="presentation"
        tabIndex={-1}
        className="prototype-author-filter__search"
        onFocus={(event) => {
          if (event.target === event.currentTarget) input.current?.focus()
        }}
      >
        <TextInput
          ref={input}
          fullWidth
          type="search"
          aria-label={copy.searchAuthors}
          placeholder={copy.searchAuthors}
          value={query}
          maxLength={200}
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation()
            if (event.key === "ArrowDown") {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget
                .closest('[role="menu"]')
                ?.querySelector<HTMLElement>('[role="menuitemradio"]')
                ?.focus()
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(null)
            setResults(null)
            setFailed(false)
          }}
        />
      </li>

      <ActionMenu.Item {...choiceProps} value="me" selected={listing.author === "me"}>
        {copy.me}
      </ActionMenu.Item>
      <ActionMenu.Item {...choiceProps} value="" selected={!listing.author}>
        {copy.allAuthors}
      </ActionMenu.Item>

      {failed ? (
        <li role="presentation" className="prototype-author-filter__status">
          <div role="alert">
            <p>{copy.authorsFailed}</p>
            <Button
              size="small"
              variant="subtle"
              onClick={() => {
                setFailed(false)
                setRetry((value) => value + 1)
                input.current?.focus()
              }}
            >
              {copy.retry}
            </Button>
          </div>
        </li>
      ) : !results ? (
        <li role="presentation">
          <div role="status" className="prototype-author-filter__loading">
            <HubSpinner decorative size="small" />
            <span>{copy.loading}</span>
          </div>
        </li>
      ) : !results.authors.length && query.trim() ? (
        <li role="presentation" className="prototype-author-filter__status">
          <p role="status">{copy.noAuthors}</p>
        </li>
      ) : (
        results.authors.map((author) => (
          <ActionMenu.Item
            {...choiceProps}
            key={author.id}
            value={author.id}
            selected={listing.author === author.id}
          >
            <span
              className="prototype-author-filter__label"
              title={`@${author.login}${author.name ? ` (${author.name})` : ""}`}
            >
              @{author.login}
              {author.name ? ` (${author.name})` : ""}
            </span>
          </ActionMenu.Item>
        ))
      )}

      {results?.nextCursor || cursor ? (
        <li role="presentation" className="prototype-author-filter__paging">
          {results?.nextCursor ? (
            <Button
              variant="subtle"
              size="small"
              onClick={() => {
                setCursor(results.nextCursor)
                setResults(null)
                input.current?.focus()
              }}
            >
              {copy.moreAuthors}
            </Button>
          ) : null}
          {cursor ? (
            <Button
              variant="subtle"
              size="small"
              onClick={() => {
                setCursor(null)
                setResults(null)
                setFailed(false)
                input.current?.focus()
              }}
            >
              {copy.firstAuthors}
            </Button>
          ) : null}
        </li>
      ) : null}
    </>
  )
}
