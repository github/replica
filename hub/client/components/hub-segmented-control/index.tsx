import { useId } from "react"

import { Radio } from "@primer/react-brand"

import { HubVisuallyHidden } from "../hub-visually-hidden"

import type { HubSegmentedControlOption } from "./types"

import "./styles.css"

type AccessibleName =
  | { "aria-label": string; "aria-labelledby"?: string }
  | { "aria-labelledby": string; "aria-label"?: string }

type Props<Value extends string> = AccessibleName & {
  "aria-describedby"?: string
  disabled?: boolean
  fullWidth?: boolean
  name?: string
  onChange: (value: Value) => void
  options: readonly HubSegmentedControlOption<Value>[]
  size?: "small" | "medium"
  value: Value
  variant?: "icon" | "text"
}

export function HubSegmentedControl<Value extends string>({
  disabled = false,
  fullWidth = false,
  name,
  onChange,
  options,
  size = "medium",
  value,
  variant = "text",
  ...accessibleProps
}: Props<Value>) {
  const generatedName = useId()

  return (
    <div
      {...accessibleProps}
      role="radiogroup"
      aria-disabled={disabled || undefined}
      className={`hub-segmented-control hub-segmented-control--${size} hub-segmented-control--${variant}${fullWidth ? " hub-segmented-control--full-width" : ""}`}
    >
      {options.map((option) => {
        const Icon = option.icon
        const optionDisabled = disabled || option.disabled

        return (
          <label
            key={option.value}
            className="hub-segmented-control__option"
            title={variant === "icon" ? option.label : undefined}
          >
            <HubVisuallyHidden>
              <Radio
                name={name ?? generatedName}
                value={option.value}
                checked={value === option.value}
                disabled={optionDisabled}
                aria-describedby={accessibleProps["aria-describedby"]}
                onChange={() => {
                  if (!optionDisabled) onChange(option.value)
                }}
              />
            </HubVisuallyHidden>
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            {variant === "icon" ? (
              <HubVisuallyHidden>{option.label}</HubVisuallyHidden>
            ) : (
              <span className="hub-segmented-control__label">{option.label}</span>
            )}
          </label>
        )
      })}
    </div>
  )
}
