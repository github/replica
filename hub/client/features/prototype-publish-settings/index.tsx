import { Button, Heading } from "@primer/react-brand"
import { useId } from "react"

import { HubAlert } from "@components/hub-alert"
import { HubSwitch } from "@components/hub-switch"

import { publishChangesCopy as copy } from "@hooks/use-canvas-publish-preference/en"
import type { usePublishPreference } from "@hooks/use-canvas-publish-preference"

import "./styles.css"

export function PublishSettings({
  preference,
  disabled = false,
}: {
  preference: ReturnType<typeof usePublishPreference>
  disabled?: boolean
}) {
  const headingId = useId()
  const labelId = useId()
  const inputId = useId()
  const errorId = useId()
  return (
    <section className="canvas-hub-section" aria-labelledby={headingId}>
      <Heading as="h3" size="subhead-medium" id={headingId}>
        {copy.settings}
      </Heading>
      <div className="canvas-publish-settings__option">
        <label id={labelId} htmlFor={inputId}>
          {copy.alwaysCommit}
        </label>
        <HubSwitch
          className="canvas-publish-settings__toggle"
          id={inputId}
          aria-labelledby={labelId}
          aria-describedby={preference.error ? errorId : undefined}
          checked={preference.remember === true}
          disabled={preference.loading || preference.remember === null}
          aria-disabled={preference.saving || disabled || undefined}
          onChange={(remember) => {
            if (!preference.saving && !disabled) void preference.save(remember)
          }}
          size="small"
        />
      </div>
      {preference.error ? (
        <div id={errorId} className="canvas-publish-settings__error">
          <HubAlert title={preference.error} variant="critical" layout="compact" />
          <Button
            size="small"
            disabled={preference.loading || preference.saving}
            onClick={() => void preference.retry()}
          >
            {copy.retrySettings}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
