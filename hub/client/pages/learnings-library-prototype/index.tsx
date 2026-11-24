import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react"
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CircleIcon,
  LightBulbIcon,
  PlugIcon,
  XCircleIcon,
  type Icon,
} from "@primer/octicons-react"
import {
  Button,
  FormControl,
  Heading,
  Label,
  Pagination,
  Text,
  TextInput,
  Textarea,
} from "@primer/react-brand"

import { HubCounter } from "@components/hub-counter"
import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { diffWords } from "@utils/diff-words"

import type {
  LearningActivityDay,
  LearningEvidence,
  LearningLifecycle,
  LearningOutcome,
  LearningRecord,
  LearningsLibraryPrototypeData,
} from "./types"
import "./styles.css"

type ActivityMetric = "commentsAnalyzed" | "commentsTagged" | "suggestions"

// Matches GitHub's pull request list so long lists page the way people expect.
const pageSize = 25

const lifecycleLabels: Record<LearningLifecycle, string> = {
  suggested: "Suggested",
  active: "Active",
  rejected: "Rejected",
}

// Mirrors GitHub's pull request states so people can read status at a glance.
const lifecycleIcons: Record<LearningLifecycle, Icon> = {
  suggested: LightBulbIcon,
  active: CheckCircleIcon,
  rejected: XCircleIcon,
}

/** Renders a learning's state icon; Brand labels need an element, not a component. */
function LifecycleIcon({ status, className }: { status: LearningLifecycle; className?: string }) {
  const StatusIcon = lifecycleIcons[status]
  return <StatusIcon className={className} size={16} />
}

const lifecycleLabelColors = {
  suggested: "default",
  active: "green",
  rejected: "red",
} as const satisfies Record<LearningLifecycle, string>

const outcomeResultLabels: Record<LearningOutcome["result"], string> = {
  supports: "Supports the guidance",
  concern: "Possible concern",
  inconclusive: "Inconclusive",
}

// A result icon sets outcomes apart from review comments, which lead with an avatar.
const outcomeResultIcons: Record<LearningOutcome["result"], Icon> = {
  supports: CheckCircleIcon,
  concern: AlertIcon,
  inconclusive: CircleIcon,
}

function outcomeSourceLabel(source: LearningOutcome["source"]) {
  return source === "automated" ? "Automated assessment" : "Reviewer-confirmed"
}

const activityMetrics: Array<{ key: ActivityMetric; label: string }> = [
  { key: "commentsAnalyzed", label: "Comments analyzed" },
  { key: "commentsTagged", label: "Comments categorized" },
  { key: "suggestions", label: "Suggestions" },
]

function dayLabel(date: string, options: Intl.DateTimeFormatOptions = { dateStyle: "long" }) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00.000Z`),
  )
}

function activityValue(day: LearningActivityDay, metric: ActivityMetric) {
  return day[metric]
}

function activityMetricLabel(metric: ActivityMetric) {
  if (metric === "commentsAnalyzed") return "Comments analyzed"
  if (metric === "commentsTagged") return "Comments categorized"
  return "Suggestions"
}

function countLabel(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? "" : "s"}`
}

/** A square in the year grid. Days still ahead have no activity to show yet. */
type CalendarCell = { date: string; day: LearningActivityDay | null }

function quietDay(date: string): LearningActivityDay {
  return {
    date,
    runState: "none",
    startedAt: null,
    startedBy: null,
    commentsAnalyzed: 0,
    commentsTagged: 0,
    suggestions: 0,
  }
}

/**
 * Lays out today's UTC calendar year in Sunday-first week columns, like GitHub's
 * contribution graph. Past days without a run read as "no run", while days still ahead
 * stay blank so nobody mistakes them for quiet days.
 */
function buildCalendarYear(activity: LearningActivityDay[], today: string) {
  const year = today.slice(0, 4)
  const daysByDate = new Map(activity.map((day) => [day.date, day]))
  const cursor = new Date(`${year}-01-01T00:00:00.000Z`)
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay())
  const end = new Date(`${year}-12-31T00:00:00.000Z`).getTime()
  const weeks: Array<Array<CalendarCell | null>> = []

  while (cursor.getTime() <= end) {
    weeks.push(
      Array.from({ length: 7 }, () => {
        const date = cursor.toISOString().slice(0, 10)
        cursor.setUTCDate(cursor.getUTCDate() + 1)
        if (!date.startsWith(`${year}-`)) return null
        if (date > today) return { date, day: null }
        return { date, day: daysByDate.get(date) ?? quietDay(date) }
      }),
    )
  }
  return weeks
}

function firstDateOf(week: Array<CalendarCell | null> | undefined) {
  return week?.find((cell) => cell !== null)?.date
}

/**
 * Names each month above the first week that starts in it, like GitHub's contribution
 * graph. When two months start one week apart, the earlier name is dropped so the
 * short labels never overlap.
 */
function monthLabelsByWeek(weeks: Array<Array<CalendarCell | null>>) {
  const labels = weeks.map((week, index) => {
    const firstDate = firstDateOf(week)
    const previousDate = firstDateOf(weeks[index - 1])
    if (!firstDate) return ""
    if (previousDate && firstDate.slice(0, 7) === previousDate.slice(0, 7)) return ""
    return dayLabel(firstDate, { month: "short" })
  })
  return labels.map((label, index) => (label && labels[index + 1] ? "" : label))
}

/**
 * Shows a suggested edit inline so admins can see what changes without comparing two
 * blocks of text. Screen readers hear "Removed" and "Added" because color and
 * strikethrough alone are not announced. Spaces at the edges of a change stay outside
 * the highlight so it hugs the words.
 */
function diffText(before: string, after: string) {
  return diffWords(before, after).map((part, index) => {
    const [, leading = "", text = "", trailing = ""] = /^(\s*)(.*?)(\s*)$/su.exec(part.text) ?? []
    if (part.kind === "unchanged" || !text) return <span key={index}>{part.text}</span>

    const label = part.kind === "removed" ? "Removed: " : "Added: "
    const Mark = part.kind === "removed" ? "del" : "ins"
    return (
      <span key={index}>
        {leading}
        <Mark>
          <HubVisuallyHidden>{label}</HubVisuallyHidden>
          {text}
        </Mark>
        {trailing}
      </span>
    )
  })
}

/**
 * Replaces a learning's wording and keeps the old wording, with its outcomes, under
 * Earlier guidance. Outcomes describe the wording that builds actually used, so they
 * must not carry over to new text.
 */
function reviseGuidance(
  learning: LearningRecord,
  title: string,
  guidance: string,
  updatedAt: string,
): LearningRecord {
  const version = learning.version ?? 1
  return {
    ...learning,
    versionHistory: [
      ...(learning.versionHistory ?? []),
      {
        version,
        title: learning.title,
        guidance: learning.guidance,
        updatedAt: learning.updatedAt,
        ...(learning.outcomeAssessment ? { outcomeAssessment: learning.outcomeAssessment } : {}),
      },
    ],
    version: version + 1,
    title,
    guidance,
    updatedAt,
    outcomeAssessment: undefined,
  }
}

function evidenceList(evidence: LearningEvidence[]) {
  return (
    <ul className="learning-library__evidence-list">
      {evidence.map((item) => (
        <li className="learning-library__evidence-item" key={item.id}>
          <div className="learning-library__evidence-meta">
            <span className="learning-library__avatar" aria-hidden="true">
              {item.authorLogin.slice(0, 1).toUpperCase()}
            </span>
            <strong>@{item.authorLogin}</strong>
            <span aria-hidden="true">·</span>
            <a href={item.reviewPath}>
              {item.prototypeName} · Build {item.buildNumber}
            </a>
            <span aria-hidden="true">·</span>
            <time dateTime={item.createdAt}>{dayLabel(item.createdAt.slice(0, 10))}</time>
          </div>
          <Text as="p" size="200" variant={item.body === null ? "muted" : "default"}>
            {item.body ?? "The author deleted this review comment."}
          </Text>
        </li>
      ))}
    </ul>
  )
}

function ActivityGrid({ activity, today }: { activity: LearningActivityDay[]; today: string }) {
  const [metric, setMetric] = useState<ActivityMetric>("commentsAnalyzed")
  const weeks = useMemo(() => buildCalendarYear(activity, today), [activity, today])
  const monthLabels = useMemo(() => monthLabelsByWeek(weeks), [weeks])
  const pastDays = weeks.flat().flatMap((cell) => (cell?.day ? [cell.day] : []))
  const maximum = Math.max(1, ...pastDays.map((day) => activityValue(day, metric)))
  const [selectedDate, setSelectedDate] = useState(
    () => pastDays.findLast((day) => day.runState !== "none")?.date ?? today,
  )
  const selectedDay = pastDays.find((day) => day.date === selectedDate) ?? null
  const calendarRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  function moveSelectedDate(event: KeyboardEvent<HTMLButtonElement>) {
    const offsets: Record<string, number> = {
      ArrowDown: 1,
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
    }
    const offset = offsets[event.key]
    if (offset === undefined) return

    event.preventDefault()
    const next = new Date(`${selectedDate}T00:00:00.000Z`)
    next.setUTCDate(next.getUTCDate() + offset)
    const nextDate = next.toISOString().slice(0, 10)
    if (!nextDate.startsWith(`${today.slice(0, 4)}-`) || nextDate > today) return

    const nextButton = calendarRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${nextDate}"]`,
    )
    if (!nextButton) return
    setSelectedDate(nextDate)
    nextButton.focus()
  }

  // On a narrow screen recent weeks matter most, so open with the selected day in view.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const selectedCell = scroller?.querySelector('[aria-pressed="true"]')
    if (!scroller || !selectedCell) return
    const overflow =
      selectedCell.getBoundingClientRect().right - scroller.getBoundingClientRect().right
    if (overflow > 0) {
      scroller.scrollLeft += overflow + parseFloat(getComputedStyle(scroller).paddingRight)
    }
  }, [])

  return (
    <section className="learning-library__activity" aria-labelledby="learning-activity-heading">
      <div className="learning-library__activity-heading">
        <Heading as="h2" size="4" id="learning-activity-heading">
          Learning activity
        </Heading>
        <Text as="p" size="200" variant="muted">
          Daily runs in {today.slice(0, 4)} · UTC
        </Text>
      </div>

      <div className="learning-library__metric-switch" role="group" aria-label="Activity measure">
        {activityMetrics.map(({ key, label }) => (
          <button
            aria-pressed={metric === key}
            className="learning-library__metric-button"
            key={key}
            onClick={() => setMetric(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="learning-library__graph">
        <div className="learning-library__calendar-scroll" ref={scrollerRef}>
          <div
            className="learning-library__calendar"
            role="group"
            aria-label={`Daily learning activity for ${today.slice(0, 4)}`}
            ref={calendarRef}
            style={{ "--weeks": weeks.length } as CSSProperties}
          >
            <div className="learning-library__weekday-labels" aria-hidden="true">
              <span />
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
            {weeks.map((week, weekIndex) => (
              <div className="learning-library__week" key={weekIndex}>
                <span className="learning-library__month" aria-hidden="true">
                  {monthLabels[weekIndex]}
                </span>
                {week.map((cell, dayIndex) => {
                  if (!cell) {
                    return (
                      <span
                        aria-hidden="true"
                        className="learning-library__day-empty"
                        key={dayIndex}
                      />
                    )
                  }
                  const { day } = cell
                  if (!day) {
                    return (
                      <span
                        aria-hidden="true"
                        className="learning-library__day-upcoming"
                        key={cell.date}
                      />
                    )
                  }
                  const value = activityValue(day, metric)
                  const level = value === 0 ? 0 : Math.min(4, Math.ceil((value / maximum) * 4))
                  const runLabel =
                    day.runState === "none"
                      ? "no run"
                      : day.runState === "failed"
                        ? "run failed"
                        : "run succeeded"
                  const metricLabel = activityMetricLabel(metric)
                  const accessibleLabel = `${dayLabel(day.date)}, ${metricLabel}: ${activityValue(day, metric)}; ${countLabel(day.commentsAnalyzed, "comment")} analyzed, ${countLabel(day.commentsTagged, "comment")} categorized, ${countLabel(day.suggestions, "suggestion")}, ${runLabel}`
                  return (
                    <button
                      aria-label={accessibleLabel}
                      aria-pressed={selectedDate === day.date}
                      className={`learning-library__day learning-library__day--level-${level}${
                        day.runState === "failed" ? " learning-library__day--failed" : ""
                      }`}
                      data-date={day.date}
                      onKeyDown={moveSelectedDate}
                      key={day.date}
                      onClick={() => setSelectedDate(day.date)}
                      tabIndex={selectedDate === day.date ? 0 : -1}
                      style={{ "--activity-level": level / 4 } as CSSProperties}
                      title={accessibleLabel}
                      type="button"
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="learning-library__activity-footer">
          <div className="learning-library__legend" aria-hidden="true">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span
                className={`learning-library__legend-cell learning-library__day--level-${level}`}
                key={level}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>

      {selectedDay ? (
        <div className="learning-library__run-summary" aria-live="polite">
          <div>
            <Heading as="h3" size="6">
              {dayLabel(selectedDay.date)}
            </Heading>
            <Text as="p" size="200" variant="muted">
              {selectedDay.runState === "none"
                ? "No learning run"
                : `${selectedDay.runState === "failed" ? "Run failed" : "Run completed"}${
                    selectedDay.startedBy ? ` · Started by ${selectedDay.startedBy}` : ""
                  }${
                    selectedDay.startedAt
                      ? ` · ${new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "UTC",
                          timeZoneName: "short",
                        }).format(new Date(selectedDay.startedAt))}`
                      : ""
                  }`}
            </Text>
          </div>
          <dl className="learning-library__run-metrics">
            <div>
              <dt>Comments analyzed</dt>
              <dd>{selectedDay.commentsAnalyzed}</dd>
            </div>
            <div>
              <dt>Comments categorized</dt>
              <dd>{selectedDay.commentsTagged}</dd>
            </div>
            <div>
              <dt>Suggestions</dt>
              <dd>{selectedDay.suggestions}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  )
}

/** Lets a repository team browse guidance and gives administrators a local decision prototype. */
export function LearningsLibraryPrototype({ data }: { data: LearningsLibraryPrototypeData }) {
  const [learnings, setLearnings] = useState(data.learnings)
  const [lifecycle, setLifecycle] = useState<LearningLifecycle>("suggested")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingSuggestion, setEditingSuggestion] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const [formError, setFormError] = useState("")
  const [detailFocusVisible, setDetailFocusVisible] = useState(false)
  const detailHeadingRef = useRef<HTMLHeadingElement>(null)
  const learningListRef = useRef<HTMLDivElement>(null)
  const statusFiltersRef = useRef<HTMLDivElement>(null)
  const focusAfterDetailRef = useRef<
    { type: "learning"; id: string } | { type: "status"; status: LearningLifecycle } | null
  >(null)
  const selected = learnings.find((learning) => learning.id === selectedId) ?? null
  const filtered = learnings.filter(
    (learning) =>
      learning.status === lifecycle &&
      `${learning.title} ${learning.guidance} ${learning.topic}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  const counts = {
    suggested: learnings.filter((learning) => learning.status === "suggested").length,
    active: learnings.filter((learning) => learning.status === "active").length,
    rejected: learnings.filter((learning) => learning.status === "rejected").length,
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useLayoutEffect(() => {
    if (selectedId) {
      detailHeadingRef.current?.focus()
      return
    }

    const focusTarget = focusAfterDetailRef.current
    focusAfterDetailRef.current = null
    if (!focusTarget) return

    const controls =
      focusTarget.type === "learning"
        ? learningListRef.current?.querySelectorAll<HTMLButtonElement>("[data-learning-id]")
        : statusFiltersRef.current?.querySelectorAll<HTMLButtonElement>("[data-lifecycle-status]")
    const control = Array.from(controls ?? []).find((item) =>
      focusTarget.type === "learning"
        ? item.dataset.learningId === focusTarget.id
        : item.dataset.lifecycleStatus === focusTarget.status,
    )
    control?.focus()
  }, [selectedId])

  function decide(status: "active" | "rejected", rejectionReason?: string) {
    if (!selected || !data.canDecide) return
    focusAfterDetailRef.current = { type: "status", status }
    const updatedAt = `${data.today}T12:00:00.000Z`
    setLearnings((current) =>
      current.map((learning) =>
        learning.id === selected.id
          ? {
              ...learning,
              status,
              updatedAt,
              ...(status === "rejected" && rejectionReason ? { rejectionReason } : {}),
              decisions: [
                ...(learning.decisions ??
                  (learning.status === "suggested"
                    ? []
                    : [
                        {
                          status: learning.status,
                          decidedAt: learning.updatedAt,
                          ...(learning.status === "rejected" && learning.rejectionReason
                            ? { reason: learning.rejectionReason }
                            : {}),
                        },
                      ])),
                {
                  status,
                  decidedAt: updatedAt,
                  ...(status === "rejected" && rejectionReason ? { reason: rejectionReason } : {}),
                },
              ],
            }
          : learning,
      ),
    )
    setLifecycle(status)
    setPage(1)
    setSelectedId(null)
    setRejecting(false)
    setFormError("")
    setAnnouncement(
      status === "active"
        ? "Learning accepted and moved to Active."
        : "Learning rejected and moved to Rejected.",
    )
  }

  function saveLearning(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !data.canDecide) return
    const form = new FormData(event.currentTarget)
    const titleValue = form.get("title")
    const guidanceValue = form.get("guidance")
    if (typeof titleValue !== "string" || typeof guidanceValue !== "string") {
      setFormError("Enter a title and guidance.")
      return
    }
    const title = titleValue.trim()
    const guidance = guidanceValue.trim()
    if (!title || !guidance) {
      setFormError("Enter a title and guidance.")
      return
    }
    const updatedAt = `${data.today}T12:00:00.000Z`
    setLearnings((current) =>
      current.map((learning) => {
        if (learning.id !== selected.id) return learning
        const revised =
          title !== learning.title || guidance !== learning.guidance
            ? reviseGuidance(learning, title, guidance, updatedAt)
            : { ...learning, updatedAt }
        return editingSuggestion ? { ...revised, updateSuggestion: undefined } : revised
      }),
    )
    setEditing(false)
    setEditingSuggestion(false)
    setFormError("")
    setAnnouncement(editingSuggestion ? "Suggested learning update applied." : "Learning updated.")
  }

  function rejectLearning(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const reason = new FormData(event.currentTarget).get("reason")
    if (typeof reason !== "string" || !reason.trim()) {
      setFormError("Enter a reason to reject this learning.")
      return
    }
    setFormError("")
    decide("rejected", reason.trim())
  }

  function applySuggestedUpdate() {
    if (!selected?.updateSuggestion || !data.canDecide) return
    const updatedAt = `${data.today}T12:00:00.000Z`
    setLearnings((current) =>
      current.map((learning) =>
        learning.id === selected.id && learning.updateSuggestion
          ? {
              ...reviseGuidance(
                learning,
                learning.updateSuggestion.title,
                learning.updateSuggestion.guidance,
                updatedAt,
              ),
              updateSuggestion: undefined,
            }
          : learning,
      ),
    )
    setAnnouncement("Suggested learning update applied.")
  }

  function dismissSuggestedUpdate() {
    if (!selected || !data.canDecide) return
    setLearnings((current) =>
      current.map((learning) =>
        learning.id === selected.id ? { ...learning, updateSuggestion: undefined } : learning,
      ),
    )
    setAnnouncement("Suggested learning update dismissed. The active learning is unchanged.")
  }

  function closeEditor() {
    setFormError("")
    setEditing(false)
    setEditingSuggestion(false)
  }

  function backToLearnings() {
    if (!selected) return
    focusAfterDetailRef.current = { type: "learning", id: selected.id }
    setSelectedId(null)
    setEditing(false)
    setEditingSuggestion(false)
    setRejecting(false)
    setFormError("")
  }

  return (
    <div className="learning-library-page">
      <header
        className={`repository-page-header learning-library__page-header${selected ? " learning-library__page-header--detail" : ""}`}
      >
        {selected ? (
          <>
            <HubIconButton
              aria-label="Back to learnings"
              icon={ArrowLeftIcon}
              onClick={backToLearnings}
              variant="invisible"
            />
            <Heading
              as="h1"
              className={`learning-library__page-title${
                detailFocusVisible ? " learning-library__page-title--focus-visible" : ""
              }`}
              ref={detailHeadingRef}
              size="6"
              tabIndex={-1}
            >
              {selected.title}
            </Heading>
            {data.canDecide ? (
              <div className="learning-library__page-actions">
                {selected.status === "suggested" ? (
                  <>
                    <Button onClick={() => decide("active")} type="button" variant="primary">
                      Accept learning
                    </Button>
                    <Button
                      onClick={() => {
                        setFormError("")
                        setRejecting(true)
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Reject suggestion
                    </Button>
                  </>
                ) : selected.status === "active" ? (
                  <>
                    <Button
                      onClick={() => {
                        setFormError("")
                        setEditingSuggestion(false)
                        setEditing(true)
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Edit learning
                    </Button>
                    <Button
                      onClick={() => {
                        setFormError("")
                        setRejecting(true)
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Reject learning
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => decide("active")} type="button" variant="primary">
                    Accept learning
                  </Button>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <Heading as="h1" size="6">
            Learnings
          </Heading>
        )}
      </header>
      <div className="learning-library">
        <p className="learning-library__announcement" role="status">
          {announcement}
        </p>
        {selected ? (
          <div className="learning-library__detail">
            <header className="learning-library__detail-header">
              <div>
                <div className="learning-library__eyebrow">
                  <Label
                    color={lifecycleLabelColors[selected.status]}
                    leadingVisual={<LifecycleIcon status={selected.status} />}
                  >
                    {lifecycleLabels[selected.status]}
                  </Label>
                </div>
                <Text as="p" className="learning-library__guidance">
                  {selected.guidance}
                </Text>
                <p className="learning-library__metadata">
                  <span>Category: {selected.topic}</span>
                  <span aria-hidden="true">·</span>
                  <span>{countLabel(selected.evidence.length, "review comment")}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Updated{" "}
                    <time dateTime={selected.updatedAt}>
                      {dayLabel(selected.updatedAt.slice(0, 10))}
                    </time>
                  </span>
                  {selected.acceptedBy ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Accepted by @{selected.acceptedBy}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </header>

            {selected.status === "rejected" && selected.rejectionReason ? (
              <div className="learning-library__rejection">
                <strong>
                  <XCircleIcon size={16} />
                  Why it was rejected
                </strong>
                <Text as="p">{selected.rejectionReason}</Text>
              </div>
            ) : null}

            {selected.status === "active" && selected.updateSuggestion ? (
              <section
                className="learning-library__update-suggestion"
                aria-label="Suggested update"
              >
                <Heading as="h2" className="learning-library__section-heading" size="6">
                  Update suggested
                </Heading>
                <div className="learning-library__update-diff">
                  <strong>{diffText(selected.title, selected.updateSuggestion.title)}</strong>
                  <Text as="p">
                    {diffText(selected.guidance, selected.updateSuggestion.guidance)}
                  </Text>
                </div>
                <p className="learning-library__update-reason">
                  Why: {selected.updateSuggestion.reason}
                </p>
                {data.canDecide ? (
                  <div className="learning-library__actions">
                    <Button onClick={applySuggestedUpdate} type="button" variant="primary">
                      Apply update
                    </Button>
                    <Button
                      onClick={() => {
                        setFormError("")
                        setEditingSuggestion(true)
                        setEditing(true)
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Edit proposed update
                    </Button>
                    <Button onClick={dismissSuggestedUpdate} type="button" variant="subtle">
                      Dismiss update
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="learning-library__outcomes" aria-label="Observed outcomes">
              <div className="learning-library__section-header">
                <Heading as="h2" className="learning-library__section-heading" size="6">
                  Observed outcomes
                </Heading>
                <p>How later builds did with this guidance.</p>
              </div>
              {/* Outcomes of older wording do not apply to the current guidance. */}
              {selected.outcomeAssessment?.version !== (selected.version ?? 1) ||
              selected.outcomeAssessment.status === "not-evaluated" ? (
                <p className="learning-library__outcome-empty">Not evaluated yet.</p>
              ) : selected.outcomeAssessment.status === "insufficient-evidence" ? (
                <p className="learning-library__outcome-empty">
                  Not enough evidence yet. This is not a negative result.
                </p>
              ) : (
                <ul className="learning-library__outcome-list">
                  {selected.outcomeAssessment.outcomes.map((outcome) => {
                    const ResultIcon = outcomeResultIcons[outcome.result]
                    return (
                      <li key={outcome.id}>
                        <span
                          className={`learning-library__outcome-result learning-library__outcome-result--${outcome.result}`}
                        >
                          <ResultIcon size={16} />
                          {outcomeResultLabels[outcome.result]}
                          {" · "}
                          {outcomeSourceLabel(outcome.source)}
                        </span>
                        <Text as="p">{outcome.summary}</Text>
                        <p className="learning-library__outcome-meta">
                          <a href={outcome.buildPath}>
                            {outcome.prototypeName}, Build {outcome.buildNumber}
                          </a>
                          {" · "}
                          <time dateTime={outcome.evaluatedAt}>
                            Evaluated {dayLabel(outcome.evaluatedAt.slice(0, 10))}
                          </time>
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
              {selected.versionHistory?.length ? (
                <details className="learning-library__previous-versions">
                  <summary>Earlier guidance</summary>
                  {selected.versionHistory.map((version) => (
                    <article key={version.version}>
                      <Heading as="h3" className="learning-library__section-heading" size="6">
                        {version.title}
                      </Heading>
                      <Text as="p">{version.guidance}</Text>
                      {version.outcomeAssessment?.outcomes.length ? (
                        <ul>
                          {version.outcomeAssessment.outcomes.map((outcome) => (
                            <li key={outcome.id}>
                              <a href={outcome.buildPath}>
                                {outcome.prototypeName}, Build {outcome.buildNumber}
                              </a>
                              {" · "}
                              {outcomeSourceLabel(outcome.source)}
                              {`: ${outcome.summary}`}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </details>
              ) : null}
            </section>

            {selected.status === "active" && selected.decisions?.length ? (
              <section className="learning-library__decision-history" aria-label="Decision history">
                <Heading as="h2" className="learning-library__section-heading" size="6">
                  Decision history
                </Heading>
                <ul>
                  {selected.decisions.map((decision, index) => (
                    <li key={`${decision.decidedAt}-${index}`}>
                      <strong>{lifecycleLabels[decision.status]}</strong>
                      {" · "}
                      <time dateTime={decision.decidedAt}>
                        {dayLabel(decision.decidedAt.slice(0, 10))}
                      </time>
                      {decision.reason ? <p>{decision.reason}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selected.evidence.length ? (
              <section className="learning-library__review-comments" aria-label="Review comments">
                <div className="learning-library__section-header">
                  <Heading as="h2" className="learning-library__section-heading" size="6">
                    Review comments
                  </Heading>
                  <p>The feedback this learning came from.</p>
                </div>
                {evidenceList(selected.evidence)}
              </section>
            ) : null}
          </div>
        ) : (
          <>
            <section
              className="learning-library__agent-connection"
              aria-label="Using learnings with agents"
            >
              <PlugIcon className="learning-library__agent-connection-icon" size={16} />
              <p>
                Shared guidance from your team’s prototype reviews.
                {data.agentConnectionPath ? (
                  <>
                    {" "}
                    Use these learnings in your agent through MCP.{" "}
                    <a href={data.agentConnectionPath}>Connect an agent</a>
                  </>
                ) : null}
              </p>
            </section>
            <ActivityGrid activity={data.activity} today={data.today} />
            <section
              className="learning-library__collection"
              aria-labelledby="learning-list-heading"
            >
              <div className="learning-library__collection-heading">
                <Heading as="h2" size="4" id="learning-list-heading">
                  Browse learnings
                </Heading>
                {!data.canDecide ? (
                  <Text as="p" size="200" variant="muted">
                    Browse is open to repository members. Administrators decide what becomes
                    guidance.
                  </Text>
                ) : null}
              </div>
              <div className="learning-library__toolbar">
                <div
                  className="learning-library__filters"
                  role="group"
                  aria-label="Learning status"
                  ref={statusFiltersRef}
                >
                  {(["suggested", "active", "rejected"] as const).map((status) => (
                    <button
                      aria-pressed={lifecycle === status}
                      className="learning-library__filter"
                      data-lifecycle-status={status}
                      key={status}
                      onClick={() => {
                        setLifecycle(status)
                        setPage(1)
                        setAnnouncement("")
                      }}
                      type="button"
                    >
                      <LifecycleIcon status={status} />
                      {lifecycleLabels[status]}
                      <HubCounter>{counts[status]}</HubCounter>
                    </button>
                  ))}
                </div>
                <FormControl className="learning-library__search" fullWidth id="learning-search">
                  <FormControl.Label className="learning-library__visually-hidden">
                    Search learnings
                  </FormControl.Label>
                  <TextInput
                    fullWidth
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(1)
                    }}
                    placeholder="Search learnings"
                    value={query}
                  />
                </FormControl>
              </div>
              <div className="learning-library__table-wrap" ref={learningListRef}>
                <table className="learning-library__table">
                  <thead>
                    <tr>
                      <th scope="col">Learning</th>
                      <th scope="col">Category</th>
                      <th scope="col">Evidence</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((learning) => (
                      <tr key={learning.id}>
                        <td>
                          <div className="learning-library__learning-cell">
                            <LifecycleIcon
                              className={`learning-library__state-icon learning-library__state-icon--${learning.status}`}
                              status={learning.status}
                            />
                            <div>
                              <button
                                className="learning-library__learning-link"
                                data-learning-id={learning.id}
                                onClick={(event) => {
                                  setDetailFocusVisible(event.detail === 0)
                                  setSelectedId(learning.id)
                                }}
                                type="button"
                              >
                                {learning.title}
                              </button>
                              {learning.status === "active" && learning.updateSuggestion ? (
                                <span className="learning-library__update-indicator">
                                  Update suggested
                                </span>
                              ) : null}
                              <p>{learning.guidance}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="learning-library__topic">{learning.topic}</span>
                        </td>
                        <td>{countLabel(learning.evidence.length, "review comment")}</td>
                        <td>
                          <time dateTime={learning.updatedAt}>
                            {dayLabel(learning.updatedAt.slice(0, 10))}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length ? (
                  <div className="learning-library__empty">
                    <Heading as="h3" size="5">
                      No {lifecycleLabels[lifecycle].toLowerCase()} learnings
                    </Heading>
                    <Text as="p">
                      {query
                        ? "Try another search."
                        : "New learnings will appear here as your team reviews prototypes."}
                    </Text>
                  </div>
                ) : null}
              </div>
              {pageCount > 1 ? (
                <Pagination
                  aria-label="Learnings pages"
                  className="learning-library__pagination"
                  currentPage={currentPage}
                  hrefBuilder={(pageNumber) => `#learnings-page-${pageNumber}`}
                  onPageChange={(event, pageNumber) => {
                    event.preventDefault()
                    setPage(pageNumber)
                  }}
                  pageCount={pageCount}
                />
              ) : null}
            </section>
          </>
        )}
      </div>
      {editing && selected ? (
        <CanvasDialog
          title={editingSuggestion ? "Edit proposed update" : "Edit learning"}
          closeLabel="Cancel editing"
          descriptionId="learning-edit-description"
          // Applying a suggestion removes the button that opened this dialog.
          returnFocusRef={editingSuggestion ? detailHeadingRef : undefined}
          onClose={closeEditor}
        >
          <p id="learning-edit-description">
            {editingSuggestion
              ? "Applying this update replaces the current guidance. The current guidance and its outcomes stay under Earlier guidance."
              : "Saving replaces the current guidance. Its outcomes stay under Earlier guidance."}
          </p>
          <form className="learning-library__edit-form" onSubmit={saveLearning}>
            {formError ? <p role="alert">{formError}</p> : null}
            <FormControl id="learning-title" required fullWidth>
              <FormControl.Label>
                {editingSuggestion ? "Proposed title" : "Title"}
              </FormControl.Label>
              <TextInput
                name="title"
                defaultValue={
                  editingSuggestion
                    ? (selected.updateSuggestion?.title ?? selected.title)
                    : selected.title
                }
                required
                fullWidth
              />
            </FormControl>
            <FormControl id="learning-guidance" required fullWidth>
              <FormControl.Label>
                {editingSuggestion ? "Proposed guidance" : "Guidance"}
              </FormControl.Label>
              <Textarea
                name="guidance"
                defaultValue={
                  editingSuggestion
                    ? (selected.updateSuggestion?.guidance ?? selected.guidance)
                    : selected.guidance
                }
                rows={4}
                required
                fullWidth
                resize="vertical"
              />
            </FormControl>
            <div className="learning-library__actions">
              <Button type="submit" variant="primary">
                {editingSuggestion ? "Apply edited update" : "Save changes"}
              </Button>
              <Button onClick={closeEditor} type="button" variant="subtle">
                Cancel
              </Button>
            </div>
          </form>
        </CanvasDialog>
      ) : null}
      {rejecting && selected ? (
        <CanvasDialog
          title="Reject learning"
          closeLabel="Cancel rejection"
          descriptionId="learning-rejection-description"
          onClose={() => {
            setFormError("")
            setRejecting(false)
          }}
        >
          <p id="learning-rejection-description">
            Rejected learnings are not supplied to agents. You can accept this learning later.
          </p>
          <form className="learning-library__reject-form" onSubmit={rejectLearning}>
            {formError ? <p role="alert">{formError}</p> : null}
            <FormControl id="learning-rejection-reason" required fullWidth>
              <FormControl.Label>Why reject this learning?</FormControl.Label>
              <Textarea name="reason" required rows={3} fullWidth resize="vertical" />
            </FormControl>
            <div className="learning-library__actions">
              <Button type="submit" variant="secondary">
                Reject learning
              </Button>
              <Button
                onClick={() => {
                  setFormError("")
                  setRejecting(false)
                }}
                type="button"
                variant="subtle"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CanvasDialog>
      ) : null}
    </div>
  )
}
