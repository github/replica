import { useEffect, useRef, useState } from "react"
import type { MouseEvent, PropsWithChildren, SubmitEvent } from "react"
import { useLocation, useNavigate, useNavigation } from "react-router"
import { Button } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"

import "./styles.css"

export function HubNavigation({ children }: PropsWithChildren) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const content = useRef<HTMLDivElement>(null)
  const warning = useRef<HTMLDivElement>(null)
  const [blockedAction, setBlockedAction] = useState<string | null>(null)
  const [previousLocation, setPreviousLocation] = useState(location.key)

  if (location.key !== previousLocation) {
    setPreviousLocation(location.key)
    setBlockedAction(null)
  }

  useEffect(() => {
    const main = content.current?.querySelector("main")
    if (main instanceof HTMLElement) {
      main.tabIndex = -1
      main.focus({ preventScroll: true })
    }
  }, [location.pathname])

  useEffect(() => {
    if (blockedAction) warning.current?.focus()
  }, [blockedAction])

  function navigateLink(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    const anchor = event.target instanceof Element ? event.target.closest("a") : null
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      (anchor.target && anchor.target !== "_self") ||
      anchor.hasAttribute("download") ||
      anchor.relList.contains("external")
    )
      return
    const href = anchor.getAttribute("href")
    if (!href || href.startsWith("#")) return
    const current = new URL(
      `${location.pathname}${location.search}${location.hash}`,
      window.location.origin,
    )
    if (!URL.canParse(href, current)) {
      event.preventDefault()
      setBlockedAction("This link has an invalid address.")
      return
    }
    const destination = new URL(href, current)
    if (
      destination.origin !== current.origin ||
      !["http:", "https:"].includes(destination.protocol) ||
      /^\/(?:api(?:\/|$)|assets\/|mock-previews\/)/.test(destination.pathname)
    )
      return
    event.preventDefault()
    void navigate(`${destination.pathname}${destination.search}${destination.hash}`)
  }

  function blockLegacySubmission(event: SubmitEvent<HTMLDivElement>) {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return
    if (["get", "dialog"].includes(event.target.method.toLowerCase())) return
    event.preventDefault()
    setBlockedAction("This action is not connected in the frontend yet. No request was sent.")
  }

  return (
    <div
      className="hub-application"
      ref={content}
      onClick={navigateLink}
      onSubmit={blockLegacySubmission}
      aria-busy={navigation.state !== "idle"}
    >
      {navigation.state !== "idle" ? (
        <div className="hub-navigation-progress" role="status" aria-label="Page loading">
          Loading page...
        </div>
      ) : null}
      {blockedAction ? (
        <div className="hub-action-warning" ref={warning} tabIndex={-1}>
          <HubAlert
            title={blockedAction}
            variant="warning"
            action={
              <Button variant="subtle" size="small" onClick={() => setBlockedAction(null)}>
                Dismiss
              </Button>
            }
          />
        </div>
      ) : null}
      {children}
    </div>
  )
}
