import { useRef } from "react"

import { DeviceDesktopIcon, MoonIcon, SignOutIcon, SunIcon } from "@primer/octicons-react"
import { ActionMenu } from "@primer/react-brand"

import { HubUserAvatar } from "@components/hub-user-avatar"
import { useOptionalHubTheme } from "@hooks/use-hub-theme"
import type { HubColorMode } from "@hooks/use-hub-theme"

import "./styles.css"

function ThemeModeControl({
  colorMode,
  options,
  onChange,
}: {
  colorMode: HubColorMode
  options: Array<{
    icon: typeof DeviceDesktopIcon
    label: string
    value: HubColorMode
  }>
  onChange: (value: HubColorMode) => void
}) {
  return (
    <li
      className="repository-user-menu__theme-control"
      role="none"
      tabIndex={-1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          event.currentTarget.querySelector("button")?.focus()
        }
      }}
    >
      <div className="repository-user-menu__theme-options" role="group">
        {options.map(({ icon: Icon, label, value }) => {
          const selected = colorMode === value

          return (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              className="repository-user-menu__theme-option"
              aria-label={label}
              aria-checked={selected}
              data-selected={selected ? "true" : undefined}
              onClick={() => onChange(value)}
            >
              <Icon size={16} />
            </button>
          )
        })}
      </div>
    </li>
  )
}

/** Keeps repository workspace account actions behind the current user. */
export function RepositoryUserMenu({
  accountMenuLabel,
  authenticityToken,
  collapsed = false,
  currentUser,
  darkThemeLabel,
  lightThemeLabel,
  signOutLabel,
  signOutPath,
  systemThemeLabel,
}: {
  accountMenuLabel: string
  authenticityToken: string
  collapsed?: boolean
  currentUser: {
    avatarUrl: string | null
    login: string
    name: string | null
  }
  darkThemeLabel?: string
  lightThemeLabel?: string
  signOutLabel: string
  signOutPath: string
  systemThemeLabel?: string
}) {
  const signOutForm = useRef<HTMLFormElement>(null)
  const theme = useOptionalHubTheme()
  const themeOptions =
    systemThemeLabel && lightThemeLabel && darkThemeLabel
      ? [
          { icon: DeviceDesktopIcon, label: systemThemeLabel, value: "auto" as const },
          { icon: SunIcon, label: lightThemeLabel, value: "light" as const },
          { icon: MoonIcon, label: darkThemeLabel, value: "dark" as const },
        ]
      : null
  const showThemeOptions = theme && themeOptions

  return (
    <>
      <div className={`repository-user-menu${collapsed ? " repository-user-menu--collapsed" : ""}`}>
        <ActionMenu size="small" selectionVariant="none" menuAlignment="start">
          <ActionMenu.Button
            className="repository-user-menu__trigger"
            variant="subtle"
            size="small"
            aria-label={accountMenuLabel}
            leadingVisual={<HubUserAvatar src={currentUser.avatarUrl} size={20} />}
          >
            <span className="repository-user-menu__identity">
              <span className="repository-user-menu__name">
                {currentUser.name ?? currentUser.login}
              </span>
              <span className="repository-user-menu__login">@{currentUser.login}</span>
            </span>
          </ActionMenu.Button>
          <ActionMenu.Overlay aria-label={accountMenuLabel}>
            {showThemeOptions ? (
              <ThemeModeControl
                colorMode={theme.colorMode}
                options={themeOptions}
                onChange={theme.setColorMode}
              />
            ) : null}
            <ActionMenu.Item
              className="repository-user-menu__sign-out"
              value="sign-out"
              leadingVisual={<SignOutIcon className="repository-user-menu__item-icon" size={16} />}
              onClick={() => signOutForm.current?.requestSubmit()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  signOutForm.current?.requestSubmit()
                }
              }}
            >
              {signOutLabel}
            </ActionMenu.Item>
          </ActionMenu.Overlay>
        </ActionMenu>
      </div>

      <form ref={signOutForm} action={signOutPath} method="post" hidden>
        <input type="hidden" name="_method" value="delete" />
        <input type="hidden" name="authenticity_token" value={authenticityToken} />
      </form>
    </>
  )
}
