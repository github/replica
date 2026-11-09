import path from "node:path"
import { LearningError } from "../errors.mjs"
import { oneLine } from "../recall.mjs"
import { imagesNote, readImage } from "./taskset.mjs"

/** A Build's screenshot files, as the build action names them, in the order a task shows them. */
export const BUILD_SCREENSHOTS = Object.freeze([
  { size: "desktop", theme: "light", file: "desktop.png" },
  { size: "desktop", theme: "dark", file: "desktop-dark.png" },
  { size: "narrow", theme: "light", file: "narrow.png" },
  { size: "narrow", theme: "dark", file: "narrow-dark.png" },
])

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])
const TIMEOUT_MS = 120_000

/**
 * The request a deployed decision model answers about one page: the same state, image order, and
 * questions a training task uses, with each image inlined as a data URI.
 *
 * @param {{ questions: Record<string, object>, rules: Array<{ id: string, text: string }> }} asked
 *   the output of `decision questions`
 * @param {{ screenshots: string, route?: string, brandSheet?: string }} options screenshots is a
 *   Build's screenshots folder
 */
export async function decisionRequest(asked, { screenshots, route = "/", brandSheet }) {
  if (
    !asked ||
    typeof asked.questions !== "object" ||
    !Array.isArray(asked.rules) ||
    !asked.rules.length ||
    !asked.rules.every(({ id }) => asked.questions[id]?.type === "noul")
  )
    throw new LearningError(
      "invalid_input",
      "The questions file must be the output of replica-learning decision questions --json, with at least one learning.",
    )
  const views = []
  const images = []
  if (brandSheet) images.push(dataUri(await readImage(brandSheet)))
  for (const view of BUILD_SCREENSHOTS) {
    let image
    try {
      image = await readImage(path.join(screenshots, view.file))
    } catch (error) {
      if (error.code === "not_found") continue
      throw error
    }
    views.push(view)
    images.push(dataUri(image))
  }
  if (!views.length)
    throw new LearningError(
      "not_found",
      `${screenshots} holds none of ${BUILD_SCREENSHOTS.map(({ file }) => file).join(", ")}.`,
    )
  return {
    state: { rules: asked.rules, imagesNote: imagesNote(route, views, Boolean(brandSheet)) },
    images,
    questions: asked.questions,
  }
}

/**
 * Send a request to a deployed decision model, such as `score_d1_omni.py` on a managed online
 * endpoint, and return its answers: the probability of yes for each yes-or-no question, keyed
 * like the questions.
 *
 * @param {{ endpoint: string, key: string, request: object, fetch?: typeof fetch }} options
 */
export async function askDecisionModel({ endpoint, key, request, fetch = globalThis.fetch }) {
  const url = endpointUrl(endpoint)
  const returned = (await post({ url, key, payload: request, fetch }))?.answers
  const answers = {}
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type !== "noul") continue
    // Valid as the environment defines it: a missing option counts as 0, and the values sum to 1.
    const probabilities = returned?.[id]?.probabilities
    const yes = probabilities?.yes ?? 0
    const no = probabilities?.no ?? 0
    if (
      typeof probabilities !== "object" ||
      probabilities === null ||
      Object.keys(probabilities).some((option) => option !== "yes" && option !== "no") ||
      !isProbability(yes) ||
      !isProbability(no) ||
      Math.abs(yes + no - 1) > 0.001
    )
      throw new LearningError(
        "endpoint_failed",
        `${url.origin} did not answer every question with probabilities of yes and no.`,
      )
    answers[id] = { probabilities: { yes: yes / (yes + no), no: no / (yes + no) } }
  }
  return answers
}

function isProbability(value) {
  return typeof value === "number" && value >= 0 && value <= 1
}

/**
 * Ask a chat-completions deployment, such as a vision-language model on Microsoft Foundry managed
 * compute, each yes-or-no question in turn. The probability of yes comes from the log
 * probabilities of its one-word answer, so the deployment must return `logprobs`.
 *
 * @param {{ endpoint: string, key: string, model: string, request: object, fetch?: typeof fetch }} options
 *   endpoint is the OpenAI-compatible base URL, such as https://<account>.services.ai.azure.com/openai/v1
 */
export async function askChatModel({ endpoint, key, model, request, fetch = globalThis.fetch }) {
  const url = new URL(`${endpointUrl(endpoint).href.replace(/\/+$/, "")}/chat/completions`)
  const answers = {}
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type !== "noul") continue
    const body = await post({ url, key, payload: chatRequest(model, request, question), fetch })
    const top = body?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs
    if (!Array.isArray(top) || top.length < 2)
      throw new LearningError(
        "endpoint_failed",
        `${url.origin} did not return the likeliest answers' log probabilities, which the check needs to give a probability.`,
      )
    let yes = 0
    let no = 0
    let least = Infinity
    for (const { token, logprob } of top) {
      if (typeof logprob !== "number" || !(logprob <= 0)) continue
      const probability = Math.exp(logprob)
      least = Math.min(least, probability)
      const word = String(token).trim().toLowerCase()
      if (word === "yes") yes += probability
      if (word === "no") no += probability
    }
    if (!(yes + no > 0))
      throw new LearningError("endpoint_failed", `${url.origin} answered neither Yes nor No.`)
    // The list holds only the likeliest tokens, so an answer missing from it is at most as likely
    // as the least likely token listed. Assuming that much keeps a short list from reading as
    // certainty.
    yes ||= least
    no ||= least
    answers[id] = { probabilities: { yes: yes / (yes + no), no: no / (yes + no) } }
  }
  return answers
}

function chatRequest(model, request, question) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: request.state.imagesNote },
          ...request.images.map((url) => ({ type: "image_url", image_url: { url } })),
          {
            type: "text",
            text: `${question.instructions}\nYes: ${question.criteria.true}\nNo: ${question.criteria.false}\nAnswer Yes or No.`,
          },
        ],
      },
    ],
    max_tokens: 1,
    temperature: 0,
    logprobs: true,
    top_logprobs: 10,
  }
}

async function post({ url, key, payload, fetch }) {
  let response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      // A redirect could send the screenshots to an address the https check never saw.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new LearningError(
      "endpoint_unreachable",
      `Could not reach ${url.origin} (${error.cause?.code ?? error.name}).`,
    )
  }
  if (response.status >= 300 && response.status < 400)
    throw new LearningError(
      "endpoint_failed",
      `${url.origin} redirected the request. Name the address it redirects to with --endpoint.`,
    )
  const text = await response.text()
  if (!response.ok)
    throw new LearningError(
      "endpoint_failed",
      `${url.origin} answered ${response.status}: ${oneLine(text).slice(0, 300)}`,
    )
  try {
    const body = JSON.parse(text)
    // Some scoring servers send the JSON document as a JSON string.
    return typeof body === "string" ? JSON.parse(body) : body
  } catch {
    throw new LearningError("endpoint_failed", `${url.origin} did not answer with JSON.`)
  }
}

function dataUri({ bytes, mediaType }) {
  return `data:${mediaType};base64,${bytes.toString("base64")}`
}

function endpointUrl(endpoint) {
  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw new LearningError("invalid_input", "The endpoint must be a full URL, such as https://….")
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    return url
  throw new LearningError(
    "invalid_input",
    "The endpoint must use https://, so the key is never sent unencrypted.",
  )
}
