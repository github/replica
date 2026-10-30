import { context, diag, propagation, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace"
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest"

vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: vi.fn(),
}))

function resetGlobals() {
  trace.disable()
  context.disable()
  diag.disable()
  propagation.disable()
}

function mockTransport() {
  const spans: ReadableSpan[] = []
  const shutdown = vi.fn(async () => {})
  const exportSpans = vi.fn<SpanExporter["export"]>((batch, callback) => {
    spans.push(...batch)
    callback({ code: 0 })
  })
  vi.mocked(OTLPTraceExporter).mockImplementation(
    class {
      export = exportSpans
      shutdown = shutdown
      forceFlush = async () => {}
    } as unknown as typeof OTLPTraceExporter,
  )
  return { spans, shutdown, exportSpans }
}

async function settleShutdown(telemetry: { shutdown(): Promise<void> }) {
  try {
    await telemetry.shutdown()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toMatch(/secret|https:|private\.example/)
  }
}

function expectSafeLogs(calls: unknown[][]) {
  expect(calls.length).toBeGreaterThan(0)
  for (const call of calls) expect(call).toEqual([expect.any(String)])
  expect(JSON.stringify(calls)).not.toMatch(/secret|https:|private\.example/)
}

beforeEach(resetGlobals)
afterEach(resetGlobals)

describe("startTelemetry()", () => {
  it.each([
    {},
    { OTEL_TRACES_EXPORTER: "none", OTEL_EXPORTER_OTLP_ENDPOINT: "invalid" },
    { OTEL_SDK_DISABLED: "TrUe", OTEL_TRACES_EXPORTER: "invalid" },
  ])("returns an idle synchronous handle when tracing is disabled: %j", async (env) => {
    const logger = { error: vi.fn(), warn: vi.fn() }
    const { startTelemetry } = await import(".")
    const telemetry = startTelemetry(env, logger)
    onTestFinished(() => telemetry.shutdown())

    expect(telemetry).not.toBeInstanceOf(Promise)
    expect(OTLPTraceExporter).not.toHaveBeenCalled()
    await expect(telemetry.shutdown()).resolves.toBeUndefined()
    await expect(telemetry.shutdown()).resolves.toBeUndefined()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("uses explicit trace configuration before common configuration", async () => {
    const transport = mockTransport()
    const { startTelemetry } = await import(".")
    const { withTelemetrySpan } = await import("../with-telemetry-span")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
        OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example/custom/traces",
        OTEL_EXPORTER_OTLP_ENDPOINT: "not-an-endpoint",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer%20test%3Dtoken,x%2Dlabel=a%2Cb",
        OTEL_EXPORTER_OTLP_HEADERS: "invalid",
        OTEL_SERVICE_NAME: "hub-test",
        OTEL_RESOURCE_ATTRIBUTES: "private.secret=resource-secret",
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())

    await withTelemetrySpan("test.operation", {}, () => {})
    await telemetry.shutdown()

    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://collector.example/custom/traces",
        headers: { authorization: "Bearer test=token", "x-label": "a,b" },
      }),
    )
    expect(transport.spans).toHaveLength(1)
    expect(transport.spans[0]?.resource.attributes["service.name"]).toBe("hub-test")
    expect(transport.spans[0]?.resource.attributes).not.toHaveProperty("private.secret")
    expect(JSON.stringify(transport.spans[0]?.resource.attributes)).not.toContain("resource-secret")
  })

  it.each([
    ["https://collector.example", "https://collector.example/v1/traces"],
    ["http://collector.example/base/", "http://collector.example/base/v1/traces"],
  ])("appends the trace path to a common endpoint %s", async (endpoint, expected) => {
    const transport = mockTransport()
    const { startTelemetry } = await import(".")
    const { withTelemetrySpan } = await import("../with-telemetry-span")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_EXPORTER_OTLP_HEADERS: "x-token=test%20value",
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())

    await withTelemetrySpan("test.operation", {}, () => {})
    await telemetry.shutdown()

    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({ url: expected, headers: { "x-token": "test value" } }),
    )
    expect(transport.spans[0]?.resource.attributes["service.name"]).toBe("replica-hub")
  })

  it.each([
    ["unsupported exporter", { OTEL_TRACES_EXPORTER: "secret-exporter" }],
    ["missing endpoint", {}],
    ["relative endpoint", { OTEL_EXPORTER_OTLP_ENDPOINT: "/secret-relative" }],
    ["non-HTTP endpoint", { OTEL_EXPORTER_OTLP_ENDPOINT: "file:///secret-path" }],
    ["credentials", { OTEL_EXPORTER_OTLP_ENDPOINT: "https://secret-user:secret-pass@example.com" }],
    ["query", { OTEL_EXPORTER_OTLP_ENDPOINT: "https://example.com?token=secret-query" }],
    ["fragment", { OTEL_EXPORTER_OTLP_ENDPOINT: "https://example.com/#secret-fragment" }],
    ["trace endpoint without path", { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://example.com" }],
    ["unsupported protocol", { OTEL_EXPORTER_OTLP_PROTOCOL: "secret-protocol" }],
    ["invalid trace protocol", { OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "secret-trace-protocol" }],
    ["missing header assignment", { OTEL_EXPORTER_OTLP_HEADERS: "secret-header" }],
    ["blank header name", { OTEL_EXPORTER_OTLP_HEADERS: "=secret-value" }],
    ["blank header value", { OTEL_EXPORTER_OTLP_HEADERS: "secret-header=" }],
    ["malformed percent encoding", { OTEL_EXPORTER_OTLP_HEADERS: "x-token=%secret" }],
    ["encoded header newline", { OTEL_EXPORTER_OTLP_HEADERS: "x-token=secret%0D%0Avalue" }],
    ["literal header newline", { OTEL_EXPORTER_OTLP_HEADERS: "x-token=secret\r\nvalue" }],
    ["unsupported sampler", { OTEL_TRACES_SAMPLER: "secret-sampler" }],
    ["nonfinite ratio", { OTEL_TRACES_SAMPLER_ARG: "Infinity" }],
    ["negative ratio", { OTEL_TRACES_SAMPLER_ARG: "-0.1" }],
    ["ratio greater than one", { OTEL_TRACES_SAMPLER_ARG: "1.1" }],
    ["nonnumeric ratio", { OTEL_TRACES_SAMPLER_ARG: "secret-ratio" }],
  ])("rejects %s synchronously without leaking supplied configuration", async (_, invalid) => {
    const logger = { error: vi.fn(), warn: vi.fn() }
    const { startTelemetry } = await import(".")
    const env: NodeJS.ProcessEnv = {
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://example.com/secret-base",
      ...invalid,
    }
    if (Object.keys(invalid).length === 0) delete env.OTEL_EXPORTER_OTLP_ENDPOINT
    let thrown: unknown

    try {
      const telemetry = startTelemetry(env, logger)
      onTestFinished(() => telemetry.shutdown())
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).not.toMatch(/secret|https:|file:|Infinity|-0\.1|1\.1/)
    expect(JSON.stringify([logger.error.mock.calls, logger.warn.mock.calls])).not.toContain(
      "secret",
    )
    expect(OTLPTraceExporter).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, undefined, true],
    ["parentbased_traceidratio", "0", false],
    ["parentbased_traceidratio", "1", true],
    ["always_on", undefined, true],
    ["always_off", undefined, false],
  ])("applies sampler %s with ratio %s", async (sampler, ratio, sampled) => {
    const transport = mockTransport()
    const { startTelemetry } = await import(".")
    const { withTelemetrySpan } = await import("../with-telemetry-span")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
        OTEL_TRACES_SAMPLER: sampler,
        OTEL_TRACES_SAMPLER_ARG: ratio,
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())

    await withTelemetrySpan("test.sample", {}, () => {})
    await telemetry.shutdown()

    expect(transport.spans).toHaveLength(sampled ? 1 : 0)
  })

  it("honors an unsampled parent rather than applying the root ratio again", async () => {
    const transport = mockTransport()
    const { startTelemetry } = await import(".")
    const { withTelemetrySpan } = await import("../with-telemetry-span")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())
    const parent = trace.wrapSpanContext({
      traceId: "12345678901234567890123456789012",
      spanId: "1234567890123456",
      traceFlags: TraceFlags.NONE,
      isRemote: true,
    })

    await context.with(trace.setSpan(context.active(), parent), () =>
      withTelemetrySpan("test.child", {}, () => {}),
    )
    await telemetry.shutdown()

    expect(transport.spans).toHaveLength(0)
  })

  it("rejects duplicate initialization and releases its globals without adding signal handlers", async () => {
    const transport = mockTransport()
    const { startTelemetry } = await import(".")
    const { withTelemetrySpan } = await import("../with-telemetry-span")
    const env = {
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
    }
    const logger = { error: vi.fn(), warn: vi.fn() }
    const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]
    const telemetry = startTelemetry(env, logger)
    onTestFinished(() => telemetry.shutdown())

    expect(() => startTelemetry(env, logger)).toThrow()
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signals)
    expect(propagation.fields()).toEqual([])
    expect(transport.spans).toHaveLength(0)
    await withTelemetrySpan("test.first", {}, () => {})
    await Promise.all([telemetry.shutdown(), telemetry.shutdown()])
    expect(transport.shutdown).toHaveBeenCalledTimes(1)
    await withTelemetrySpan("test.disabled", {}, () => {})

    const restarted = startTelemetry(env, logger)
    onTestFinished(() => restarted.shutdown())
    await withTelemetrySpan("test.restarted", {}, () => {})
    await restarted.shutdown()

    expect(transport.spans.map((span) => span.name)).toEqual(["test.first", "test.restarted"])
    expect(context.active()).toBe(ROOT_CONTEXT)
  })

  it("reports failed exports without exposing exporter errors or configuration", async () => {
    const transport = mockTransport()
    transport.exportSpans.mockImplementation((_, callback) =>
      callback({ code: 1, error: new Error("secret-export-token https://private.example") }),
    )
    const logger = { error: vi.fn(), warn: vi.fn() }
    const { startTelemetry } = await import(".")
    const { withTelemetrySpan } = await import("../with-telemetry-span")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://private.example",
        OTEL_EXPORTER_OTLP_HEADERS: "authorization=secret-auth",
      },
      logger,
    )
    onTestFinished(() => settleShutdown(telemetry))

    await withTelemetrySpan("test.export", {}, () => {})
    await expect(telemetry.shutdown()).rejects.toThrow(/shutdown/i)
    await expect(telemetry.shutdown()).rejects.not.toThrow(/secret|https:|private\.example/)

    expectSafeLogs([...logger.error.mock.calls, ...logger.warn.mock.calls])
  })

  it("reports shutdown rejection safely and permits a later initialization", async () => {
    const transport = mockTransport()
    transport.shutdown.mockRejectedValue(new Error("secret-shutdown-token"))
    const logger = { error: vi.fn(), warn: vi.fn() }
    const { startTelemetry } = await import(".")
    const env = {
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
    }
    const telemetry = startTelemetry(env, logger)
    onTestFinished(() => settleShutdown(telemetry))

    await expect(telemetry.shutdown()).rejects.toThrow(/shutdown/i)
    await expect(telemetry.shutdown()).rejects.not.toThrow(/secret|https:|private\.example/)
    expect(transport.shutdown).toHaveBeenCalledTimes(1)
    expectSafeLogs([...logger.error.mock.calls, ...logger.warn.mock.calls])

    transport.shutdown.mockResolvedValue()
    const restarted = startTelemetry(env, logger)
    onTestFinished(() => restarted.shutdown())
    await restarted.shutdown()
  })

  it("bounds shutdown at five seconds when an exporter never settles", async () => {
    vi.useFakeTimers()
    const transport = mockTransport()
    transport.shutdown.mockImplementation(() => new Promise<void>(() => {}))
    const logger = { error: vi.fn(), warn: vi.fn() }
    const { startTelemetry } = await import(".")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
      },
      logger,
    )
    onTestFinished(() => settleShutdown(telemetry))
    const shuttingDown = telemetry.shutdown()
    void shuttingDown.catch(() => {})

    await vi.advanceTimersByTimeAsync(5000)
    await expect(shuttingDown).rejects.toThrow(/shutdown/i)
    await expect(shuttingDown).rejects.not.toThrow(/secret|https:|private\.example/)

    expectSafeLogs([...logger.error.mock.calls, ...logger.warn.mock.calls])
    expect(vi.getTimerCount()).toBe(0)
  })
})
