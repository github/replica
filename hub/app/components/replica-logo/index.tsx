import type { ReplicaLogoProps } from "./types"

import "./styles.css"

export function ReplicaLogo({ size = "medium", className }: ReplicaLogoProps) {
  return (
    <span
      className={`replica-logo${className ? ` ${className}` : ""}`}
      data-size={size}
      role="img"
      aria-label="Replica"
    >
      <span className="replica-logo__mark" aria-hidden="true" />
      <span className="replica-logo__wordmark" aria-hidden="true">
        Replica
      </span>
    </span>
  )
}
