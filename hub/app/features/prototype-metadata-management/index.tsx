import { useEffect, useId, useRef, useState } from "react"
import type { MouseEvent } from "react"

import { XIcon } from "@primer/octicons-react"
import { Button, FormControl, Heading, Pagination, Text, TextInput } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { HubSpinner } from "@components/hub-spinner"

import type { PrototypeMetadataEntry, PrototypeMetadataManagementData } from "./types"

import "./styles.css"

/** Opens one branch's details in a dialog without changing Build or gallery state. */
export function PrototypeMetadataManagement({
  authenticityToken,
  data,
  loading = false,
  loadFailed = false,
  onRetry,
}: {
  authenticityToken: string
  data: PrototypeMetadataManagementData
  loading?: boolean
  loadFailed?: boolean
  onRetry?: () => void
}) {
  const [selected, setSelected] = useState<{
    entry: PrototypeMetadataEntry
    registered: boolean
  } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const unlistedHeadingId = useId()
  const registeredHeadingId = useId()

  useEffect(() => {
    if (!selected) return

    if (!dialog.current?.open) dialog.current?.showModal()
    dialog.current?.querySelector<HTMLInputElement>('input[name="prototype[name]"]')?.focus()
  }, [selected])

  function open(
    entry: PrototypeMetadataEntry,
    registered: boolean,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    trigger.current = event.currentTarget
    setSelected({ entry, registered })
  }

  return (
    <section className="prototype-metadata">
      <div className="prototype-metadata__intro">
        <Heading as="h2" size="5">
          {data.heading}
        </Heading>
      </div>

      <section
        className="prototype-metadata__section"
        aria-labelledby={unlistedHeadingId}
        aria-busy={loading}
      >
        <Heading as="h3" size="6" id={unlistedHeadingId}>
          {data.unlistedHeading}
        </Heading>
        {loading ? (
          <div className="prototype-metadata__loading" role="status">
            <HubSpinner decorative size="small" />
            <Text>{data.candidateLoadingLabel}</Text>
          </div>
        ) : loadFailed || data.candidateCheckFailed ? (
          <>
            <HubAlert title={data.candidateCheckFailedLabel} variant="warning" layout="compact" />
            {onRetry ? (
              <Button type="button" variant="secondary" size="small" onClick={onRetry}>
                {data.candidateRetryLabel}
              </Button>
            ) : null}
          </>
        ) : data.unlisted.length ? (
          <>
            <Text as="p">{data.unlistedDescription}</Text>
            <ul className="prototype-metadata__list">
              {data.unlisted.map((entry) => (
                <li className="prototype-metadata__branch" key={entry.id}>
                  <span>{entry.branchName}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    aria-label={`${data.addLabel}: ${entry.branchName}`}
                    onClick={(event: MouseEvent<HTMLButtonElement>) => open(entry, false, event)}
                  >
                    {data.addLabel}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Text as="p">{data.emptyLabel}</Text>
        )}

        {!loading && !loadFailed && !data.candidateCheckFailed && data.candidatePageCount > 1 ? (
          <Pagination
            pageCount={data.candidatePageCount}
            currentPage={data.candidatePage}
            aria-label={data.paginationLabel}
            hrefBuilder={(page) =>
              page === 1 ? data.candidatePagePath : `${data.candidatePagePath}?page=${page}`
            }
            labels={{
              prev: data.previousPageLabel,
              prevAriaLabel: data.previousPageAriaLabel,
              next: data.nextPageLabel,
              nextAriaLabel: data.nextPageAriaLabel,
            }}
          />
        ) : null}
      </section>

      <section className="prototype-metadata__section" aria-labelledby={registeredHeadingId}>
        <Heading as="h3" size="6" id={registeredHeadingId}>
          {data.registeredHeading}
        </Heading>
        {data.registered.length ? (
          <ul className="prototype-metadata__list">
            {data.registered.map((entry) => (
              <li className="prototype-metadata__branch" key={entry.id}>
                <span>
                  {entry.name}
                  <small>{entry.branchName}</small>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  aria-label={`${data.editLabel}: ${entry.branchName}`}
                  onClick={(event: MouseEvent<HTMLButtonElement>) => open(entry, true, event)}
                >
                  {data.editLabel}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Text as="p">{data.registeredEmptyLabel}</Text>
        )}
      </section>

      <dialog
        ref={dialog}
        className="prototype-metadata__dialog"
        aria-labelledby={headingId}
        onClose={() => {
          setSelected(null)
          trigger.current?.focus()
        }}
      >
        {selected ? (
          <>
            <div className="prototype-metadata__dialog-header">
              <Heading as="h2" size="6" id={headingId}>
                {selected.registered ? data.editDialogHeading : data.addDialogHeading}
              </Heading>
              <HubIconButton
                icon={XIcon}
                type="button"
                variant="invisible"
                size="small"
                aria-label={data.closeDialogLabel}
                onClick={() => dialog.current?.close()}
              />
            </div>
            <Text as="p">{selected.entry.branchName}</Text>
            {selected.entry.startPageImportError ? (
              <HubAlert
                title={selected.entry.startPageImportError}
                variant="warning"
                layout="compact"
              />
            ) : null}

            <form
              key={selected.entry.id}
              action={selected.entry.path}
              method="post"
              className="prototype-metadata__form"
            >
              <input type="hidden" name="_method" value="patch" />
              <input type="hidden" name="authenticity_token" value={authenticityToken} />

              <FormControl id={`prototype-name-${selected.entry.id}`} fullWidth required>
                <FormControl.Label>{data.nameLabel}</FormControl.Label>
                <TextInput
                  name="prototype[name]"
                  defaultValue={selected.entry.name}
                  maxLength={data.nameMaximumLength}
                />
              </FormControl>

              <FormControl id={`prototype-description-${selected.entry.id}`} fullWidth>
                <FormControl.Label>{data.descriptionLabel}</FormControl.Label>
                <TextInput
                  name="prototype[description]"
                  defaultValue={selected.entry.description ?? ""}
                  maxLength={data.descriptionMaximumLength}
                />
              </FormControl>

              <FormControl id={`prototype-start-page-${selected.entry.id}`} fullWidth>
                <FormControl.Label>{data.startPageLabel}</FormControl.Label>
                <TextInput
                  name="prototype[start_page]"
                  defaultValue={selected.entry.startPage ?? ""}
                  placeholder="/"
                />
                <FormControl.Hint>{data.startPageHint}</FormControl.Hint>
              </FormControl>

              <div className="prototype-metadata__dialog-actions">
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => dialog.current?.close()}
                >
                  {data.cancelLabel}
                </Button>
                <Button type="submit" variant="primary" size="small">
                  {selected.registered ? data.saveLabel : data.addLabel}
                </Button>
              </div>
            </form>
          </>
        ) : null}
      </dialog>
    </section>
  )
}
