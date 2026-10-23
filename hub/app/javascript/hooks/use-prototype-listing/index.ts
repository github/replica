import { NavigationContext } from "@thoughtbot/superglue"
import { useCallback, useContext, useEffect, useRef, useState } from "react"
import { z } from "zod"

import type { PrototypeAuthorResults, PrototypeListing } from "@utils/prototype-listing/types"

/** Keeps collection navigation in Superglue and author lookups independently cancellable. */
export function usePrototypeListing(listing: PrototypeListing) {
  const { visit } = useContext(NavigationContext)
  const [query, setQuery] = useState(listing.query)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(0)
  const draft = useRef(listing.query)
  const author = useRef(listing.author)
  const source = useRef(listing.path)
  const editing = useRef(false)
  const retry = useRef<{ path: string; replace: boolean; focusResults: boolean } | null>(null)

  const cancelTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => {
    if (source.current === listing.path) return

    source.current = listing.path
    cancelTimer()
    version.current += 1
    editing.current = false
    draft.current = listing.query
    author.current = listing.author
    retry.current = null
    setQuery(listing.query)
    setPending(false)
    setError(false)
  }, [cancelTimer, listing.path, listing.query, listing.author])

  useEffect(() => {
    if (!editing.current) {
      draft.current = listing.query
      setQuery(listing.query)
    }
    author.current = listing.author
  }, [listing.query, listing.author])

  useEffect(() => {
    function restoreHistory() {
      cancelTimer()
      version.current += 1
      editing.current = false
      draft.current = new URLSearchParams(window.location.search).get("q") ?? ""
      author.current = new URLSearchParams(window.location.search).get("author") ?? ""
      setQuery(draft.current)
      setPending(false)
      setError(false)
    }
    window.addEventListener("popstate", restoreHistory)
    return () => {
      window.removeEventListener("popstate", restoreHistory)
      cancelTimer()
      version.current += 1
    }
  }, [cancelTimer, listing.path])

  const navigate = useCallback(
    (path: string, replace = false, focusResults = false) => {
      cancelTimer()
      const currentVersion = ++version.current
      retry.current = { path, replace, focusResults }
      setPending(true)
      setError(false)
      const requestedQuery = new URL(path, window.location.origin).searchParams.get("q") ?? ""
      void visit(path, { dataset: replace ? { sgReplace: "true" } : {} }).then(
        () => {
          if (version.current !== currentVersion) return

          setPending(false)
          if (draft.current.trim() === requestedQuery) {
            editing.current = false
            draft.current = requestedQuery
            setQuery(requestedQuery)
          }
          if (focusResults) {
            window.requestAnimationFrame(() => {
              if (version.current === currentVersion) {
                document.querySelector<HTMLElement>("[data-prototype-results]")?.focus()
              }
            })
          }
        },
        () => {
          if (version.current !== currentVersion) return

          setPending(false)
          setError(true)
        },
      )
    },
    [cancelTimer, visit],
  )

  const applyFilters = useCallback(
    (nextQuery: string, nextAuthor: string, replace = false) => {
      const url = new URL(listing.path, window.location.origin)
      if (nextQuery.trim()) url.searchParams.set("q", nextQuery.trim())
      if (nextAuthor) url.searchParams.set("author", nextAuthor)
      navigate(`${url.pathname}${url.search}`, replace)
    },
    [listing.path, navigate],
  )

  const loadAuthors = useCallback(
    async (
      search: string,
      cursor: string | null,
      signal: AbortSignal,
    ): Promise<PrototypeAuthorResults> => {
      const url = new URL(listing.authorsPath, window.location.origin)
      if (search.trim()) url.searchParams.set("q", search.trim())
      if (cursor) url.searchParams.set("cursor", cursor)
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal,
      })
      if (!response.ok) throw new Error("Prototype author search failed")

      return z
        .object({
          authors: z.array(
            z.object({
              id: z.string(),
              login: z.string(),
              name: z.string().nullable(),
              avatarUrl: z.string().nullable(),
            }),
          ),
          nextCursor: z.string().nullable(),
        })
        .parse(await response.json())
    },
    [listing.authorsPath],
  )

  return {
    query,
    pending,
    error,
    loadAuthors,
    onQueryChange(value: string) {
      cancelTimer()
      editing.current = true
      draft.current = value
      setQuery(value)
      if (!value) {
        applyFilters("", author.current, true)
      } else {
        timer.current = setTimeout(() => applyFilters(value, author.current, true), 300)
      }
    },
    onQuerySubmit() {
      applyFilters(draft.current, author.current)
    },
    onAuthorChange(value: string) {
      author.current = value
      applyFilters(draft.current, value)
    },
    onNavigate(path: string) {
      navigate(path, false, true)
    },
    onRetry() {
      if (retry.current)
        navigate(retry.current.path, retry.current.replace, retry.current.focusResults)
    },
  }
}
