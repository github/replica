import { useState } from "react"
import { Button, Checkbox, FormControl, Text, TextInput, Textarea } from "@primer/react-brand"

import { previewCustomBody } from "../preview"
import type { AnalyticsDestination, AnalyticsPageData } from "../types"

const defaultTemplate = JSON.stringify(
  {
    event: { $field: "event_name" },
    event_id: { $field: "event_id" },
    properties: { $field: "properties" },
  },
  null,
  2,
)

/** Keeps each destination's draft and redacted sample separate from its saved secrets. */
export function CustomFields({
  destination,
  prefix,
  copy,
  authenticationHeaders,
}: {
  destination?: Extract<AnalyticsDestination, { provider: "custom" }>
  prefix: string
  copy: AnalyticsPageData["copy"]
  authenticationHeaders: AnalyticsPageData["authenticationHeaders"]
}) {
  const config = destination?.customConfig
  const [name, setName] = useState(destination?.name ?? "")
  const [endpoint, setEndpoint] = useState(config?.endpoint ?? "")
  const [headers, setHeaders] = useState(JSON.stringify(config?.headers ?? {}, null, 2))
  const [template, setTemplate] = useState(
    config ? JSON.stringify(config.template, null, 2) : defaultTemplate,
  )
  const [pointer, setPointer] = useState(config?.success_pointer ?? "")
  const [successValue, setSuccessValue] = useState(
    config?.success_pointer ? JSON.stringify(config.success_value) : "",
  )
  const [secrets, setSecrets] = useState(
    config?.secret_names.map((secretName, id) => ({ id, name: secretName, value: "" })) ?? [],
  )
  const [keepPending, setKeepPending] = useState(false)
  const preview = previewCustomBody(
    template,
    secrets.map((secret) => secret.value),
  )

  let headersChanged = false
  let authHeadersOnly = false
  let unchangedTemplate = false
  if (config) {
    try {
      unchangedTemplate = JSON.stringify(JSON.parse(template)) === JSON.stringify(config.template)
      const parsed = JSON.parse(headers) as Record<string, unknown>
      const saved = config.headers
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        headersChanged =
          Object.keys(parsed).sort().join("\0") !== Object.keys(saved).sort().join("\0") ||
          Object.keys(saved).some(
            (key) => JSON.stringify(parsed[key]) !== JSON.stringify(saved[key]),
          )
        authHeadersOnly =
          Object.keys(parsed).sort().join("\0") === Object.keys(saved).sort().join("\0") &&
          Object.keys(saved).every(
            (key) =>
              JSON.stringify(parsed[key]) === JSON.stringify(saved[key]) ||
              authenticationHeaders.includes(key.toLowerCase()),
          )
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  const secretNamesChanged =
    !!config &&
    secrets
      .map((secret) => secret.name)
      .sort()
      .join("\0") !== [...config.secret_names].sort().join("\0")
  const authenticationChanged =
    headersChanged || secretNamesChanged || secrets.some((secret) => secret.value.trim())
  const canKeepPending =
    !!config &&
    endpoint === config.endpoint &&
    unchangedTemplate &&
    pointer === config.success_pointer &&
    (pointer ? successValue === JSON.stringify(config.success_value) : true) &&
    authHeadersOnly &&
    authenticationChanged

  return (
    <>
      <FormControl id={`${prefix}-name`} required fullWidth>
        <FormControl.Label>{copy.customName}</FormControl.Label>
        <TextInput
          aria-label={copy.customName}
          name="destination[name]"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={64}
          required
        />
      </FormControl>
      <FormControl id={`${prefix}-endpoint`} required fullWidth>
        <FormControl.Label>{copy.customEndpoint}</FormControl.Label>
        <TextInput
          aria-label={copy.customEndpoint}
          type="url"
          name="destination[endpoint]"
          value={endpoint}
          onChange={(event) => {
            setEndpoint(event.target.value)
            setKeepPending(false)
          }}
          placeholder={copy.customEndpointExample}
          maxLength={2048}
          required
        />
      </FormControl>
      <Text as="p">{copy.customEndpointHelp}</Text>
      <FormControl id={`${prefix}-headers`} required fullWidth>
        <FormControl.Label>{copy.customHeaders}</FormControl.Label>
        <Textarea
          aria-label={copy.customHeaders}
          name="destination[headers]"
          monospace
          value={headers}
          onChange={(event) => {
            setHeaders(event.target.value)
            setKeepPending(false)
          }}
          maxLength={8192}
          rows={4}
          required
        />
      </FormControl>
      <Text as="p" className="analytics-page__hint">
        {copy.customHeadersExample}
      </Text>
      {config ? (
        <Text as="p" className="analytics-page__hint">
          {copy.customHeaderRetention}
        </Text>
      ) : null}
      <FormControl id={`${prefix}-template`} required fullWidth>
        <FormControl.Label>{copy.customTemplate}</FormControl.Label>
        <Textarea
          aria-label={copy.customTemplate}
          name="destination[template]"
          monospace
          value={template}
          onChange={(event) => {
            setTemplate(event.target.value)
            setKeepPending(false)
          }}
          placeholder={copy.customTemplateExample}
          maxLength={16384}
          rows={8}
          required
        />
      </FormControl>
      <div className="analytics-page__preview">
        <Text as="p">{copy.customPreview}</Text>
        <Text as="p">{copy.customPreviewHelp}</Text>
        <pre aria-label={copy.customPreview}>{preview ?? copy.customPreviewInvalid}</pre>
      </div>
      <fieldset className="analytics-page__events">
        <legend>{copy.customSecrets}</legend>
        {secrets.map((secret, index) => (
          <div className="analytics-page__secret" key={secret.id}>
            <FormControl id={`${prefix}-secret-${secret.id}-name`} required fullWidth>
              <FormControl.Label>{copy.customSecretName}</FormControl.Label>
              <TextInput
                aria-label={copy.customSecretName}
                name={`destination[secrets][${index}][name]`}
                value={secret.name}
                onChange={(event) =>
                  setSecrets((rows) =>
                    rows.map((row) =>
                      row.id === secret.id ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
                maxLength={32}
                required
              />
            </FormControl>
            <FormControl
              id={`${prefix}-secret-${secret.id}-value`}
              required={!config || !config.secret_names.includes(secret.name)}
              fullWidth
            >
              <FormControl.Label>{copy.customSecretValue}</FormControl.Label>
              <TextInput
                aria-label={copy.customSecretValue}
                type="password"
                autoComplete="new-password"
                name={`destination[secrets][${index}][value]`}
                value={secret.value}
                onChange={(event) =>
                  setSecrets((rows) =>
                    rows.map((row) =>
                      row.id === secret.id ? { ...row, value: event.target.value } : row,
                    ),
                  )
                }
                maxLength={1024}
                required={!config || !config.secret_names.includes(secret.name)}
              />
            </FormControl>
            <Button
              type="button"
              variant="secondary"
              aria-label={`${copy.cancel} ${copy.customSecretName} ${secret.name}`}
              onClick={() => setSecrets((rows) => rows.filter((row) => row.id !== secret.id))}
            >
              {copy.cancel}
            </Button>
          </div>
        ))}
        {secrets.length < 8 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setSecrets((rows) => [
                ...rows,
                { id: Math.max(-1, ...rows.map((row) => row.id)) + 1, name: "", value: "" },
              ])
            }
          >
            {copy.customAddSecret}
          </Button>
        ) : null}
      </fieldset>
      {config ? <Text as="p">{copy.rotation}</Text> : null}
      <FormControl id={`${prefix}-success-pointer`} fullWidth>
        <FormControl.Label>{copy.customSuccessPointer}</FormControl.Label>
        <TextInput
          aria-label={copy.customSuccessPointer}
          name="destination[success_pointer]"
          value={pointer}
          onChange={(event) => {
            setPointer(event.target.value)
            setKeepPending(false)
          }}
          maxLength={128}
        />
      </FormControl>
      {pointer ? (
        <FormControl id={`${prefix}-success-value`} required fullWidth>
          <FormControl.Label>{copy.customSuccessValue}</FormControl.Label>
          <TextInput
            aria-label={copy.customSuccessValue}
            name="destination[success_value]"
            value={successValue}
            onChange={(event) => {
              setSuccessValue(event.target.value)
              setKeepPending(false)
            }}
            maxLength={512}
            required
          />
        </FormControl>
      ) : null}
      {config ? (
        <>
          <Text as="p">{copy.customBacklogWarning}</Text>
          {canKeepPending ? (
            <FormControl id={`${prefix}-keep-pending`}>
              <Checkbox
                name="destination[keep_pending]"
                value="1"
                checked={keepPending}
                onChange={(event) => setKeepPending(event.target.checked)}
              />
              <FormControl.Label>{copy.customKeepPending}</FormControl.Label>
            </FormControl>
          ) : null}
        </>
      ) : null}
      <Text as="p">{copy.customRetryWarning}</Text>
    </>
  )
}
