import { PassThrough, Writable } from "node:stream"
import { setTimeout } from "node:timers/promises"
import { createElement } from "react"
import { render } from "ink"

import { TerminalShell } from "../terminal/shell/index.tsx"
import { configurationFields } from "../config/fields/index.ts"
import { formatDeploymentSummary } from "../deployment-summary/index.ts"
import type { DeploymentResult } from "../../azure/install/types.ts"
import type { Question, TerminalView } from "../terminal/view.ts"
import type { Scene } from "./types.ts"

function receipt(part: "primary" | "remaining") {
  const subscriptionId = "22222222-2222-4222-8222-222222222222"
  const resource = (group: string, type = "", name = "") =>
    `/subscriptions/${subscriptionId}/resourceGroups/replica-demo-${group}${type ? `/providers/${type}/${name}` : ""}`
  const result: DeploymentResult = {
    name: "replica-demo",
    url: "https://replica-demo.example.invalid",
    subscriptionId,
    tenantId: "11111111-1111-4111-8111-111111111111",
    location: "westus2",
    image: `replicademo.azurecr.io/replica-hub@sha256:${"a".repeat(64)}`,
    resources: {
      resourceGroup: resource("hub"),
      app: resource("hub", "Microsoft.App/containerApps", "replica-demo-hub"),
      environment: resource("hub", "Microsoft.App/managedEnvironments", "replica-demo-environment"),
      database: resource("hub", "Microsoft.DBforPostgreSQL/flexibleServers", "replica-demo-postgres"),
      storage: resource("hub", "Microsoft.Storage/storageAccounts", "replicademohub"),
      registry: resource("foundation", "Microsoft.ContainerRegistry/registries", "replicademo"),
      vault: resource("foundation", "Microsoft.KeyVault/vaults", "replica-demo-vault"),
      stateStorage: resource("state", "Microsoft.Storage/storageAccounts", "replicastatedemo"),
    },
  }
  const summary = formatDeploymentSummary(result, "/demo/replica/infrastructure/.local/installation.json")
  const split = summary.indexOf("Container registry:")
  if (split < 0) throw new Error("Receipt layout changed. Review the two receipt scenes.")
  return part === "primary" ? `$ npm run setup:server\n\n${summary.slice(0, split)}` : summary.slice(split)
}

function question(scene: Scene): Question | undefined {
  const resolve = () => {}
  switch (scene.kind) {
    case "cloud": return { kind: "cloud", resolve }
    case "text": return { kind: "text", message: scene.message, initial: scene.initial ?? "", resolve }
    case "field":
      if (!scene.field) throw new Error(`Missing field for ${scene.id}.`)
      return { kind: "field", field: configurationFields[scene.field], initial: scene.initial ?? "", resolve }
    case "select":
      if (!scene.options?.length) throw new Error(`Missing options for ${scene.id}.`)
      return { kind: "select", message: scene.message, options: scene.options, resolve }
    case "confirm": return { kind: "confirm", message: scene.message, resolve }
    case "wait": return { kind: "wait", message: scene.message, resolve }
    case "progress":
    case "shell": return undefined
  }
}

export async function renderScene(scene: Scene): Promise<string> {
  if (scene.kind === "shell") return scene.receipt ? receipt(scene.receipt) : scene.message
  const chunks: string[] = []
  const stdout = Object.assign(new Writable({
    write(chunk: Buffer, _encoding, done) { chunks.push(chunk.toString()); done() },
  }), { columns: scene.columns, rows: scene.rows, isTTY: true, getColorDepth: () => 24 })
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin,
  })
  let failure: Error | undefined
  let view: TerminalView = {
    question: question(scene), revision: 1, feedback: 0,
    history: scene.history ?? (scene.kind === "progress" ? [scene.message] : []),
    notice: scene.notice, phase: scene.phase, complete: scene.complete ?? false,
    welcome: scene.welcome ?? false,
  }
  const started = performance.now()
  const element = () => createElement(TerminalShell, {
    view, started, fullscreen: scene.fullscreen ?? true, configureOnly: scene.configureOnly ?? false,
    cancel() { failure = new Error(`Unexpected cancellation in ${scene.id}.`) },
    fail(error) { failure = error },
    edit() {},
    feedback() { view = { ...view, feedback: view.feedback + 1 }; instance.rerender(element()) },
  })
  const instance = render(element(), {
    stdout, stdin, stderr: stdout, patchConsole: false, exitOnCtrlC: false,
    interactive: true, isScreenReaderEnabled: false, kittyKeyboard: { mode: "disabled" },
  })
  try {
    await setTimeout(50)
    await instance.waitUntilRenderFlush()
    for (const input of scene.inputs ?? []) {
      stdin.write(input)
      await setTimeout(50)
      await instance.waitUntilRenderFlush()
    }
    if (failure) throw failure
    const ansi = chunks.join("")
    if (!ansi.trim()) throw new Error(`No rendered output for ${scene.id}.`)
    return ansi
  } finally {
    instance.unmount()
    await instance.waitUntilExit()
    instance.cleanup()
    stdin.destroy()
    stdout.destroy()
  }
}
