import { LearningError } from "../errors.mjs"
import { oneLine } from "../recall.mjs"

/** The question that asks which learning a screen breaks most clearly. */
export const CHOICE_KEY = "most_clearly_broken"
/** The question that rates how far a screen is from the learnings, lowest level first. */
export const SEVERITY_KEY = "severity"
export const SEVERITY_LEVELS = Object.freeze([
  "Follows them",
  "Minor slip",
  "Clear violation",
  "Severe violation",
])
/** The most learnings one request asks about. A choice question allows 255 options at most. */
export const MAX_QUESTION_LEARNINGS = 64

const MEMORY_ID = /^mem_[0-9a-f]{24}$/
// A choice option names a learning briefly; its yes-or-no question carries the full text.
const OPTION_CHARACTERS = 200

/**
 * The typed questions a decision model answers about one candidate page, which a task shows in
 * one or more screenshots: one yes-or-no question per accepted learning, keyed by the learning's
 * ID so every answer names what it judges, then which learning the page breaks most clearly and
 * how far it is from all of
 * them. Learning text is quoted on one line, the way recall renders it, so a learning reads as
 * data and cannot add lines of its own.
 *
 * @param {Array<{ id: string, content: string }>} learnings accepted learnings, most relevant first
 * @returns {{ questions: Record<string, object>, rules: Array<{ id: string, text: string }> }}
 */
export function brandCheckQuestions(learnings) {
  if (!Array.isArray(learnings) || learnings.length > MAX_QUESTION_LEARNINGS)
    throw new LearningError(
      "invalid_input",
      `Ask about at most ${MAX_QUESTION_LEARNINGS} learnings in one set of questions.`,
    )
  const questions = {}
  const rules = []
  const options = { none: "It breaks none of them" }
  for (const learning of learnings) {
    if (!MEMORY_ID.test(learning?.id ?? ""))
      throw new LearningError("invalid_input", "Each learning needs an ID such as mem_<24 hex>.")
    if (Object.hasOwn(questions, learning.id))
      throw new LearningError("invalid_input", `Learning ${learning.id} appears twice.`)
    const text = oneLine(learning.content ?? "")
    if (!text) throw new LearningError("invalid_input", `Learning ${learning.id} has no text.`)
    rules.push({ id: learning.id, text })
    questions[learning.id] = {
      type: "noul",
      instructions: `Does the candidate page follow this team learning in every screenshot? Learning: ${JSON.stringify(text)}`,
      criteria: {
        true: "Every screenshot follows the learning, or the learning does not apply to this page",
        false: "At least one screenshot visibly breaks the learning",
      },
    }
    const characters = Array.from(text)
    options[learning.id] =
      characters.length > OPTION_CHARACTERS
        ? `${characters.slice(0, OPTION_CHARACTERS - 1).join("")}…`
        : text
  }
  if (rules.length) {
    questions[CHOICE_KEY] = {
      type: "choice",
      instructions: "Which team learning does the candidate page break most clearly?",
      criteria: options,
    }
    questions[SEVERITY_KEY] = {
      type: "score",
      instructions: "How far is the candidate page from the team learnings?",
      criteria: [...SEVERITY_LEVELS],
    }
  }
  return { questions, rules }
}
