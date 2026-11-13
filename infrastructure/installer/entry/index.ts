import { randomUUID } from "node:crypto"
import { lstat, readdir } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import { assertDraftMatchesConfig, loadConfig } from "../config/index.ts"
import { InputValidationError } from "../config/fields/index.ts"
import { privateDirectory } from "../private-files/index.ts"
import { readSession, type WizardDraft, type WizardSession } from "../session/index.ts"
import type { DeploymentConfig, RemovalTarget, WizardUI } from "../types.ts"

export interface SetupEntry {
  action: "create" | "update" | "resume"
  path: string
  existing?: DeploymentConfig
  draft?: WizardDraft
}

export type InstallerEntry =
  | SetupEntry
  | {
      action: "remove"
      path: string
      target: RemovalTarget
    }

interface Candidate {
  path: string
  existing?: DeploymentConfig
  draft?: WizardDraft
  problem?: string
}

function configPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new InputValidationError(
      "Enter a config-file path without surrounding whitespace or control characters.",
    )
  return resolve(value)
}

function attention(ui: WizardUI, message: string): void {
  if (ui.notice) ui.notice("error", message)
  else ui.status(message)
}

async function inspect(path: string): Promise<Candidate> {
  let existing: DeploymentConfig | undefined
  let problem: string | undefined
  try {
    existing = await loadConfig(path)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      if (!(error instanceof Error)) throw error
      problem = `Configuration at ${path} needs attention: it is unreadable, untrusted, invalid, or unsupported. The file was preserved.`
    }
  }
  const session = await readSession(path)
  problem ??= session.problem
  if (!problem && existing) {
    try {
      assertDraftMatchesConfig(existing, session.draft)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      problem = `${path} needs attention. ${error.message}`
    }
  }
  if (!problem && !existing && session.draft?.deploymentStarted)
    problem = `The interrupted deployment at ${path} needs its saved configuration restored before resuming. The draft was preserved; do not start with empty state.`
  return { path, existing, draft: session.draft, problem }
}

function label(candidate: Candidate): string {
  const { path, existing, draft, problem } = candidate
  const name = existing?.name ?? draft?.answers.name ?? "not named"
  const subscription =
    existing?.azure.subscriptionId ?? draft?.answers.subscriptionId ?? "not selected"
  const region = existing?.azure.location ?? draft?.answers.location ?? "not selected"
  const state = problem
    ? "needs attention"
    : draft
      ? `unfinished setup; saved ${draft.updatedAt}`
      : existing
        ? "saved configuration; deployment not verified"
        : "configuration not found"
  return `${name} | subscription ${subscription} | region ${region} | ${path} | ${state}`
}

async function discover(ui: WizardUI, directory: string, known: Set<string>): Promise<Candidate[]> {
  const paths = new Set<string>()
  try {
    if (await privateDirectory(directory, { create: false })) {
      for (const file of await readdir(directory)) {
        if (file.endsWith(".draft.json"))
          paths.add(join(directory, file.slice(0, -".draft.json".length)))
        else if (file.endsWith(".json")) paths.add(join(directory, file))
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    attention(ui, `Local configurations in ${directory} need attention. ${error.message}`)
  }
  for (const path of known) paths.add(path)
  const candidates = await Promise.all([...paths].sort().map(inspect))
  for (const candidate of candidates) {
    if (candidate.problem) attention(ui, candidate.problem)
  }
  return candidates
}

async function unused(path: string): Promise<boolean> {
  for (const target of [
    path,
    `${path}.draft.json`,
    `${path}.draft.json.lock`,
    `${path}.draft.json.lock.recovery`,
  ]) {
    try {
      await lstat(target)
      return false
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }
  return true
}

export async function selectInstallerEntry(
  ui: WizardUI,
  {
    directory,
    configPath: explicitPath,
    configureOnly = false,
  }: {
    directory: string
    configPath?: string
    configureOnly?: boolean
  },
): Promise<InstallerEntry | undefined> {
  directory = resolve(directory)
  const explicit = explicitPath === undefined ? undefined : configPath(explicitPath)
  const known = new Set(explicit ? [explicit] : [])
  ui.welcome?.(true)
  while (true) {
    ui.removal?.(false)
    const candidates = await discover(ui, directory, known)
    const resumable = candidates.some(({ draft, problem }) => draft && !problem)
    const action = await ui.select(
      "What would you like to do? Saved files do not prove that Azure is deployed.",
      [
        { label: "Create a new installation", value: "create" },
        { label: "Update existing installation", value: "update" },
        ...(!configureOnly
          ? [{ label: "Remove an installation (destructive)", value: "remove" }]
          : []),
        ...(resumable ? [{ label: "Resume in progress setup", value: "resume" }] : []),
        { label: "Exit and do nothing", value: "exit" },
      ],
    )
    if (action === "exit") return undefined
    if (action === "remove") {
      if (configureOnly) throw new Error("Configuration-only mode cannot remove deployments.")
      ui.removal?.(true)
      while (true) {
        const discovered = await discover(ui, directory, known)
        const available = discovered.filter((candidate) => candidate.existing && !candidate.problem)
        const choice = await ui.select(
          [
            "Choose one installation to remove. Saved files do not prove cloud resources exist.",
            ...discovered
              .filter(({ problem }) => problem)
              .map((candidate) => `Not selectable: ${label(candidate)}`),
          ].join("\n"),
          [
            ...available.map((candidate) => ({ label: label(candidate), value: candidate.path })),
            { label: "Enter another config-file path", value: "config-file" },
            { label: "Back to main menu (no removal)", value: "back" },
          ],
        )
        if (choice === "back") break
        let previous: Candidate | undefined
        let path: string
        if (choice === "config-file") {
          try {
            path = configPath(await ui.text("Config-file path"))
            known.add(path)
            previous = await inspect(path)
            if (!previous.existing || previous.problem) {
              attention(ui, previous.problem ?? "A complete saved configuration is required.")
              continue
            }
          } catch (error) {
            if (!(error instanceof InputValidationError)) throw error
            attention(ui, error.message)
            continue
          }
        } else {
          previous = available.find(({ path }) => path === choice)
          if (!previous) throw new Error("Select only listed deployment configurations.")
          path = choice
        }
        const current = await inspect(path)
        if (
          !current.existing ||
          current.problem ||
          JSON.stringify(current.existing) !== JSON.stringify(previous.existing)
        )
          throw new Error(
            "Selected configuration changed or needs attention. Removal was not started.",
          )
        return { action: "remove", path, target: { path, config: current.existing } }
      }
      continue
    }
    if (action === "create") {
      let path = explicit
      if (!path || !(await unused(path))) {
        do {
          path = join(explicit ? dirname(explicit) : directory, `installation-${randomUUID()}.json`)
        } while (!(await unused(path)))
      }
      ui.status(
        `New installation configuration: ${path}. Previous configurations and drafts will be kept.`,
      )
      return { action, path }
    }
    if (action !== "update" && action !== "resume")
      throw new Error("Choose a supported installer entry action.")
    if (action === "resume" && !resumable)
      throw new Error("There is no compatible unfinished setup to resume.")
    while (true) {
      const choice = await ui.select(
        action === "resume"
          ? "Choose unfinished setup. Access and deployment/recovery consent will be checked again."
          : "Choose saved configuration. Its installation identity, owner, and target stay fixed.",
        [
          ...candidates
            .filter(({ draft, problem }) => action === "update" || draft || problem)
            .map((candidate) => ({ label: label(candidate), value: candidate.path })),
          { label: "Enter a config-file path", value: "config-file" },
          { label: "Back to entry menu", value: "back" },
        ],
      )
      if (choice === "back") break
      let path: string
      if (choice === "config-file") {
        const definition = {
          id: "config-path",
          label: "Config-file path",
          help: "Use an absolute path, or a path relative to infrastructure/ with the root shortcut. Resume uses its companion <config path>.draft.json.",
          parse: configPath,
        }
        if (ui.field) path = configPath(await ui.field(definition, explicit))
        else {
          const value = await ui.text(definition.label, explicit)
          try {
            path = configPath(value)
          } catch (error) {
            if (!(error instanceof InputValidationError)) throw error
            attention(ui, error.message)
            continue
          }
        }
      } else {
        if (!candidates.some((candidate) => candidate.path === choice))
          throw new Error("Choose a listed configuration or enter a config-file path.")
        path = choice
      }
      const candidate = await inspect(path)
      known.add(path)
      const problem =
        candidate.problem ??
        (action === "update"
          ? !candidate.existing
            ? `No complete configuration was found at ${path}. Existing files were preserved.`
            : candidate.draft
              ? `Unfinished setup exists at ${path}. Choose Resume in progress setup instead; the draft was preserved.`
              : undefined
          : !candidate.draft
            ? `No compatible unfinished setup was found at ${path}. Existing files were preserved.`
            : undefined)
      if (problem) {
        attention(ui, problem)
        if (action === "update" && candidate.draft && !candidate.problem) break
        continue
      }
      ui.status(label(candidate))
      if (candidate.existing)
        ui.status(
          `Fixed installation: ${candidate.existing.name}; owner: ${candidate.existing.owner}; Azure tenant: ${candidate.existing.azure.tenantId}; subscription: ${candidate.existing.azure.subscriptionId}; region: ${candidate.existing.azure.location}; app resource group: ${candidate.existing.azure.resourceGroup}.`,
        )
      return { action, path, existing: candidate.existing, draft: candidate.draft }
    }
  }
}

export async function validateInstallerEntry(
  entry: InstallerEntry,
  session: WizardSession,
): Promise<void> {
  if (entry.action === "remove")
    throw new Error(
      "A removal target requires destructive-flow validation, not setup-session activation.",
    )
  const current = await inspect(entry.path)
  if (
    current.problem ||
    session.problem ||
    JSON.stringify(current.existing) !== JSON.stringify(entry.existing) ||
    JSON.stringify(current.draft) !== JSON.stringify(entry.draft) ||
    JSON.stringify(session.draft) !== JSON.stringify(entry.draft)
  )
    throw new Error(
      `Selected setup files at ${entry.path} changed or need attention. They were preserved. Restart to review them before continuing.`,
    )
}
