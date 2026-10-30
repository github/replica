import { context, diag, DiagLogLevel, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace"

import type { TelemetryLogger, TelemetryRuntime } from "./types.ts"

let started = false

export function startTelemetry(env: NodeJS.ProcessEnv, logger: TelemetryLogger): TelemetryRuntime {
  if (env.OTEL_SDK_DISABLED?.toLowerCase() === "true") {
    return { async shutdown() {} }
  }
  const exporterName = env.OTEL_TRACES_EXPORTER ?? "none"
  if (exporterName === "none") return { async shutdown() {} }
  if (exporterName !== "otlp") {
    throw new Error("OTEL_TRACES_EXPORTER must be none or otlp.")
  }
  if (env.OTEL_SDK_DISABLED && env.OTEL_SDK_DISABLED.toLowerCase() !== "false") {
    throw new Error("OTEL_SDK_DISABLED must be true or false.")
  }
  if (started) throw new Error("Telemetry has already started in this process.")

  const protocol =
    env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf"
  if (protocol !== "http/protobuf") {
    throw new Error("Telemetry supports only the http/protobuf OTLP protocol.")
  }
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT
  let url: URL
  try {
    if (!endpoint) throw new Error()
    url = new URL(endpoint)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT !== undefined && url.pathname === "/")
    ) {
      throw new Error()
    }
  } catch {
    throw new Error(
      "Telemetry requires an absolute HTTP(S) endpoint without credentials, query, or fragment; a trace-specific endpoint must include a request path.",
    )
  }
  if (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT === undefined) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/traces`
  }

  const headers: Record<string, string> = {}
  const encodedHeaders = env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS
  if (encodedHeaders !== undefined) {
    try {
      for (const entry of encodedHeaders.split(",")) {
        const separator = entry.indexOf("=")
        if (separator < 1) throw new Error()
        const key = decodeURIComponent(entry.slice(0, separator).trim())
        const value = decodeURIComponent(entry.slice(separator + 1).trim())
        if (
          !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) ||
          !value.trim() ||
          !/^[\x20-\x7e]+$/.test(value) ||
          Object.hasOwn(headers, key.toLowerCase())
        ) {
          throw new Error()
        }
        Object.defineProperty(headers, key.toLowerCase(), {
          value,
          enumerable: true,
        })
      }
    } catch {
      throw new Error("Telemetry headers must be comma-separated URL-encoded key=value entries.")
    }
  }

  const samplerName = env.OTEL_TRACES_SAMPLER ?? "parentbased_traceidratio"
  if (!["parentbased_traceidratio", "always_on", "always_off"].includes(samplerName)) {
    throw new Error(
      "OTEL_TRACES_SAMPLER must be parentbased_traceidratio, always_on, or always_off.",
    )
  }
  const ratioText = env.OTEL_TRACES_SAMPLER_ARG ?? "1"
  const ratio = Number(ratioText)
  if (!ratioText.trim() || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error("OTEL_TRACES_SAMPLER_ARG must be a number between 0 and 1.")
  }
  const serviceName = env.OTEL_SERVICE_NAME ?? "replica-hub"
  if (!serviceName.trim() || !/^[\x20-\x7e]{1,100}$/.test(serviceName)) {
    throw new Error("OTEL_SERVICE_NAME must contain 1 through 100 printable characters.")
  }

  const exporter = new OTLPTraceExporter({
    url: url.href,
    headers,
    timeoutMillis: 2_000,
  })
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    sampler:
      samplerName === "always_on"
        ? new AlwaysOnSampler()
        : samplerName === "always_off"
          ? new AlwaysOffSampler()
          : new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    spanLimits: { attributeCountLimit: 16, attributeValueLengthLimit: 100 },
    spanProcessors: [
      new BatchSpanProcessor({
        exporter,
        maxQueueSize: 256,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 1_000,
        exportTimeoutMillis: 2_000,
      }),
    ],
  })
  const manager = new AsyncLocalStorageContextManager().enable()
  if (!context.setGlobalContextManager(manager)) {
    manager.disable()
    void provider.shutdown().catch(() => {
      logger.error("Telemetry initialization cleanup failed.")
    })
    throw new Error("A telemetry context manager is already registered.")
  }
  if (!trace.setGlobalTracerProvider(provider)) {
    context.disable()
    manager.disable()
    void provider.shutdown().catch(() => {
      logger.error("Telemetry initialization cleanup failed.")
    })
    throw new Error("A telemetry provider is already registered.")
  }
  // SDK diagnostics may include recipient credentials or private exception text.
  diag.setLogger(
    {
      error() {
        logger.error("Telemetry export failed; spans may have been dropped.")
      },
      warn() {
        logger.warn("Telemetry SDK warning; check telemetry configuration and delivery.")
      },
      info() {},
      debug() {},
      verbose() {},
    },
    DiagLogLevel.WARN,
  )
  started = true
  let shutdown: Promise<void> | undefined

  return {
    shutdown() {
      shutdown ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            provider.shutdown(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error()), 5_000)
            }),
          ])
        } catch {
          logger.error(
            "Telemetry shutdown failed or exceeded its deadline; pending spans may be lost.",
          )
          throw new Error("Telemetry shutdown failed or exceeded its deadline.")
        } finally {
          clearTimeout(timer)
          trace.disable()
          context.disable()
          manager.disable()
          diag.disable()
          started = false
        }
      })()
      return shutdown
    },
  }
}
