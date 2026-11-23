import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react"
import { CheckCircleIcon, LightBulbIcon, XCircleIcon, type Icon } from "@primer/octicons-react"
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

import type {
  LearningActivityDay,
  LearningEvidence,
  LearningLifecycle,
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

function evidenceList(
  evidence: LearningEvidence[],
  stance: LearningEvidence["stance"],
  emptyLabel: string,
) {
  const items = evidence.filter((item) => item.stance === stance)
  return (
    <section className="learning-library__evidence-group">
      <Heading as="h3" size="5">
        {stance === "supports" ? "Supporting comments" : "Different views"}
        <span className="learning-library__evidence-count">{items.length}</span>
      </Heading>
      {items.length ? (
        <ul className="learning-library__evidence-list">
          {items.map((item) => (
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
              <Text as="p" variant={item.body === null ? "muted" : "default"}>
                {item.body ?? "The author deleted this review comment."}
              </Text>
              <a className="learning-library__review-link" href={item.reviewPath}>
                Open original review
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Text as="p" variant="muted">
          {emptyLabel}
        </Text>
      )}
    </section>
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
  const scrollerRef = useRef<HTMLDivElement>(null)

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
                      key={day.date}
                      onClick={() => setSelectedDate(day.date)}
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
  const [rejecting, setRejecting] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const [formError, setFormError] = useState("")
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

  function decide(status: "active" | "rejected", rejectionReason?: string) {
    if (!selected || !data.canDecide) return
    setLearnings((current) =>
      current.map((learning) =>
        learning.id === selected.id
          ? {
              ...learning,
              status,
              ...(status === "rejected" && rejectionReason ? { rejectionReason } : {}),
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
        : "Suggestion rejected and moved to Rejected.",
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
    setLearnings((current) =>
      current.map((learning) =>
        learning.id === selected.id ? { ...learning, title, guidance } : learning,
      ),
    )
    setEditing(false)
    setFormError("")
    setAnnouncement("Learning title and guidance updated.")
  }

  function rejectLearning(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const reason = new FormData(event.currentTarget).get("reason")
    if (typeof reason !== "string" || !reason.trim()) {
      setFormError("Enter a reason to reject this suggestion.")
      return
    }
    setFormError("")
    decide("rejected", reason.trim())
  }

  return (
    <div className="learning-library-page">
      <header className="repository-page-header learning-library__page-header">
        <Heading as="h1" size="6">
          Learnings
        </Heading>
      </header>
      <div className="learning-library">
        <p className="learning-library__announcement" role="status">
          {announcement}
        </p>
        {selected ? (
          <div className="learning-library__detail">
            <button
              className="learning-library__back"
              onClick={() => {
                setSelectedId(null)
                setEditing(false)
                setRejecting(false)
                setFormError("")
              }}
              type="button"
            >
              <span aria-hidden="true">‹</span> Learnings
            </button>
            <header className="learning-library__detail-header">
              <div>
                <div className="learning-library__eyebrow">
                  <Label
                    color={lifecycleLabelColors[selected.status]}
                    leadingVisual={<LifecycleIcon status={selected.status} />}
                  >
                    {lifecycleLabels[selected.status]}
                  </Label>
                  <span>{selected.topic}</span>
                </div>
                <Heading as="h2" size="4">
                  {selected.title}
                </Heading>
                <Text as="p" className="learning-library__guidance">
                  {selected.guidance}
                </Text>
              </div>
              {data.canDecide && !editing && !rejecting ? (
                <Button
                  className="learning-library__edit-button"
                  onClick={() => {
                    setFormError("")
                    setEditing(true)
                  }}
                  type="button"
                  variant="secondary"
                >
                  Edit learning
                </Button>
              ) : null}
            </header>

            {editing ? (
              <form className="learning-library__edit-form" onSubmit={saveLearning}>
                {formError ? <p role="alert">{formError}</p> : null}
                <FormControl id="learning-title" required fullWidth>
                  <FormControl.Label>Title</FormControl.Label>
                  <TextInput name="title" defaultValue={selected.title} required fullWidth />
                </FormControl>
                <FormControl id="learning-guidance" required fullWidth>
                  <FormControl.Label>Guidance</FormControl.Label>
                  <Textarea
                    name="guidance"
                    defaultValue={selected.guidance}
                    rows={4}
                    required
                    fullWidth
                    resize="vertical"
                  />
                </FormControl>
                <div className="learning-library__actions">
                  <Button type="submit" variant="primary">
                    Save changes
                  </Button>
                  <Button
                    onClick={() => {
                      setFormError("")
                      setEditing(false)
                    }}
                    type="button"
                    variant="subtle"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}

            <dl className="learning-library__metadata">
              <div>
                <dt>Topic</dt>
                <dd>{selected.topic}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>
                  {selected.reviewerCount} reviewers · {selected.prototypeCount} prototypes
                </dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>
                  <time dateTime={selected.updatedAt}>
                    {dayLabel(selected.updatedAt.slice(0, 10))}
                  </time>
                </dd>
              </div>
              {selected.acceptedBy ? (
                <div>
                  <dt>Accepted by</dt>
                  <dd>@{selected.acceptedBy}</dd>
                </div>
              ) : null}
            </dl>

            {selected.rejectionReason ? (
              <div className="learning-library__rejection">
                <strong>
                  <XCircleIcon size={16} />
                  Why it was rejected
                </strong>
                <Text as="p">{selected.rejectionReason}</Text>
              </div>
            ) : null}

            <div className="learning-library__evidence">
              <div className="learning-library__section-heading">
                <div>
                  <Heading as="h2" size="4">
                    Why this learning exists
                  </Heading>
                  <Text as="p" size="200" variant="muted">
                    Review comments that support or challenge this guidance.
                  </Text>
                </div>
                <HubCounter>{selected.evidence.length}</HubCounter>
              </div>
              {evidenceList(selected.evidence, "supports", "No supporting comments are available.")}
              {evidenceList(selected.evidence, "opposes", "No comments challenge this guidance.")}
            </div>

            {data.canDecide && selected.status === "suggested" && !editing ? (
              rejecting ? (
                <form
                  className="learning-library__decision learning-library__decision--reject"
                  onSubmit={rejectLearning}
                >
                  {formError ? <p role="alert">{formError}</p> : null}
                  <FormControl id="learning-rejection-reason" required fullWidth>
                    <FormControl.Label>Why reject this suggestion?</FormControl.Label>
                    <Textarea name="reason" required rows={3} fullWidth resize="vertical" />
                  </FormControl>
                  <div className="learning-library__actions">
                    <Button type="submit" variant="secondary">
                      Confirm rejection
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
              ) : (
                <div className="learning-library__decision">
                  <Text as="p">Your decision changes which guidance agents can use.</Text>
                  <div className="learning-library__actions">
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
                  </div>
                </div>
              )
            ) : data.canDecide && selected.status === "active" && !editing ? (
              <div className="learning-library__decision">
                <Text as="p">This guidance is available to agents.</Text>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <Text as="p" className="learning-library__description">
              Shared guidance from your team’s prototype reviews.
            </Text>
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
                >
                  {(["suggested", "active", "rejected"] as const).map((status) => (
                    <button
                      aria-pressed={lifecycle === status}
                      className="learning-library__filter"
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
              <div className="learning-library__table-wrap">
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
                                onClick={() => setSelectedId(learning.id)}
                                type="button"
                              >
                                {learning.title}
                              </button>
                              <p>{learning.guidance}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="learning-library__topic">{learning.topic}</span>
                        </td>
                        <td>
                          {learning.reviewerCount} reviewers · {learning.prototypeCount} prototypes
                        </td>
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
    </div>
  )
}
