import { useRef, useState } from "react"
import { PlusIcon } from "@primer/octicons-react"
import {
  Button,
  Checkbox,
  FormControl,
  Heading,
  Label,
  Select,
  Text,
  TextInput,
} from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { RepositoryWorkspace } from "@features/repository-workspace"

import { CustomFields } from "./custom-fields"
import type { AnalyticsPageData, AnalyticsProvider } from "./types"
import "./styles.css"

/** Keeps each destination editable without ever receiving its saved credentials. */
export function AnalyticsPage({ data }: { data: AnalyticsPageData }) {
  const [adding, setAdding] = useState(false)
  const [newProvider, setNewProvider] = useState<AnalyticsProvider>("segment")
  const addButton = useRef<HTMLButtonElement>(null)
  const copy = data.copy
  const available: AnalyticsProvider[] = [
    ...(["segment", "mixpanel"] as const).filter(
      (value) => !data.destinations.some((destination) => destination.provider === value),
    ),
    "custom",
  ]

  return (
    <RepositoryWorkspace data={data}>
      <div className="analytics-page">
        <header className="repository-page-header analytics-page__header">
          <Heading as="h1" size="6">
            {copy.heading}
          </Heading>
        </header>

        <div className="analytics-page__content">
          <Text as="p" className="analytics-page__description">
            {copy.description}
          </Text>
          <Text as="p" className="analytics-page__privacy">
            {copy.privacy}
          </Text>
          {data.alert ? <HubAlert title={data.alert} variant="critical" /> : null}
          {data.notice ? <HubAlert title={data.notice} variant="success" /> : null}
          <div className="analytics-page__section-header">
            <Heading as="h2" size="5">
              {copy.destinations}
            </Heading>
            <Button
              ref={addButton}
              type="button"
              variant="secondary"
              leadingVisual={<PlusIcon size={16} aria-hidden="true" />}
              aria-expanded={adding}
              onClick={() => {
                if (!adding) {
                  setNewProvider(available[0] ?? "custom")
                  setAdding(true)
                }
              }}
            >
              {copy.add}
            </Button>
          </div>
          {!data.destinations.length ? <Text as="p">{copy.empty}</Text> : null}

          {[...(adding ? [null] : []), ...data.destinations].map((destination) => {
            const provider = destination?.provider ?? newProvider
            const prefix = `analytics-${destination?.id ?? "new"}`
            const formId = `${prefix}-configuration`

            return (
              <section
                key={destination?.id ?? "new"}
                className="analytics-page__card"
                aria-label={
                  destination?.provider === "custom"
                    ? `${copy.custom}: ${destination.name}`
                    : destination
                      ? copy[provider]
                      : copy.add
                }
              >
                <Heading as="h3" size="6">
                  {destination?.provider === "custom"
                    ? `${copy.custom}: ${destination.name}`
                    : destination
                      ? copy[provider]
                      : copy.add}
                </Heading>
                {destination ? (
                  <Label className="analytics-page__status">
                    {!destination.enabled
                      ? copy.paused
                      : destination.deliveryFailed
                        ? copy.failed
                        : copy.configured}
                  </Label>
                ) : null}
                {destination?.deliveryFailed ? (
                  <HubAlert
                    title={copy.failureHelp}
                    description={
                      destination.provider === "custom" ? destination.failureDetail : undefined
                    }
                    variant="critical"
                  />
                ) : null}

                <form
                  id={formId}
                  action={destination?.path ?? data.createPath}
                  method="post"
                  className="analytics-page__form"
                >
                  <input type="hidden" name="authenticity_token" value={data.authenticityToken} />
                  {destination ? <input type="hidden" name="_method" value="patch" /> : null}
                  {destination ? (
                    <input type="hidden" name="destination[provider]" value={provider} />
                  ) : null}
                  <FormControl id={`${prefix}-provider`} required>
                    <FormControl.Label>{copy.provider}</FormControl.Label>
                    <Select
                      aria-label={copy.provider}
                      name="destination[provider]"
                      value={provider}
                      disabled={!!destination}
                      onChange={(event) => setNewProvider(event.target.value as AnalyticsProvider)}
                    >
                      {(destination ? [destination.provider] : available).map((value) => (
                        <Select.Option key={value} value={value}>
                          {copy[value]}
                        </Select.Option>
                      ))}
                    </Select>
                  </FormControl>
                  {provider === "custom" ? (
                    <CustomFields
                      key={destination?.id ?? "new-custom"}
                      destination={destination?.provider === "custom" ? destination : undefined}
                      prefix={prefix}
                      copy={copy}
                      authenticationHeaders={data.authenticationHeaders}
                    />
                  ) : (
                    <>
                      <FormControl id={`${prefix}-region`} required>
                        <FormControl.Label>{copy.region}</FormControl.Label>
                        <Select
                          aria-label={copy.region}
                          key={provider}
                          name="destination[region]"
                          defaultValue={destination?.region ?? "us"}
                        >
                          <Select.Option value="us">{copy.us}</Select.Option>
                          <Select.Option value="eu">{copy.eu}</Select.Option>
                          {provider === "mixpanel" ? (
                            <Select.Option value="in">{copy.in}</Select.Option>
                          ) : null}
                        </Select>
                      </FormControl>
                      {destination ? <Text as="p">{copy.rotation}</Text> : null}
                      {provider === "mixpanel" ? <Text as="p">{copy.mixpanelHelp}</Text> : null}
                      {(provider === "segment"
                        ? [{ key: "write_key", label: copy.writeKey }]
                        : [
                            { key: "service_account_username", label: copy.serviceAccountUsername },
                            { key: "service_account_secret", label: copy.serviceAccountSecret },
                            { key: "project_id", label: copy.projectId },
                          ]
                      ).map(({ key, label }) => (
                        <FormControl
                          key={key}
                          id={`${prefix}-${key}`}
                          required={!destination}
                          fullWidth
                        >
                          <FormControl.Label>{label}</FormControl.Label>
                          <TextInput
                            aria-label={label}
                            type="password"
                            autoComplete="new-password"
                            name={`destination[credentials][${key}]`}
                            maxLength={1024}
                            required={!destination}
                          />
                        </FormControl>
                      ))}
                    </>
                  )}
                  <fieldset className="analytics-page__events">
                    <legend>{copy.eventTypes}</legend>
                    <input type="hidden" name="destination[event_types][]" value="" />
                    {data.eventTypes.map((event) => (
                      <FormControl key={event.value} id={`${prefix}-event-${event.value}`}>
                        <Checkbox
                          name="destination[event_types][]"
                          value={event.value}
                          defaultChecked={
                            !destination || destination.eventTypes.includes(event.value)
                          }
                        />
                        <FormControl.Label>{event.label}</FormControl.Label>
                      </FormControl>
                    ))}
                  </fieldset>
                  {!destination ? (
                    <>
                      <FormControl id={`${prefix}-history`} required>
                        <FormControl.Label>{copy.history}</FormControl.Label>
                        <Select
                          aria-label={copy.history}
                          name="destination[history]"
                          defaultValue="new"
                        >
                          <Select.Option value="new">{copy.newEvents}</Select.Option>
                          <Select.Option value="retained">{copy.retainedEvents}</Select.Option>
                        </Select>
                      </FormControl>
                      <Text as="p">{copy.historyWarning}</Text>
                    </>
                  ) : null}
                </form>

                <div className="analytics-page__actions">
                  <Button type="submit" form={formId} variant="primary">
                    {copy.save}
                  </Button>
                  {destination ? (
                    <>
                      <form action={destination.path} method="post">
                        <input
                          type="hidden"
                          name="authenticity_token"
                          value={data.authenticityToken}
                        />
                        <input type="hidden" name="_method" value="patch" />
                        <input
                          type="hidden"
                          name="operation"
                          value={destination.enabled ? "pause" : "resume"}
                        />
                        <Button type="submit" variant="secondary">
                          {destination.enabled ? copy.pause : copy.resume}
                        </Button>
                      </form>
                      <form action={destination.path} method="post">
                        <input
                          type="hidden"
                          name="authenticity_token"
                          value={data.authenticityToken}
                        />
                        <input type="hidden" name="_method" value="delete" />
                        <Button
                          type="submit"
                          variant="primary"
                          className="analytics-page__disconnect"
                        >
                          {copy.disconnect}
                        </Button>
                      </form>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setAdding(false)
                        addButton.current?.focus()
                      }}
                    >
                      {copy.cancel}
                    </Button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </RepositoryWorkspace>
  )
}
