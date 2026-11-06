import { Checkbox, FormControl } from "@primer/react-brand"
import { useId } from "react"

import { HubAlert } from "@components/hub-alert"

import { shareCopy } from "@hooks/use-canvas-share-links/en"

import "./styles.css"

export function ShareControlSettings({
  included,
  onChange,
  publishedVersionDiffers,
  disabled = false,
  error,
  copy,
}: {
  included: boolean
  onChange: (included: boolean) => void
  publishedVersionDiffers: boolean
  disabled?: boolean
  error?: string
  copy?: { label: string; description: string }
}) {
  const id = useId()
  const showWarning = included && publishedVersionDiffers

  return (
    <div className="share-control-settings">
      <FormControl id={id} fullWidth>
        <Checkbox
          checked={included}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <FormControl.Label>{copy?.label ?? shareCopy.includeControlSettings}</FormControl.Label>
        <FormControl.Hint className="share-control-settings__hint">
          <span className="share-control-settings__description">
            {copy?.description ?? shareCopy.controlSettingsDescription}
          </span>
        </FormControl.Hint>
      </FormControl>
      {error ? <HubAlert title={error} variant="critical" layout="compact" /> : null}
      {showWarning ? (
        <HubAlert
          title={shareCopy.controlSettingsWarningTitle}
          description={shareCopy.controlSettingsWarning}
          variant="warning"
          layout="compact"
          className="share-control-settings__warning"
        />
      ) : null}
    </div>
  )
}
