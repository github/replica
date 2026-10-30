import { context, diag, propagation, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api"
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
  vi.mocked(OTLPTraceExporter).mockImplementation(
    class {
      export: SpanExporter["export"] = (batch, callback) => {
        spans.push(...batch)
        callback({ code: 0 })
      }
      shutdown = async () => {}
      forceFlush = async () => {}
    } as unknown as typeof OTLPTraceExporter,
  )
  return spans
}

beforeEach(resetGlobals)
afterEach(resetGlobals)

describe("withTelemetrySpan()", () => {
  it("runs operations while disabled and preserves the exact result", async () => {
    const { withTelemetrySpan } = await import(".")
    const result = { id: "result" }
    const operation = vi.fn(() => result)

    await expect(withTelemetrySpan("test.disabled", {}, operation)).resolves.toBe(result)

    expect(operation).toHaveBeenCalledTimes(1)
    expect(OTLPTraceExporter).not.toHaveBeenCalled()
    expect(trace.getActiveSpan()).toBeUndefined()
  })

  it.each([
    ["name containing private data", "test.secret@example.com", {}],
    ["unknown attribute", "test.operation", { "http.url": "https://secret.example" }],
    ["invalid UUID", "test.operation", { "replica.repository.id": "secret-repository" }],
  ])("rejects %s before running an operation, even when disabled", async (_, name, attributes) => {
    const { withTelemetrySpan } = await import(".")
    const operation = vi.fn()
    let thrown: unknown

    try {
      await withTelemetrySpan(
        name,
        attributes as Parameters<typeof withTelemetrySpan>[1],
        operation,
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(String(thrown)).not.toMatch(/secret|https:/)
    expect(operation).not.toHaveBeenCalled()
    expect(OTLPTraceExporter).not.toHaveBeenCalled()
  })

  it("exports approved IDs, preserves the result, and ends successful spans", async () => {
    const spans = mockTransport()
    const { startTelemetry } = await import("../start-telemetry")
    const { withTelemetrySpan } = await import(".")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())
    const attributes = {
      "replica.repository.id": "123e4567-e89b-42d3-a456-426614174000",
      "replica.prototype.id": "123e4567-e89b-42d3-a456-426614174001",
      "replica.build.id": "123e4567-e89b-42d3-a456-426614174002",
      "replica.thread.id": "123e4567-e89b-42d3-a456-426614174003",
      "replica.comment.id": "123e4567-e89b-42d3-a456-426614174004",
    }
    const result = { preserved: true }

    await expect(
      withTelemetrySpan("build.import", attributes, () => Promise.resolve(result)),
    ).resolves.toBe(result)
    await telemetry.shutdown()

    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      attributes,
      status: { code: SpanStatusCode.OK },
      ended: true,
      events: [],
    })
    expect(trace.getActiveSpan()).toBeUndefined()
  })

  it("keeps parents isolated across concurrent async operations and restores the caller context", async () => {
    const spans = mockTransport()
    const { startTelemetry } = await import("../start-telemetry")
    const { withTelemetrySpan } = await import(".")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())
    const firstStarted = { resolve() {} }
    const releaseFirst = { resolve() {} }
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted.resolve = resolve
    })
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst.resolve = resolve
    })

    const first = withTelemetrySpan("test.first", {}, async () => {
      const parent = trace.getActiveSpan()
      firstStarted.resolve()
      await firstCanFinish
      await withTelemetrySpan("test.first.child", {}, async () => {
        await Promise.resolve()
        expect(trace.getActiveSpan()).not.toBe(parent)
      })
      expect(trace.getActiveSpan()).toBe(parent)
    })
    await firstStartedPromise
    expect(trace.getActiveSpan()).toBeUndefined()
    try {
      await withTelemetrySpan("test.second", {}, async () => {
        await Promise.resolve()
        await withTelemetrySpan("test.second.child", {}, () => {})
      })
    } finally {
      releaseFirst.resolve()
      await first
    }
    await telemetry.shutdown()

    const firstParent = spans.find((span) => span.name === "test.first")
    const secondParent = spans.find((span) => span.name === "test.second")
    const firstChild = spans.find((span) => span.name === "test.first.child")
    const secondChild = spans.find((span) => span.name === "test.second.child")
    expect(spans).toHaveLength(4)
    expect(firstParent?.parentSpanContext).toBeUndefined()
    expect(secondParent?.parentSpanContext).toBeUndefined()
    expect(firstChild?.parentSpanContext?.spanId).toBe(firstParent?.spanContext().spanId)
    expect(secondChild?.parentSpanContext?.spanId).toBe(secondParent?.spanContext().spanId)
    expect(firstChild?.spanContext().traceId).toBe(firstParent?.spanContext().traceId)
    expect(secondChild?.spanContext().traceId).toBe(secondParent?.spanContext().traceId)
    expect(firstParent?.spanContext().traceId).not.toBe(secondParent?.spanContext().traceId)
    expect(context.active()).toBe(ROOT_CONTEXT)
  })

  it("rethrows the original operation error, ends the span, and records no failure details", async () => {
    const spans = mockTransport()
    const { startTelemetry } = await import("../start-telemetry")
    const { withTelemetrySpan } = await import(".")
    const telemetry = startTelemetry(
      {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
      },
      { error: vi.fn(), warn: vi.fn() },
    )
    onTestFinished(() => telemetry.shutdown())
    const failure = new Error("secret-error-message")

    const result = withTelemetrySpan("test.failure", {}, async () => {
      await Promise.resolve()
      throw failure
    })

    await expect(result).rejects.toBe(failure)
    await telemetry.shutdown()

    expect(spans).toHaveLength(1)
    expect(spans[0]?.status).toEqual({ code: SpanStatusCode.ERROR })
    expect(spans[0]?.events).toEqual([])
    expect(spans[0]?.attributes).toEqual({})
    expect(spans[0]?.ended).toBe(true)
    expect(
      JSON.stringify(
        spans.map(({ name, attributes, events, status }) => ({
          name,
          attributes,
          events,
          status,
        })),
      ),
    ).not.toContain("secret")
    expect(trace.getActiveSpan()).toBeUndefined()
  })
})
