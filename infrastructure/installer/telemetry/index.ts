import { randomUUID } from "node:crypto"
import { closeSync, fsyncSync, openSync, writeFileSync } from "node:fs"
import { lstat, mkdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { ROOT_CONTEXT, SpanStatusCode, trace, type Span } from "@opentelemetry/api"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { AlwaysOnSampler, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace"
import pino from "pino"

import { CommandExecutionError } from "../command/index.ts"
import { describeCommand } from "../command/describe/index.ts"
import {
  wizardPhases,
  type InstallerUI,
  type RunCommand,
  type WizardPhase,
  type WizardUI,
} from "../types.ts"

export async function startInstallerTelemetry(configurationPath: string) {
  const directory = join(dirname(resolve(configurationPath)), "logs")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const metadata = await lstat(directory)
  if (!metadata.isDirectory() || (metadata.mode & 0o077) !== 0)
    throw new Error("Installer diagnostics require a private, non-symlink logs directory (0700).")
  const runId = randomUUID()
  const path = join(directory, `${new Date().toISOString().replaceAll(":", "-")}-${runId}.jsonl`)
  const descriptor = openSync(path, "wx", 0o600)
  let exportFailure: unknown
  const logger = pino(
    { base: null, timestamp: pino.stdTimeFunctions.isoTime },
    {
      write(line: string) {
        writeFileSync(descriptor, line)
        fsyncSync(descriptor)
      },
    },
  )
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ "service.name": "replica-installer" }),
    sampler: new AlwaysOnSampler(),
    spanProcessors: [
      new SimpleSpanProcessor({
        exporter: {
          export(spans, callback) {
            try {
              for (const span of spans) {
                const attributes: Record<string, string | number | boolean> = {}
                for (const key of ["phase", "exit_code", "outcome"]) {
                  const value = span.attributes[key]
                  if (
                    typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean"
                  )
                    attributes[key] = value
                }
                logger.info({
                  event: "span.completed",
                  run_id: runId,
                  name: span.name,
                  trace_id: span.spanContext().traceId,
                  span_id: span.spanContext().spanId,
                  parent_span_id: span.parentSpanContext?.spanId,
                  duration_ms: span.duration[0] * 1_000 + span.duration[1] / 1_000_000,
                  status: span.status.code === SpanStatusCode.ERROR ? "error" : "ok",
                  attributes,
                })
              }
              callback({ code: 0 })
            } catch (error) {
              exportFailure = error
              callback({ code: 1 })
            }
          },
          async shutdown() {},
        },
      }),
    ],
  })
  const tracer = provider.getTracer("replica-installer")
  const root = tracer.startSpan("installer.run", {}, ROOT_CONTEXT)
  const rootContext = trace.setSpan(ROOT_CONTEXT, root)
  let phase: { name: WizardPhase; span: Span } | undefined
  let closing: Promise<void> | undefined

  function started(span: Span, name: string, parent?: Span) {
    if (exportFailure) throw exportFailure
    logger.info({
      event: "step.started",
      run_id: runId,
      name,
      trace_id: span.spanContext().traceId,
      span_id: span.spanContext().spanId,
      parent_span_id: parent?.spanContext().spanId,
    })
  }
  function finish(span: Span, failed = false, error?: unknown) {
    span.setStatus({ code: failed ? SpanStatusCode.ERROR : SpanStatusCode.OK })
    span.setAttribute(
      "outcome",
      failed
        ? error instanceof CommandExecutionError && error.aborted
          ? "cancelled"
          : error instanceof DOMException && error.name === "AbortError"
            ? "cancelled"
            : "failed"
        : "completed",
    )
    if (
      error instanceof CommandExecutionError &&
      Number.isInteger(error.exitCode) &&
      error.exitCode !== undefined
    )
      span.setAttribute("exit_code", error.exitCode)
    span.end()
  }
  function setPhase(name: WizardPhase) {
    if (!wizardPhases.includes(name)) throw new Error("Unknown installer diagnostics phase.")
    if (phase?.name === name) return
    if (phase) finish(phase.span)
    const span = tracer.startSpan(
      `installer.phase.${name}`,
      { attributes: { phase: name } },
      rootContext,
    )
    phase = { name, span }
    started(span, `installer.phase.${name}`, root)
  }
  async function step<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
    if (closing) throw new Error("Installer diagnostics are already closed.")
    const parent = phase?.span ?? root
    const span = tracer.startSpan(name, {}, trace.setSpan(ROOT_CONTEXT, parent))
    started(span, name, parent)
    try {
      const result = await operation()
      finish(span)
      return result
    } catch (error) {
      finish(span, true, error)
      throw error
    }
  }

  function observe(ui: WizardUI): WizardUI
  function observe(ui: InstallerUI): InstallerUI
  function observe(ui: InstallerUI & Partial<WizardUI>): InstallerUI & Partial<WizardUI> {
    const { cloud, text, field, select, multiSelect } = ui
    return {
      ...ui,
      async phase(name) {
        await ui.phase?.(name)
        setPhase(name)
      },
      confirm: (message) => step("installer.prompt.confirm", () => ui.confirm(message)),
      wait: (message) => step("installer.prompt.wait", () => ui.wait(message)),
      ...(cloud && { cloud: () => step("installer.prompt.cloud", () => cloud.call(ui)) }),
      ...(text && {
        text: (message: string, initial?: string) =>
          step("installer.prompt.text", () => text.call(ui, message, initial)),
      }),
      ...(select && {
        select: (message: string, options: { label: string; value: string }[]) =>
          step("installer.prompt.select", () => select.call(ui, message, options)),
      }),
      ...(multiSelect && {
        multiSelect: (
          message: string,
          options: { label: string; value: string }[],
          initial?: string[],
        ) =>
          step("installer.prompt.multi_select", () =>
            multiSelect.call(ui, message, options, initial),
          ),
      }),
      ...(field && {
        field: (definition: Parameters<NonNullable<WizardUI["field"]>>[0], initial?: string) => {
          const names: Record<string, string> = {
            name: "name",
            owner: "owner",
            resourceGroup: "resource_group",
            npmRegistry: "npm_registry",
          }
          const id = Object.hasOwn(names, definition.id) ? names[definition.id] : "field"
          return step(`installer.prompt.${id}`, () => field.call(ui, definition, initial))
        },
      }),
    }
  }

  try {
    started(root, "installer.run")
  } catch (error) {
    closeSync(descriptor)
    await provider.shutdown()
    throw error
  }
  return {
    path,
    observe,
    command(run: RunCommand): RunCommand {
      return (executable, args, options) =>
        step(`installer.command.${describeCommand(executable, args).name}`, () =>
          run(executable, args, options),
        )
    },
    close(error?: unknown): Promise<void> {
      closing ??= (async () => {
        try {
          if (phase) finish(phase.span, error !== undefined, error)
          finish(root, error !== undefined, error)
          await provider.forceFlush({ timeoutMillis: 2_000 })
          if (exportFailure) throw exportFailure
        } finally {
          try {
            await provider.shutdown()
          } finally {
            closeSync(descriptor)
          }
        }
      })()
      return closing
    },
  }
}
