import { LinkIcon } from "@primer/octicons-react"
import { Button, FormControl, Heading, Select, TextInput } from "@primer/react-brand"
import { useId } from "react"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import type { ShareLinksFormProps } from "./types"

import "./styles.css"

export function ShareLinksForm({
  data,
  action,
  hiddenFields,
  details,
  afterFields,
  onSubmit,
  label,
  onLabelChange,
  expiration,
  onExpirationChange,
  disabled,
  fieldsDisabled,
  busy,
  error,
}: ShareLinksFormProps) {
  const labelId = useId()
  const expirationId = useId()

  return (
    <div className="share-links-form">
      {data.buildLabel ? (
        <Heading as="h2" size="5">
          {data.buildLabel}
        </Heading>
      ) : null}
      {details}

      <form
        action={action}
        method="post"
        onSubmit={onSubmit}
        aria-busy={busy}
        className="share-links__form"
      >
        {hiddenFields}

        <div className="share-links__form-row">
          <FormControl id={labelId} required fullWidth className="share-links__field">
            <FormControl.Label>{data.labelLabel}</FormControl.Label>
            <TextInput
              aria-label={data.labelLabel}
              aria-invalid={Boolean(error)}
              name="share_link[label]"
              placeholder={data.labelPlaceholder}
              maxLength={data.labelMaximumBytes}
              value={label}
              onChange={onLabelChange}
              disabled={fieldsDisabled}
              fullWidth
            />
            {error ? (
              <FormControl.Validation validationStatus="error" className="share-links__validation">
                {error}
              </FormControl.Validation>
            ) : null}
          </FormControl>
          {error ? <HubVisuallyHidden role="alert">{error}</HubVisuallyHidden> : null}

          <FormControl id={expirationId} fullWidth className="share-links__field">
            <FormControl.Label>{data.expirationLabel}</FormControl.Label>
            <Select
              aria-label={data.expirationLabel}
              name="share_link[expiration]"
              defaultValue={
                expiration === undefined
                  ? (data.expirationOptions.find((option) => option.value === "seven_days")
                      ?.value ?? data.expirationOptions[0]?.value)
                  : undefined
              }
              value={expiration}
              onChange={onExpirationChange}
              disabled={fieldsDisabled}
              fullWidth
            >
              {data.expirationOptions.map((option) => (
                <Select.Option key={option.value} value={option.value}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          </FormControl>

          <div className="share-links__form-actions">
            <Button type="submit" variant="primary" leadingVisual={LinkIcon} disabled={disabled}>
              {data.submitLabel}
            </Button>
          </div>
        </div>
        {afterFields ? <div className="share-links__form-options">{afterFields}</div> : null}
      </form>
    </div>
  )
}
