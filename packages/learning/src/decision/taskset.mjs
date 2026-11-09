import { createHash } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { LearningError } from "../errors.mjs"
import { oneLine } from "../recall.mjs"
import { brandCheckQuestions } from "./questions.mjs"

export const TASK_SCHEMA = "replica.decision-task/v1"
export const TASKSET_SCHEMA = "replica.decision-taskset/v1"
/** The largest image a task may carry: the largest screenshot Hub keeps. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/**
 * Write a planned taskset to a new directory: tasks.jsonl with one task per line, taskset.json,
 * and a copy of every image under images/. Every task asks the same questions, so training sees
 * a page the way the model is asked about one later; only labeled questions earn a reward. A
 * task shows the brand sheet first when there is one, then each screenshot of the page.
 *
 * The directory must not exist. If anything fails, the directory is removed, so a half-written
 * taskset never looks complete.
 *
 * @param {ReturnType<import("./tasks.mjs").planDecisionTasks>} plan
 * @param {{ directory: string, baseDirectory: string, brandSheet?: string, createdAt: string }} options
 *   screenshot paths in the plan, and brandSheet, are resolved from baseDirectory
 */
export async function writeDecisionTaskset(
  plan,
  { directory, baseDirectory, brandSheet, createdAt },
) {
  if (!plan.tasks.length)
    throw new LearningError(
      "invalid_input",
      `No review evidence became a labeled task. ${skippedText(plan.skipped)}`,
    )
  const { questions, rules } = brandCheckQuestions(plan.learnings)
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 })
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code === "EEXIST")
      throw new LearningError("invalid_input", `${directory} already exists. Choose another --out.`)
    throw error
  }
  try {
    await mkdir(path.join(directory, "images"), { mode: 0o700 })
    const reference = brandSheet
      ? await copyImage(
          path.resolve(baseDirectory, brandSheet),
          directory,
          "brand-sheet",
          "reference",
        )
      : null
    const counts = { tasks: 0, train: 0, dev: 0, test: 0, follows: 0, breaks: 0 }
    const lines = []
    for (const task of plan.tasks) {
      const candidates = []
      for (const screenshot of task.screenshots)
        candidates.push({
          ...(await copyImage(
            path.resolve(baseDirectory, screenshot.path),
            directory,
            `${task.id}-${screenshot.size}-${screenshot.theme}`,
            "candidate",
          )),
          size: screenshot.size,
          theme: screenshot.theme,
        })
      lines.push(
        JSON.stringify({
          schemaVersion: TASK_SCHEMA,
          id: task.id,
          split: task.split,
          state: {
            rules,
            imagesNote: imagesNote(task.route, candidates, Boolean(reference)),
          },
          images: reference ? [reference, ...candidates] : candidates,
          questions,
          labels: Object.fromEntries(
            Object.entries(task.labels).map(([learningId, follows]) => [
              learningId,
              { answer: follows },
            ]),
          ),
          provenance: {
            exportId: plan.exportId,
            prototypeId: task.prototypeId,
            buildNumber: task.buildNumber,
            route: task.route,
            evidence: task.evidence,
          },
        }),
      )
      counts.tasks++
      counts[task.split]++
      for (const follows of Object.values(task.labels)) counts[follows ? "follows" : "breaks"]++
    }
    await writeFile(path.join(directory, "tasks.jsonl"), `${lines.join("\n")}\n`, {
      mode: 0o600,
      flag: "wx",
    })
    const manifest = {
      schemaVersion: TASKSET_SCHEMA,
      exportId: plan.exportId,
      scope: plan.scope,
      createdAt,
      learnings: rules.length,
      counts,
      skipped: plan.skipped,
    }
    await writeFile(
      path.join(directory, "taskset.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        mode: 0o600,
        flag: "wx",
      },
    )
    return manifest
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/** Why evidence did not become tasks, for a person reading the refusal. */
export function skippedText(skipped) {
  const reasons = Object.entries(skipped)
  return reasons.length
    ? `Skipped: ${reasons.map(([reason, count]) => `${count} ${reason}`).join(", ")}.`
    : "The export holds no accepted learning with review evidence."
}

/**
 * How a task describes its images, which a request to a trained model must repeat word for word.
 *
 * @param {string} route the page's route
 * @param {Array<{ size: string, theme: string }>} views the page's screenshots, in task order
 * @param {boolean} reference whether the brand reference sheet comes first
 */
export function imagesNote(route, views, reference) {
  const first = reference ? 2 : 1
  const shown = views.map(
    ({ size, theme }, index) => `image ${first + index} at ${size} width in ${theme} theme`,
  )
  const page = `the page at route ${oneLine(route).slice(0, 200)}`
  return `${reference ? "Image 1 is the team's brand reference sheet. " : ""}The candidate is ${page}, shown as ${shown.join(", ")}.`
}

/** Read a PNG, JPEG, or WebP image of at most 25 MiB. */
export async function readImage(source) {
  const extension = path.extname(source).toLowerCase()
  const mediaType = MEDIA_TYPES[extension]
  if (!mediaType)
    throw new LearningError("invalid_input", `${source} must be a PNG, JPEG, or WebP image.`)
  try {
    const info = await stat(source)
    if (!info.isFile()) throw new LearningError("invalid_input", `${source} is not a file.`)
    if (info.size > MAX_IMAGE_BYTES)
      throw new LearningError("invalid_input", `${source} is larger than 25 MiB.`)
    return { bytes: await readFile(source), mediaType, extension }
  } catch (error) {
    if (error instanceof LearningError) throw error
    throw new LearningError("not_found", `Cannot read ${source} (${error.code ?? error.message}).`)
  }
}

async function copyImage(source, directory, name, role) {
  const { bytes, mediaType, extension } = await readImage(source)
  const relative = `images/${name}${extension}`
  await writeFile(path.join(directory, relative), bytes, { mode: 0o600, flag: "wx" })
  return {
    role,
    path: relative,
    mediaType,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  }
}
