import {
  Checkbox,
  CheckboxGroup,
  FormControl,
  Radio,
  RadioGroup,
  Select,
  Text,
} from "@primer/react-brand"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import type { Control } from "@utils/prototype-controls/controls.mjs"

import type { ControlFieldResult } from "@utils/prototype-controls-connection/types"
import { useControlDraft } from "../use-control-draft"

type ChoiceControl = Extract<
  Control,
  { type: "boolean" | "select" | "radio" | "segmented" | "checkboxGroup" }
>

export function ChoiceField({
  id,
  control,
  value,
  disabled,
  message,
  onCommit,
}: {
  id: string
  control: ChoiceControl
  value: unknown
  disabled: boolean
  message?: string
  onCommit: (value: unknown) => ControlFieldResult | Promise<ControlFieldResult>
}) {
  const field = useControlDraft(value, onCommit)
  const description =
    [message ? `${id}-unavailable` : undefined, field.error ? `${id}-validation` : undefined]
      .filter(Boolean)
      .join(" ") || undefined
  if (control.type === "boolean" || control.type === "select")
    return (
      <FormControl
        id={id}
        className={
          control.type === "boolean"
            ? "controls-field controls-choice-row"
            : "controls-field controls-field--select"
        }
        fullWidth={control.type === "boolean"}
        validationStatus={field.error ? "error" : undefined}
      >
        {control.type === "select" ? (
          <FormControl.Label className="controls-field-label">{control.label}</FormControl.Label>
        ) : null}
        {control.type === "boolean" ? (
          <Checkbox
            className="controls-choice-mark"
            disabled={disabled}
            aria-describedby={description}
            checked={field.draft === true}
            onChange={(event) => field.commit(event.target.checked)}
          />
        ) : (
          <Select
            className="controls-select-input"
            disabled={disabled}
            aria-describedby={description}
            value={field.draft as string}
            onChange={(event) => field.commit(event.target.value)}
          >
            {control.options.map((option) => (
              <Select.Option key={option} value={option}>
                {option}
              </Select.Option>
            ))}
          </Select>
        )}
        {control.type === "boolean" ? (
          <FormControl.Label className="controls-choice-label">{control.label}</FormControl.Label>
        ) : null}
        {message ? (
          <FormControl.Hint>
            <span role="status">{message}</span>
          </FormControl.Hint>
        ) : null}
        {field.error ? (
          <FormControl.Validation className="controls-field-validation" aria-live="polite">
            {field.error}
          </FormControl.Validation>
        ) : null}
      </FormControl>
    )
  const multiple = control.type === "checkboxGroup"
  const segmented = control.type === "segmented"
  const Group = multiple ? CheckboxGroup : RadioGroup
  const Input = multiple ? Checkbox : Radio
  return (
    <Group
      id={id}
      className="controls-field"
      aria-disabled={disabled || undefined}
      aria-describedby={description}
    >
      <Group.Label className="controls-choice-group-label">{control.label}</Group.Label>
      <div className={segmented ? "controls-segments" : "controls-options"}>
        {control.options.map((option, index) => {
          const optionId = `${id}-${index}`
          const checked = multiple
            ? (field.draft as string[]).includes(option)
            : field.draft === option
          const input = (
            <Input
              className={
                multiple
                  ? "controls-choice-mark"
                  : "controls-choice-mark controls-choice-mark--radio"
              }
              id={optionId}
              name={id}
              value={option}
              checked={checked}
              disabled={disabled}
              aria-describedby={description}
              onChange={(event) => {
                const values = field.current() as string[]
                field.commit(
                  multiple
                    ? event.target.checked
                      ? [...values, option]
                      : values.filter((item) => item !== option)
                    : option,
                )
              }}
            />
          )
          return segmented ? (
            <label key={option} htmlFor={optionId} className="controls-segment" title={option}>
              <HubVisuallyHidden>{input}</HubVisuallyHidden>
              <Text as="span" size="100" weight="medium">
                {option}
              </Text>
            </label>
          ) : (
            <FormControl key={option} id={optionId} className="controls-field controls-choice-row">
              {input}
              <FormControl.Label className="controls-choice-label">{option}</FormControl.Label>
            </FormControl>
          )
        })}
      </div>
      {message ? (
        <Text as="span" id={`${id}-unavailable`} size="100" variant="muted" role="status">
          {message}
        </Text>
      ) : null}
      {field.error ? (
        <Group.Validation variant="error" role="status">
          {field.error}
        </Group.Validation>
      ) : null}
    </Group>
  )
}
