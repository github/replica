import { useEffect, useId, useRef, useState } from "react"

import { Button, Checkbox, FormControl, Heading, Text, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { useScrollFade } from "@hooks/use-scroll-fade"

import type {
  AddHubAdministratorsData,
  HubAdministratorCandidate,
  HubAdministratorSearchResults,
} from "./types"
import "./styles.css"

export function AddHubAdministrators({
  data,
  authenticityToken,
  onSearch,
  onClose,
}: {
  data: AddHubAdministratorsData
  authenticityToken: string
  onSearch: (query: string) => Promise<HubAdministratorSearchResults>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const body = useScrollFade<HTMLDivElement>()
  const resultList = useScrollFade<HTMLDivElement>()
  const headingId = useId()
  const descriptionId = useId()
  const searchId = useId()
  const [query, setQuery] = useState("")
  const [retry, setRetry] = useState(0)
  const [results, setResults] = useState<HubAdministratorSearchResults | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<HubAdministratorCandidate[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const visibleUsers = [
    ...selected.filter((user) => !results?.users.some((entry) => entry.id === user.id)),
    ...(results?.users ?? []),
  ]

  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
  }, [])

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      onSearch(query).then(
        (value) => {
          if (active) setResults(value)
        },
        () => {
          if (active) setError(true)
        },
      )
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [onSearch, query, retry])

  function toggle(user: HubAdministratorCandidate) {
    setSelected((current) =>
      current.some((entry) => entry.id === user.id)
        ? current.filter((entry) => entry.id !== user.id)
        : [...current, user],
    )
    setConfirmed(false)
  }

  return (
    <dialog
      ref={dialog}
      className="add-hub-administrators"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onClose={onClose}
      onCancel={(event) => {
        if (submitting) event.preventDefault()
      }}
    >
      <div ref={body} className="add-hub-administrators__body">
        <div className="add-hub-administrators__content">
          <Heading as="h2" size="6" id={headingId}>
            {data.heading}
          </Heading>
          <Text as="p" id={descriptionId}>
            {data.description}
          </Text>

          <FormControl id={searchId} fullWidth>
            <FormControl.Label>{data.searchLabel}</FormControl.Label>
            <TextInput
              type="search"
              placeholder={data.searchPlaceholder}
              value={query}
              maxLength={100}
              disabled={submitting}
              onChange={(event) => {
                setQuery(event.target.value)
                setResults(null)
                setError(false)
              }}
            />
          </FormControl>

          <div
            ref={resultList}
            className="add-hub-administrators__results"
            aria-busy={!results && !error}
          >
            <div>
              {error ? (
                <>
                  <HubAlert variant="warning" title={data.searchFailedLabel} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setError(false)
                      setResults(null)
                      setRetry((value) => value + 1)
                    }}
                  >
                    {data.retryLabel}
                  </Button>
                </>
              ) : !results ? (
                <Text as="p" role="status">
                  {data.loadingLabel}
                </Text>
              ) : !results.users.length ? (
                <Text as="p" role="status">
                  {data.emptyLabel}
                </Text>
              ) : null}
              {visibleUsers.length ? (
                <ul className="add-hub-administrators__users">
                  {visibleUsers.map((user) => {
                    const checked = selected.some((entry) => entry.id === user.id)
                    return (
                      <li key={user.id}>
                        <label className="add-hub-administrators__user">
                          <Checkbox
                            aria-label={`${user.name ?? user.login} @${user.login}`}
                            checked={checked}
                            disabled={submitting || (!checked && selected.length >= 50)}
                            onChange={() => toggle(user)}
                          />
                          <span className="add-hub-administrators__identity">
                            <strong>{user.name ?? user.login}</strong>
                            <Text as="span" size="100">
                              @{user.login}
                            </Text>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {results?.more ? <Text as="p">{data.moreLabel}</Text> : null}
            </div>
          </div>

          <form
            action={data.submitPath}
            method="post"
            onSubmit={(event) => {
              if (!selected.length || !confirmed || submitting) {
                event.preventDefault()
                return
              }
              setSubmitting(true)
            }}
          >
            <input type="hidden" name="authenticity_token" value={authenticityToken} />
            <input type="hidden" name="confirmed" value={confirmed ? "1" : "0"} />
            {selected.map((user) => (
              <input key={user.id} type="hidden" name="user_ids[]" value={user.id} />
            ))}
            {selected.length ? (
              <label className="add-hub-administrators__confirmation">
                <Checkbox
                  checked={confirmed}
                  required
                  disabled={submitting}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>{data.confirmLabel}</span>
              </label>
            ) : null}
            <div className="add-hub-administrators__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={() => dialog.current?.close()}
              >
                {data.cancelLabel}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!selected.length || !confirmed || submitting}
              >
                {data.submitLabel}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </dialog>
  )
}
