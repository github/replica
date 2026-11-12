import "./styles.css"

type Props = {
  size?: "small" | "medium"
  className?: string
} & ({ label: string; decorative?: false } | { decorative: true; label?: never })

export function HubSpinner({ size = "medium", className, label }: Props) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`hub-spinner hub-spinner--${size}${className ? ` ${className}` : ""}`}
    />
  )
}
