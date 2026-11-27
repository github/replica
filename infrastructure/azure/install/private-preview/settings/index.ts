import type { PrivatePreviewChoice } from "../../../../installer/types.ts"

export type ReaderMode = "absent" | "disabled" | "enabled"

// What saved private-preview Terraform state records.
export interface PreviewState {
  reader: ReaderMode
  inline: boolean
  writer: boolean
  boundHostname?: string
  // The Hub settings an enabled reader was started with.
  hubOrigin?: string
  hops?: number
}

export interface PreviewVariables {
  reader: ReaderMode
  inline_enabled: boolean
  custom_hostname: string | null
  bind_custom_hostname: boolean
  writer: boolean
}

export const noPreviewState: PreviewState = { reader: "absent", inline: false, writer: false }

export const offChoice: PrivatePreviewChoice = { reader: "off", inline: false, writerRepositoryIds: [] }

const rank: Record<ReaderMode, number> = { absent: 0, disabled: 1, enabled: 2 }

export function targetVariables(
  choice: PrivatePreviewChoice,
  current: PreviewState,
  { dnsReady }: { dnsReady: boolean },
): PreviewVariables {
  const reader: ReaderMode =
    choice.reader === "on"
      ? "enabled"
      : choice.reader === "removed" || current.reader === "absent"
        ? "absent"
        : "disabled"
  const enabled = reader === "enabled"
  const hostname = enabled ? (choice.hostname ?? null) : null
  if (enabled && current.boundHostname && current.boundHostname !== hostname)
    throw new Error(
      `Private preview blocked: the reader is already bound to ${current.boundHostname}. Changing or removing its hostname is not supported while it is on. Turn the reader off first, then choose the new hostname. No changes were made.`,
    )
  return {
    reader,
    inline_enabled: enabled && choice.inline,
    custom_hostname: hostname,
    bind_custom_hostname: hostname !== null && (current.boundHostname === hostname || dnsReady),
    writer: choice.reader !== "removed" && choice.writerRepositoryIds.length > 0,
  }
}

// Before Hub changes, keep everything Hub may still use; afterwards, apply the target.
export function expandVariables(
  current: PreviewState,
  target: PreviewVariables,
  { hubUsesReader }: { hubUsesReader: boolean },
): PreviewVariables {
  const reader = rank[current.reader] > rank[target.reader] ? current.reader : target.reader
  const enabled = reader === "enabled"
  // A reader that Hub already uses keeps its origin until the new Hub is released.
  const pinned = hubUsesReader && current.reader === "enabled"
  const hostname = pinned
    ? (current.boundHostname ?? null)
    : target.custom_hostname ?? (enabled ? (current.boundHostname ?? null) : null)
  return {
    reader,
    inline_enabled: enabled && (target.inline_enabled || current.inline),
    custom_hostname: hostname,
    bind_custom_hostname:
      hostname !== null &&
      (current.boundHostname === hostname || (!pinned && target.bind_custom_hostname)),
    writer: target.writer || current.writer,
  }
}

export function sameVariables(left: PreviewVariables, right: PreviewVariables) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function needsPreviewRoot(choice: PrivatePreviewChoice, stateExists: boolean) {
  return stateExists || choice.reader === "on" || choice.writerRepositoryIds.length > 0
}

type StateResource = {
  address?: unknown
  values?: {
    name?: unknown
    ingress?: unknown[]
    template?: { container?: { env?: { name?: unknown; value?: unknown }[] }[] }[]
  }
}

// Reads `terraform show -json` of the private-preview root, including pre-count addresses.
export function readPreviewState(snapshot: unknown): PreviewState {
  const invalid = () => new Error("Private preview blocked: saved state has an unexpected shape. No changes were made.")
  if (typeof snapshot !== "object" || snapshot === null) throw invalid()
  const { format_version: format, values } = snapshot as { format_version?: unknown; values?: unknown }
  if (format !== "1.0") throw invalid()
  if (values === undefined) return noPreviewState
  const root = (values as { root_module?: { resources?: unknown; child_modules?: unknown[] } }).root_module
  if (!root || root.child_modules?.length || (root.resources !== undefined && !Array.isArray(root.resources)))
    throw invalid()
  const resources = (root.resources ?? []) as StateResource[]
  const find = (...addresses: string[]) =>
    resources.find((resource) => addresses.includes(String(resource.address)))
  const app = find("azurerm_container_app.reader", "azurerm_container_app.reader[0]")
  const domain = find("azurerm_container_app_custom_domain.reader[0]")?.values?.name
  const env = app?.values?.template?.[0]?.container?.[0]?.env ?? []
  const setting = (key: string) => env.find(({ name }) => name === key)?.value
  const hubOrigin = setting("HUB_APPLICATION_ORIGIN")
  const hops = Number(setting("PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS"))
  return {
    ...(typeof hubOrigin === "string" ? { hubOrigin } : {}),
    ...(Number.isInteger(hops) && hops > 0 ? { hops } : {}),
    reader: !app ? "absent" : app.values?.ingress?.length ? "enabled" : "disabled",
    inline: env.some(({ name, value }) => name === "HUB_PRIVATE_PREVIEW_INLINE_ENABLED" && value === "true"),
    writer: Boolean(find("azurerm_role_assignment.writer[0]")),
    ...(typeof domain === "string" ? { boundHostname: domain } : {}),
  }
}
