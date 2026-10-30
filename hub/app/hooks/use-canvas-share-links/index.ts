import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { shareCopy } from "./en"
import type { ShareContext, ShareLink, SharePage, SharingState } from "./types"
import type { HubStatus, PrototypeState } from "@utils/prototype-canvas/types"
import { request } from "@utils/prototype-canvas-request"

const initial: SharingState = {
  open: false,
  context: null,
  links: [],
  loading: false,
  busy: false,
  stale: true,
  error: "",
  notice: "",
  created: null,
}

export function useShareLinks({
  token,
  hubStatus,
  prototypeState,
}: {
  token: string
  hubStatus: HubStatus | null
  prototypeState: PrototypeState | null
}) {
  const [state, setState] = useState(initial)
  const current = useRef(state)
  current.current = state
  const generation = useRef(0)
  const inFlight = useRef(false)
  const reading = useRef(false)
  const opening = useRef(false)
  const reopenRequested = useRef(false)
  const latestOpen = useRef<(() => Promise<void>) | null>(null)
  const identity = `${hubStatus?.hubOrigin}/${hubStatus?.repository}/${hubStatus?.branch}/${hubStatus?.state}`
  const liveIdentity = useRef(identity)
  liveIdentity.current = identity

  const reopenWhenIdle = useCallback(() => {
    if (
      !reopenRequested.current ||
      inFlight.current ||
      reading.current ||
      opening.current ||
      !latestOpen.current
    )
      return
    reopenRequested.current = false
    void latestOpen.current()
  }, [])

  // Reset before the committed identity can receive a new sharing request.
  useLayoutEffect(() => {
    generation.current += 1
    setState((previous) =>
      previous.open ? { ...initial, open: true, error: shareCopy.stale } : initial,
    )
  }, [identity, token])

  useEffect(
    () => () => {
      generation.current += 1
      reopenRequested.current = false
    },
    [],
  )

  useEffect(() => {
    const prototype = hubStatus?.prototype
    if (
      !prototype ||
      prototype.canManageShareLinks === true ||
      current.current.context?.prototype.canManageShareLinks !== true
    )
      return
    generation.current += 1
    setState((previous) =>
      previous.open && previous.context?.prototype.id === prototype.id
        ? {
            ...initial,
            open: true,
            stale: false,
            context: {
              ...previous.context,
              prototype: {
                ...previous.context.prototype,
                canManageShareLinks: prototype.canManageShareLinks,
              },
            },
          }
        : previous,
    )
  }, [hubStatus?.prototype])

  useEffect(() => {
    if (hubStatus?.prototype?.publicSharingEnabled !== false) return
    generation.current += 1
    setState((previous) =>
      previous.open
        ? {
            ...initial,
            open: true,
            sharingDisabled: true,
            error: shareCopy.disabled,
            context: previous.context
              ? {
                  ...previous.context,
                  prototype: { ...previous.context.prototype, publicSharingEnabled: false },
                }
              : null,
          }
        : initial,
    )
  }, [hubStatus?.prototype?.publicSharingEnabled])

  const send = useCallback(
    <T>(action: string, input: object): Promise<T> =>
      request<T>(`/api/hub/share-links/${action}`, token, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    [token],
  )

  /** Invalidates pending reads as well as remembered URLs and challenges. */
  const recordPolicyDenial = useCallback((error: unknown) => {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error.code !== "public_sharing_disabled" &&
        error.code !== "public_sharing_changed" &&
        error.code !== "creator_access_changed")
    )
      return
    generation.current += 1
    setState((previous) => ({
      ...previous,
      busy: false,
      loading: false,
      stale: true,
      sharingDisabled: error.code === "public_sharing_disabled",
      links: [],
      created: null,
      authorization: undefined,
    }))
  }, [])

  const refresh = useCallback(
    async (captured = current.current.context) => {
      if (
        !captured ||
        !captured.prototype.canManageShareLinks ||
        captured.prototype.publicSharingEnabled === false ||
        reading.current
      )
        return
      reading.current = true
      const version = generation.current
      const targetIdentity = liveIdentity.current
      setState((previous) => ({ ...previous, loading: true, stale: true, error: "" }))
      try {
        const links = new Map<number, ShareLink>()
        const cursors = new Set<string>()
        let cursor: string | null = null
        do {
          const page: SharePage = await send<SharePage>("list", {
            target: captured.target,
            ...(cursor ? { cursor } : {}),
          })
          if (version !== generation.current || targetIdentity !== liveIdentity.current) return
          for (const link of page.shareLinks) links.set(link.id, link)
          cursor = page.nextCursor
          if (cursor) {
            if (cursors.has(cursor)) throw new Error(shareCopy.paginationFailed)
            cursors.add(cursor)
          }
        } while (cursor)
        setState((previous) => ({
          ...previous,
          links: [...links.values()],
          created: previous.created ? (links.get(previous.created.id) ?? null) : null,
          loading: reopenRequested.current,
          stale: reopenRequested.current,
          sharingDisabled: false,
        }))
      } catch (error) {
        if (version === generation.current && targetIdentity === liveIdentity.current) {
          setState((previous) => ({
            ...previous,
            loading: false,
            stale: true,
            error: error instanceof Error ? error.message : shareCopy.failed,
          }))
          recordPolicyDenial(error)
        }
      } finally {
        reading.current = false
        reopenWhenIdle()
      }
    },
    [send, reopenWhenIdle, recordPolicyDenial],
  )

  const open = useCallback(async () => {
    if (inFlight.current || opening.current || reading.current) {
      reopenRequested.current = true
      setState((previous) => ({ ...previous, open: true, stale: true, loading: true }))
      return
    }
    opening.current = true
    const version = ++generation.current
    const targetIdentity = liveIdentity.current
    setState({ ...initial, open: true, loading: true })
    const sameCheckout =
      hubStatus?.repository === prototypeState?.stats.repository &&
      hubStatus?.branch === prototypeState?.stats.branch
    let blocker = ""
    if (!hubStatus || ["disconnected", "pairing", "unconfigured"].includes(hubStatus.state))
      blocker = shareCopy.disconnected
    else if (["unavailable", "denied"].includes(hubStatus.state)) blocker = shareCopy.unavailable
    else if (hubStatus.state !== "connected" || !sameCheckout) blocker = shareCopy.branch
    if (blocker) {
      setState({ ...initial, open: true, error: blocker })
      opening.current = false
      return
    }
    try {
      const context = await send<ShareContext>("context", {})
      if (version !== generation.current || targetIdentity !== liveIdentity.current) return
      setState((previous) => ({
        ...previous,
        context,
        loading: false,
        stale: context.prototype.canManageShareLinks === true,
      }))
      await refresh(context)
    } catch (error) {
      if (version === generation.current && targetIdentity === liveIdentity.current)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : shareCopy.failed,
        }))
    } finally {
      opening.current = false
      reopenWhenIdle()
    }
  }, [hubStatus, prototypeState, refresh, send, reopenWhenIdle])
  latestOpen.current = open

  const mutate = useCallback(
    async (action: "create" | "delete", input: object) => {
      const snapshot = current.current
      if (
        inFlight.current ||
        opening.current ||
        reading.current ||
        reopenRequested.current ||
        snapshot.stale ||
        !snapshot.context ||
        snapshot.context.prototype.canManageShareLinks !== true ||
        snapshot.sharingDisabled ||
        snapshot.context.prototype.publicSharingEnabled === false
      )
        return false
      inFlight.current = true
      const version = generation.current
      setState((previous) => ({ ...previous, busy: true, error: "", notice: "" }))
      try {
        const result = await send<ShareLink | { deleted: true }>(action, {
          target: snapshot.context.target,
          ...input,
        })
        if (version !== generation.current) return false
        setState((previous) => ({
          ...previous,
          notice: action === "delete" ? shareCopy.deleted : "",
          authorization: undefined,
          created:
            "id" in result
              ? result
              : action === "delete" && "id" in input && previous.created?.id === input.id
                ? null
                : previous.created,
          links:
            action === "delete" && "id" in input
              ? previous.links.filter((link) => link.id !== input.id)
              : previous.links,
        }))
        await refresh(snapshot.context)
        return true
      } catch (error) {
        if (version !== generation.current) return false
        const authorization =
          error instanceof Error &&
          "code" in error &&
          error.code === "fresh_authorization_required" &&
          "authorization" in error &&
          error.authorization &&
          typeof error.authorization === "object" &&
          "url" in error.authorization &&
          typeof error.authorization.url === "string" &&
          "expiresAt" in error.authorization &&
          typeof error.authorization.expiresAt === "string"
            ? { url: error.authorization.url, expiresAt: error.authorization.expiresAt }
            : undefined
        const unknown =
          error instanceof Error &&
          (!("statusCode" in error) || ("code" in error && error.code === "share_delivery_unknown"))
        setState((previous) => ({
          ...previous,
          stale: true,
          authorization,
          error: unknown
            ? shareCopy.unknown
            : error instanceof Error
              ? error.message
              : shareCopy.failed,
        }))
        recordPolicyDenial(error)
        return false
      } finally {
        inFlight.current = false
        if (version === generation.current) setState((previous) => ({ ...previous, busy: false }))
        reopenWhenIdle()
      }
    },
    [refresh, send, reopenWhenIdle, recordPolicyDenial],
  )

  const setControlPreference = useCallback(
    async (included: boolean) => {
      const snapshot = current.current
      if (!snapshot.context || opening.current || reading.current || reopenRequested.current)
        throw new Error(shareCopy.stale)
      const version = generation.current
      const result = await send<{ included: boolean }>("controls-preference", {
        target: snapshot.context.target,
        included,
      })
      if (version !== generation.current) throw new Error(shareCopy.stale)
      if (result.included !== included) throw new Error("The share preference could not be saved.")
    },
    [send],
  )

  const openLink = useCallback(
    async (id: number, controlsQuery?: string) => {
      const snapshot = current.current
      if (
        !snapshot.context ||
        snapshot.stale ||
        opening.current ||
        reading.current ||
        reopenRequested.current
      )
        return
      const version = generation.current
      try {
        await send("open", {
          target: snapshot.context.target,
          id,
          ...(controlsQuery ? { controlsQuery } : {}),
        })
      } catch (error) {
        if (version === generation.current) {
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : shareCopy.failed,
          }))
          recordPolicyDenial(error)
        }
      }
    },
    [send, recordPolicyDenial],
  )

  /** Opens only the saved scope-bound check; never replays the original mutation. */
  const authorize = useCallback(async () => {
    const snapshot = current.current
    if (!snapshot.context || !snapshot.authorization || snapshot.busy) return
    const version = generation.current
    try {
      await send("authorize", { target: snapshot.context.target })
      if (version === generation.current)
        setState((previous) => ({ ...previous, notice: shareCopy.authorizationRetry }))
    } catch (error) {
      if (version === generation.current) {
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : shareCopy.failed,
        }))
        recordPolicyDenial(error)
      }
    }
  }, [send, recordPolicyDenial])

  useEffect(() => {
    if (!state.open || !state.context) return
    function focus() {
      if (!inFlight.current) void refresh()
    }
    const timer = window.setInterval(focus, 30_000)
    window.addEventListener("focus", focus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", focus)
    }
  }, [state.open, state.context, refresh])

  return {
    state,
    open,
    close: () => {
      reopenRequested.current = false
      setState((previous) => ({ ...previous, open: false }))
    },
    refresh: () =>
      state.context &&
      !state.sharingDisabled &&
      state.context.prototype.publicSharingEnabled !== false
        ? refresh()
        : open(),
    create: (label: string, expiration: string) =>
      mutate("create", { label, expiration, buildNumber: state.context?.prototype.build?.number }),
    remove: (id: number) => mutate("delete", { id }),
    openLink,
    setControlPreference,
    authorize,
  }
}
