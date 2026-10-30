import type { InputHTMLAttributes } from "react"

import { Checkbox } from "@primer/react-brand"

import "./styles.css"

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "defaultChecked" | "onChange" | "size" | "children"
> & {
  checked: boolean
  onChange: (checked: boolean) => void
  size?: "small" | "medium"
} & (
    | { "aria-label": string; "aria-labelledby"?: string }
    | { "aria-labelledby": string; "aria-label"?: string }
  )

export function HubSwitch({ checked, onChange, size = "medium", className, ...props }: Props) {
  const { value, ...checkboxProps } = props

  return (
    <label
      className={`hub-switch hub-switch--${size}${className ? ` ${className}` : ""}`}
      data-disabled={props.disabled || undefined}
    >
      <span className="hub-switch__native-control">
        <Checkbox
          {...checkboxProps}
          value={value === undefined ? undefined : String(value)}
          role="switch"
          checked={checked}
          onChange={(event) => {
            if (!props.disabled) onChange(event.currentTarget.checked)
          }}
        />
      </span>
      <span className="hub-switch__track" data-checked={checked} aria-hidden="true">
        <span className="hub-switch__thumb" />
      </span>
    </label>
  )
}
