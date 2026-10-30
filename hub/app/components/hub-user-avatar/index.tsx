import { Avatar } from "@primer/react-brand"

import "./styles.css"

export function HubUserAvatar({
  src,
  size = 32,
  className,
}: {
  src: string | null
  size?: 20 | 24 | 28 | 32
  className?: string
}) {
  return (
    <Avatar
      src={src || "/avatar-placeholder.svg"}
      alt=""
      size={32}
      className={`hub-user-avatar hub-user-avatar--${size}${className ? ` ${className}` : ""}`}
      onError={(event) => {
        const image = event.currentTarget
        if (image.getAttribute("src") !== "/avatar-placeholder.svg")
          image.src = "/avatar-placeholder.svg"
      }}
    />
  )
}
