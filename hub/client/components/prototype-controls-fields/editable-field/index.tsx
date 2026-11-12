import { FormControl, Textarea, TextInput } from "@primer/react-brand"
import { useState, type ChangeEvent, type CSSProperties } from "react"

import { valueIssue, type Control } from "@utils/prototype-controls/controls.mjs"

import type { ControlFieldResult } from "@utils/prototype-controls-connection/types"
import { useControlDraft } from "../use-control-draft"
import { numericInputWidth } from "../numeric-input-width"

type EditableControl = Extract<
  Control,
  { type: "text" | "textarea" | "number" | "slider" | "color" }
>

export function EditableField({
  id,
  control,
  value,
  disabled,
  message,
  onCommit,
}: {
  id: string
  control: EditableControl
  value: unknown
  disabled: boolean
  message?: string
  onCommit: (value: unknown) => ControlFieldResult | Promise<ControlFieldResult>
}) {
  const field = useControlDraft(value, onCommit)
  const [issue, setIssue] = useState<string | null>(null)
  function change(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const raw = event.target.value
    const next =
      control.type === "number" || control.type === "slider"
        ? raw === ""
          ? NaN
          : Number(raw)
        : raw
    const error = valueIssue(control, next)
    setIssue(error)
    // Drafts allow intermediate empty/short input; only valid values cross the frame.
    if (error) field.stage(raw)
    else field.commit(raw, next)
  }
  const error = issue || field.error
  const numeric = control.type === "number" || control.type === "slider"
  const sliderStyle: (CSSProperties & { "--controls-slider-progress": string }) | undefined =
    control.type === "slider"
      ? {
          "--controls-slider-progress": `${
            control.min === control.max
              ? 100
              : ((Number(value) - control.min) / (control.max - control.min)) * 100
          }%`,
        }
      : undefined
  const description =
    [message ? `${id}-hint` : undefined, error ? `${id}-validation` : undefined]
      .filter(Boolean)
      .join(" ") || undefined
  const common = {
    id,
    disabled,
    value: String(field.draft),
    onChange: change,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": description,
    onBlur: () => {
      if (!issue) return
      field.reset()
      setIssue(null)
    },
  }
  let input
  if (control.type === "textarea") input = <Textarea {...common} rows={2} resize="vertical" />
  else if (numeric)
    input = (
      <TextInput
        {...common}
        className={
          control.type === "slider"
            ? "controls-number-input controls-number-input--slider"
            : "controls-number-input"
        }
        type="number"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        validationStatus={error ? "error" : undefined}
        aria-labelledby={`${id}-label`}
        style={{ width: numericInputWidth(control) }}
      />
    )
  else if (control.type === "color")
    input = <input {...common} className="controls-native-color" type="color" />
  else input = <TextInput {...common} type="text" />
  return (
    <FormControl
      id={id}
      className={numeric ? `controls-field controls-field--${control.type}` : "controls-field"}
      fullWidth={!numeric || control.type === "slider"}
      validationStatus={error ? "error" : undefined}
    >
      {numeric ? (
        <div className="controls-field-heading">
          <FormControl.Label id={`${id}-label`} htmlFor={id} className="controls-field-label">
            {control.label}
          </FormControl.Label>
          {control.type === "slider" ? (
            <div className="controls-slider-row">
              <input
                {...common}
                id={`${id}-slider`}
                value={String(value)}
                className="controls-native-slider"
                type="range"
                style={sliderStyle}
                min={control.min}
                max={control.max}
                step={control.step ?? 1}
                aria-labelledby={`${id}-label`}
              />
              {input}
            </div>
          ) : (
            input
          )}
        </div>
      ) : (
        <FormControl.Label className="controls-field-label">{control.label}</FormControl.Label>
      )}
      {!numeric ? input : null}
      {message ? (
        <FormControl.Hint>
          <span role="status">{message}</span>
        </FormControl.Hint>
      ) : null}
      {error ? (
        <FormControl.Validation className="controls-field-validation" aria-live="polite">
          {error}
        </FormControl.Validation>
      ) : null}
    </FormControl>
  )
}
