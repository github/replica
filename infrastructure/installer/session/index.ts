import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { configurationFields, InputValidationError } from "../config/fields/index.ts"
import { wizardPhases, type WizardPhase } from "../types.ts"
import { writePrivateJson } from "../write-private-json/index.ts"
import { lockSession } from "./lock/index.ts"

export interface DraftAnswers {
  cloud?: "azure"
  tenantId?: string
  subscriptionId?: string
  location?: string
  name?: string
  owner?: string
  resourceGroup?: string
  useProxy?: boolean
  npmRegistry?: string
}

export interface WizardDraft {
  version: 1
  id: string
  configPath: string
  createdAt: string
  updatedAt: string
  phase: WizardPhase
  deploymentStarted: boolean
  answers: DraftAnswers
}

export interface WizardSession {
  readonly path: string
  readonly draft: WizardDraft | undefined
  readonly problem: string | undefined
  answer<K extends keyof DraftAnswers>(key: K, value: DraftAnswers[K]): Promise<void>
  clear(keys: (keyof DraftAnswers)[]): Promise<void>
  phase(phase: WizardPhase): Promise<void>
  restart(): Promise<void>
  complete(): Promise<void>
  close(): Promise<void>
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const answerKeys = [
  "cloud",
  "tenantId",
  "subscriptionId",
  "location",
  "name",
  "owner",
  "resourceGroup",
  "useProxy",
  "npmRegistry",
] as const
const dependencies: Partial<Record<keyof DraftAnswers, (keyof DraftAnswers)[]>> = {
  tenantId: ["subscriptionId", "location"],
  subscriptionId: ["location"],
  name: ["resourceGroup"],
  useProxy: ["npmRegistry"],
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputValidationError("Draft must contain documented JSON objects.")
  }
  return value as Record<string, unknown>
}

function parseAnswer(key: keyof DraftAnswers, value: unknown): string | boolean {
  if (key in configurationFields) {
    return configurationFields[key as keyof typeof configurationFields].parse(value)
  }
  if (key === "cloud" && value === "azure") return value
  if (key === "useProxy" && typeof value === "boolean") return value
  if (
    (key === "tenantId" || key === "subscriptionId") &&
    typeof value === "string" &&
    uuid.test(value)
  )
    return value
  if (key === "location" && typeof value === "string" && /^[a-z][a-z0-9]+$/.test(value))
    return value
  throw new InputValidationError(
    "Draft answer is invalid. Only documented non-secret settings may be saved.",
  )
}

function parseDraft(value: unknown, configPath: string): WizardDraft {
  const data = object(value)
  const phase = wizardPhases.find((phase) => phase === data.phase)
  const keys = [
    "version",
    "id",
    "configPath",
    "createdAt",
    "updatedAt",
    "phase",
    "deploymentStarted",
    "answers",
  ]
  if (
    Object.keys(data).some((key) => !keys.includes(key)) ||
    data.version !== 1 ||
    data.configPath !== configPath ||
    typeof data.id !== "string" ||
    !uuid.test(data.id) ||
    typeof data.createdAt !== "string" ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    typeof data.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(data.updatedAt)) ||
    typeof data.deploymentStarted !== "boolean" ||
    !phase
  ) {
    throw new InputValidationError(
      "Draft version, configuration path, or session metadata is not supported.",
    )
  }
  const rawAnswers = object(data.answers)
  if (Object.keys(rawAnswers).some((key) => !answerKeys.some((allowed) => allowed === key))) {
    throw new InputValidationError(
      "Draft contains unknown settings. Only documented non-secret answers are supported.",
    )
  }
  const answers: DraftAnswers = {}
  for (const key of answerKeys) {
    if (Object.hasOwn(rawAnswers, key))
      Object.assign(answers, { [key]: parseAnswer(key, rawAnswers[key]) })
  }
  return {
    version: 1,
    id: data.id,
    configPath,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    phase,
    deploymentStarted: data.deploymentStarted || ["provision", "release", "verify"].includes(phase),
    answers,
  }
}

export async function openSession(configurationPath: string): Promise<WizardSession> {
  const configPath = resolve(configurationPath)
  const path = `${configPath}.draft.json`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const release = await lockSession(`${path}.lock`)
  let draft: WizardDraft | undefined
  let problem: string | undefined
  try {
    const metadata = await lstat(path)
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
      throw new InputValidationError("Draft must be a private regular file (permissions 0600).")
    }
    draft = parseDraft(JSON.parse(await readFile(path, "utf8")), configPath)
  } catch (error) {
    if (error instanceof InputValidationError || error instanceof SyntaxError) {
      problem = `The saved session at ${path} is invalid, unsupported, or belongs to another configuration. It has been preserved.`
    } else if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      await release()
      throw error
    }
  }
  let pending = Promise.resolve()
  let closed = false
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(async () => {
      if (closed) throw new Error("The setup session is closed.")
      return action()
    })
    pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const update = (change: (next: WizardDraft) => void) =>
    enqueue(async () => {
      if (problem) throw new Error("Resolve the preserved draft before saving this session.")
      const now = new Date().toISOString()
      const next = structuredClone(
        draft ??
          ({
            version: 1,
            id: randomUUID(),
            configPath,
            createdAt: now,
            updatedAt: now,
            phase: "cloud",
            deploymentStarted: false,
            answers: {},
          } satisfies WizardDraft),
      )
      change(next)
      next.updatedAt = now
      const checked = parseDraft(next, configPath)
      await writePrivateJson(path, checked)
      draft = checked
    })
  return {
    path,
    get draft() {
      return draft && structuredClone(draft)
    },
    get problem() {
      return problem
    },
    answer: (key, value) =>
      update((next) => {
        if (!answerKeys.some((allowed) => allowed === key)) {
          throw new InputValidationError("Unknown draft answer.")
        }
        const checked = parseAnswer(key, value)
        if (next.answers[key] !== checked) {
          for (const dependent of dependencies[key] ?? []) delete next.answers[dependent]
        }
        Object.assign(next.answers, { [key]: checked })
      }),
    clear: (keys) =>
      update((next) => {
        for (const key of keys) {
          delete next.answers[key]
          for (const dependent of dependencies[key] ?? []) delete next.answers[dependent]
        }
      }),
    phase: (phase) =>
      update((next) => {
        next.phase = phase
        if (["provision", "release", "verify"].includes(phase)) next.deploymentStarted = true
      }),
    restart: () =>
      enqueue(async () => {
        if (problem) await rename(path, `${path}.preserved-${randomUUID()}`)
        else await rm(path, { force: true })
        draft = undefined
        problem = undefined
      }),
    complete: () =>
      enqueue(async () => {
        if (problem) throw new Error("The preserved draft has not been resolved.")
        await rm(path, { force: true })
        draft = undefined
      }),
    close: async () => {
      await pending
      if (!closed) {
        closed = true
        await release()
      }
    },
  }
}
