import {
  ArrowLeftIcon,
  ArrowRightIcon,
  LinkExternalIcon,
  MoonIcon,
  SunIcon,
  SyncIcon,
} from "@primer/octicons-react"
import { useState, type Ref, type SubmitEvent } from "react"
import { ThemeProvider } from "@primer/react-brand"

import { copy } from "@utils/prototype-canvas/en"

import "./styles.css"

type Props = {
  address: string
  addressRef?: Ref<HTMLInputElement>
  canGoBack: boolean
  canGoForward: boolean
  appearance: "light" | "dark"
  onAppearanceChange: (appearance: "light" | "dark") => void
  onBack: () => void
  onForward: () => void
  onNavigate: (url: string) => void
  onOpenTab: () => Promise<void>
  onReload: () => void
}

export function BrowserBar({
  address,
  addressRef,
  canGoBack,
  canGoForward,
  appearance,
  onAppearanceChange,
  onBack,
  onForward,
  onNavigate,
  onOpenTab,
  onReload,
}: Props) {
  const [edit, setEdit] = useState<{ address: string; value: string; error: string } | null>(null)
  const draft = edit?.address === address ? edit.value : address
  const error = edit?.address === address ? edit.error : ""

  function navigate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const url = new URL(draft.trim(), address)
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.origin !== new URL(address).origin ||
        url.username ||
        url.password
      ) {
        setEdit({ address, value: draft, error: copy.browserAddressOrigin })
        return
      }
      setEdit(null)
      onNavigate(url.href)
    } catch {
      setEdit({ address, value: draft, error: copy.browserAddressInvalid })
    }
  }

  return (
    <ThemeProvider colorMode="auto" className="canvas-browser-theme">
      <nav className="canvas-browser-bar" aria-label={copy.browserNavigation}>
        <div className="canvas-browser-bar__navigation">
          <button
            type="button"
            aria-label={copy.browserBack}
            disabled={!canGoBack}
            onClick={onBack}
          >
            <ArrowLeftIcon size={16} />
          </button>
          <button
            type="button"
            aria-label={copy.browserForward}
            disabled={!canGoForward}
            onClick={onForward}
          >
            <ArrowRightIcon size={16} />
          </button>
          <button type="button" aria-label={copy.browserReload} onClick={onReload}>
            <SyncIcon size={16} />
          </button>
        </div>

        <form className="canvas-browser-bar__address" onSubmit={navigate}>
          <input
            ref={addressRef}
            aria-label={copy.browserAddress}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "canvas-browser-address-error" : undefined}
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setEdit({ address, value: event.target.value, error: "" })
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setEdit(null)
                event.currentTarget.blur()
              }
            }}
          />
          {error ? (
            <span
              id="canvas-browser-address-error"
              className="canvas-browser-bar__error"
              role="alert"
            >
              {error}
            </span>
          ) : null}
        </form>

        <div className="canvas-browser-bar__tools">
          <button
            type="button"
            aria-label={copy.browserOpenTab}
            title={copy.browserOpenTab}
            onClick={() => {
              void onOpenTab().catch((cause: unknown) => {
                setEdit({
                  address,
                  value: draft,
                  error: cause instanceof Error ? cause.message : String(cause),
                })
              })
            }}
          >
            <LinkExternalIcon size={16} />
          </button>
          <div
            className="canvas-browser-bar__appearance"
            role="group"
            aria-label={copy.browserAppearance}
          >
            <button
              type="button"
              aria-label={copy.browserLight}
              aria-pressed={appearance === "light"}
              onClick={() => onAppearanceChange("light")}
            >
              <SunIcon size={16} />
            </button>
            <button
              type="button"
              aria-label={copy.browserDark}
              aria-pressed={appearance === "dark"}
              onClick={() => onAppearanceChange("dark")}
            >
              <MoonIcon size={16} />
            </button>
          </div>
        </div>
      </nav>
    </ThemeProvider>
  )
}
