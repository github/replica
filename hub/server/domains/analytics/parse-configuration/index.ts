import { isDeepStrictEqual } from "node:util"
import { z } from "zod"

import {
  parsePublicEndpoint,
  PublicEndpointError,
  type AnalyticsPolicy,
} from "../../../utils/analytics-public-endpoint/index.ts"
import { analyticsAuthenticationHeaders } from "../constants.ts"
import { AnalyticsSettingsError } from "../errors.ts"
import type {
  CustomConfiguration,
  CustomHeader,
  DestinationConfiguration,
  DestinationInput,
  JsonScalar,
  JsonValue,
} from "../types.ts"

const optionalCredential = z.string().max(1_024).optional()
const segment = z.strictObject({
  region: z.enum(["us", "eu"]),
  writeKey: optionalCredential,
})
const mixpanel = z.strictObject({
  region: z.enum(["us", "eu", "in"]),
  serviceAccountUsername: optionalCredential,
  serviceAccountSecret: optionalCredential,
  projectId: optionalCredential,
})
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
const custom = z.strictObject({
  name: z.string().trim().min(1).max(64),
  endpoint: z.string().max(2_048),
  headers: z.record(z.string(), z.unknown()),
  template: z.unknown(),
  secrets: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
        value: optionalCredential,
      }),
    )
    .max(8)
    .default([]),
  successPointer: z.string().max(256).default(""),
  successValue: scalar.optional(),
  keepPending: z.boolean().default(false),
})

const forbiddenHeaders = new Set([
  "host",
  "cookie",
  "set-cookie",
  "connection",
  "content-length",
  "content-type",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "keep-alive",
  "authorization-info",
  "forwarded",
  "x-replica-event-id",
  "x-http-method-override",
  "x-method-override",
  "x-original-url",
  "x-rewrite-url",
  "x-real-ip",
  "expect",
])
const requiredFields = new Set([
  "event_id",
  "event_name",
  "occurred_at",
  "repository_id",
  "prototype_id",
  "properties",
])
const optionalFields = new Set(["actor_id", "build_id", "thread_id", "comment_id"])
const interpolation = /\$\{|\{\{|\$secret/

function invalid(message: string): never {
  throw new AnalyticsSettingsError(422, message)
}

function record(input: unknown): input is Record<string, unknown> {
  return (
    input !== null && typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype
  )
}

function secretName(value: unknown): string | undefined {
  return record(value) && Object.keys(value).length === 1 && typeof value.$secret === "string"
    ? value.$secret
    : undefined
}

function printable(value: string) {
  return !/[^\x20-\x7e]/.test(value)
}

function credential(input?: string, fallback?: string) {
  const value = input?.trim() ? input : fallback
  if (!value || Buffer.byteLength(value) > 1_024 || /\p{Cc}/u.test(value)) {
    invalid("Enter the required provider credentials (at most 1024 bytes each).")
  }
  return value
}

function validateTemplate(value: unknown, secrets: Record<string, string>, depth = 0): JsonValue {
  if (depth > 8) invalid("The JSON body is too deeply nested.")
  if (Array.isArray(value)) {
    if (value.length > 50) invalid("A JSON array may contain at most 50 items.")
    return value.map((child) => validateTemplate(child, secrets, depth + 1))
  }
  if (record(value)) {
    const keys = Object.keys(value)
    if (Object.hasOwn(value, "$secret")) {
      const name = secretName(value)
      if (!name || !Object.hasOwn(secrets, name))
        invalid("Reference a defined secret as a whole value.")
      return { $secret: name }
    }
    if (Object.hasOwn(value, "$field")) {
      const field = value.$field
      if (typeof field === "string" && keys.length === 1 && requiredFields.has(field)) {
        return { $field: field }
      }
      const fallback = scalar.safeParse(value.when_missing)
      if (
        typeof field === "string" &&
        optionalFields.has(field) &&
        keys.length === 2 &&
        Object.hasOwn(value, "when_missing") &&
        fallback.success &&
        !(typeof fallback.data === "string" && interpolation.test(fallback.data))
      ) {
        return { $field: field, when_missing: fallback.data }
      }
      invalid("Use an allowed field and a scalar fallback for optional fields.")
    }
    if (keys.length > 50) invalid("A JSON object may contain at most 50 fields.")
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => {
        if (Buffer.byteLength(name) > 128 || interpolation.test(name)) {
          invalid("JSON field names must be literal and at most 128 bytes.")
        }
        return [name, validateTemplate(child, secrets, depth + 1)]
      }),
    )
  }
  const literal = scalar.safeParse(value)
  if (!literal.success || (typeof literal.data === "string" && interpolation.test(literal.data))) {
    invalid("JSON values cannot interpolate fields or secrets.")
  }
  return literal.data
}

function effectiveHeader(value: CustomHeader, secrets: Record<string, string>) {
  return typeof value === "string" ? value : secrets[value.$secret]
}

function preservesTemplateSecrets(
  value: JsonValue,
  before: Record<string, string>,
  after: Record<string, string>,
): boolean {
  if (value === null || typeof value !== "object") return true
  const name = secretName(value)
  return name
    ? before[name] === after[name]
    : Object.values(value).every((child) => preservesTemplateSecrets(child, before, after))
}

function onlyAuthenticationChanged(before: CustomConfiguration, after: CustomConfiguration) {
  if (
    before.endpoint !== after.endpoint ||
    !isDeepStrictEqual(before.template, after.template) ||
    before.successPointer !== after.successPointer ||
    before.successValue !== after.successValue ||
    !isDeepStrictEqual(Object.keys(before.headers).sort(), Object.keys(after.headers).sort()) ||
    !preservesTemplateSecrets(after.template, before.secrets, after.secrets)
  )
    return false
  return Object.entries(before.headers).every(([name, oldValue]) => {
    if (analyticsAuthenticationHeaders.includes(name)) return true
    const newValue = after.headers[name]!
    return (
      isDeepStrictEqual(oldValue, newValue) &&
      effectiveHeader(oldValue, before.secrets) === effectiveHeader(newValue, after.secrets)
    )
  })
}

export function parseAnalyticsConfiguration(
  input: DestinationInput,
  policy: AnalyticsPolicy,
  previous?: DestinationConfiguration,
): { configuration: DestinationConfiguration; changedRecipient: boolean; keepPending: boolean } {
  if (previous && previous.provider !== input.provider)
    invalid("A destination’s provider cannot change.")
  if (input.provider === "segment") {
    const parsed = segment.safeParse(input.configuration)
    if (!parsed.success) invalid("Choose a supported Segment region and enter a source write key.")
    const writeKey = credential(
      parsed.data.writeKey,
      previous?.provider === "segment" ? previous.writeKey : undefined,
    )
    if (writeKey.includes(":")) invalid("Enter a valid Segment source write key.")
    return {
      configuration: { provider: "segment", region: parsed.data.region, writeKey },
      changedRecipient: false,
      keepPending: false,
    }
  }
  if (input.provider === "mixpanel") {
    const parsed = mixpanel.safeParse(input.configuration)
    if (!parsed.success)
      invalid("Choose a supported Mixpanel region and enter service account credentials.")
    const saved = previous?.provider === "mixpanel" ? previous : undefined
    const serviceAccountUsername = credential(
      parsed.data.serviceAccountUsername,
      saved?.serviceAccountUsername,
    )
    const serviceAccountSecret = credential(
      parsed.data.serviceAccountSecret,
      saved?.serviceAccountSecret,
    )
    const projectId = credential(parsed.data.projectId, saved?.projectId)
    if (!/^[1-9]\d{0,19}$/.test(projectId) || serviceAccountUsername.includes(":")) {
      invalid(
        "Use a Mixpanel service account username without a colon and a positive numeric project ID.",
      )
    }
    return {
      configuration: {
        provider: "mixpanel",
        region: parsed.data.region,
        serviceAccountUsername,
        serviceAccountSecret,
        projectId,
      },
      changedRecipient: false,
      keepPending: false,
    }
  }

  const parsed = custom.safeParse(input.configuration)
  if (!parsed.success) invalid("Enter a name, endpoint, JSON headers, and request template.")
  const inputCustom = parsed.data
  const saved = previous?.provider === "custom" ? previous : undefined
  let endpoint: string
  try {
    endpoint = parsePublicEndpoint(inputCustom.endpoint, policy).href
  } catch (error) {
    if (error instanceof PublicEndpointError) invalid(error.message)
    throw error
  }
  if (/\p{Cc}/u.test(inputCustom.name)) invalid("Use a printable destination name.")
  const secrets: Record<string, string> = {}
  for (const { name, value } of inputCustom.secrets) {
    if (Object.hasOwn(secrets, name)) invalid("Secret names must be distinct.")
    secrets[name] = credential(
      value,
      saved && Object.hasOwn(saved.secrets, name) ? saved.secrets[name] : undefined,
    )
  }

  const headers: Record<string, CustomHeader> = {}
  const headerEntries = Object.entries(inputCustom.headers)
  if (headerEntries.length > 12 || Buffer.byteLength(JSON.stringify(inputCustom.headers)) > 8_192) {
    invalid("Use at most 12 headers and 8192 bytes of header configuration.")
  }
  for (const [originalName, value] of headerEntries) {
    const name = originalName.toLowerCase()
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
      forbiddenHeaders.has(name) ||
      name.startsWith("proxy-") ||
      name.startsWith("x-forwarded-") ||
      Object.hasOwn(headers, name)
    )
      invalid("A header is forbidden or repeated.")

    if (record(value) && Object.keys(value).length === 1 && value.$keep === true) {
      const original = saved?.headers[name]
      if (typeof original !== "string") invalid("A header cannot be kept without a saved value.")
      headers[name] = original
    } else if (
      typeof value === "string" &&
      value.length <= 1_024 &&
      printable(value) &&
      !interpolation.test(value)
    ) {
      headers[name] = value
    } else {
      const secret = secretName(value)
      if (!secret || !Object.hasOwn(secrets, secret) || !printable(secrets[secret]!)) {
        invalid("Use a printable header value or a reference to a defined secret.")
      }
      headers[name] = { $secret: secret }
    }
  }
  const template = validateTemplate(inputCustom.template, secrets)
  if (Buffer.byteLength(JSON.stringify(template)) > 16_384)
    invalid("The request template is too large.")
  const { successPointer } = inputCustom
  const successValue: JsonScalar = inputCustom.successValue ?? null
  if (
    successPointer &&
    (!successPointer.startsWith("/") ||
      /~(?![01])|\p{Cc}/u.test(successPointer) ||
      inputCustom.successValue === undefined ||
      Buffer.byteLength(JSON.stringify(successValue)) > 512)
  )
    invalid("Enter a valid JSON Pointer and an expected JSON scalar.")

  const configuration: CustomConfiguration = {
    provider: "custom",
    name: inputCustom.name,
    endpoint,
    headers,
    template,
    secrets,
    successPointer,
    successValue: successPointer ? successValue : null,
  }
  const changedRecipient = Boolean(
    saved && !isDeepStrictEqual({ ...saved, name: "" }, { ...configuration, name: "" }),
  )
  if (
    inputCustom.keepPending &&
    (!saved || (changedRecipient && !onlyAuthenticationChanged(saved, configuration)))
  ) {
    invalid(
      "Pending events can be kept only for authentication changes to the same endpoint and payload.",
    )
  }
  return { configuration, changedRecipient, keepPending: inputCustom.keepPending }
}
