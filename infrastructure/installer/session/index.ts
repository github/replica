import { randomUUID } from "node:crypto"
import { lstat, rename, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { configurationFields, InputValidationError, parseAzureId } from "../config/fields/index.ts"
import { wizardPhases, type WizardPhase } from "../types.ts"
import { writePrivateJson } from "../write-private-json/index.ts"
import { lockSession } from "./lock/index.ts"
import { privateDirectory, readPrivateFile } from "../private-files/index.ts"

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
  if (key === "tenantId" || key === "subscriptionId") return parseAzureId(value)
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

export async function readSession(
  configurationPath: string,
): Promise<{ draft?: WizardDraft; problem?: string }> {
  const configPath = resolve(configurationPath)
  const path = `${configPath}.draft.json`
  try {
    const content = await readPrivateFile(path, { createDirectory: false })
    return content === undefined ? {} : { draft: parseDraft(JSON.parse(content), configPath) }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return {
      problem: `The saved session at ${path} needs attention: it is unreadable, untrusted, invalid, unsupported, or belongs to another configuration. It has been preserved.`,
    }
  }
}

export async function openSession(
  configurationPath: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<WizardSession> {
  const configPath = resolve(configurationPath)
  const path = `${configPath}.draft.json`
  await privateDirectory(dirname(path))
  const release = await lockSession(`${path}.lock`, { fresh })
  let state: Awaited<ReturnType<typeof readSession>>
  try {
    if (fresh) {
      for (const target of [configPath, path, `${path}.lock.recovery`]) {
        try {
          await lstat(target)
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
          throw error
        }
        throw new Error(
          `New setup path is already in use: ${target}. Existing files were preserved.`,
        )
      }
    }
    state = await readSession(configPath)
  } catch (error) {
    await release()
    throw error
  }
  let { draft, problem } = state
  const checkCurrentDraft = async () => {
    const current = await readSession(configPath)
    if (current.problem || JSON.stringify(current.draft) !== JSON.stringify(draft))
      throw new Error(
        `The saved draft at ${path} changed or needs attention. It was preserved. Close setup and review the files before restarting.`,
      )
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
      await checkCurrentDraft()
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
      await writePrivateJson(path, checked, { exclusive: !draft })
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
        else {
          await checkCurrentDraft()
          await rm(path, { force: true })
        }
        draft = undefined
        problem = undefined
      }),
    complete: () =>
      enqueue(async () => {
        if (problem) throw new Error("The preserved draft has not been resolved.")
        await checkCurrentDraft()
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
