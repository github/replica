import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react"
import { Heading, Text } from "@primer/react-brand"

import type { LearningActivityDay } from "./types"
import "./styles.css"

type ActivityMetric = "commentsAnalyzed" | "commentsTagged" | "suggestions"

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
 * Shows a year of daily learning runs, like GitHub's contribution graph, so members
 * can see how often the library learns and what each day found.
 */
export function LearningActivityGrid({
  activity,
  today,
}: {
  activity: LearningActivityDay[]
  /** UTC date treated as today. It picks the year and which days are still ahead. */
  today: string
}) {
  // A page left open over New Year shows a new calendar, so start its selection fresh
  // instead of keeping a day from the previous year.
  return <CalendarYear key={today.slice(0, 4)} activity={activity} today={today} />
}

function CalendarYear({ activity, today }: { activity: LearningActivityDay[]; today: string }) {
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

  // On a narrow screen recent weeks matter most, so open with the selected day in
  // view.
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
    <section className="learning-activity" aria-labelledby="learning-activity-heading">
      <div className="learning-activity__heading">
        <Heading as="h2" size="4" id="learning-activity-heading">
          Learning activity
        </Heading>
        <Text as="p" size="200" variant="muted">
          Daily runs in {today.slice(0, 4)} · UTC
        </Text>
      </div>

      <div className="learning-activity__metric-switch" role="group" aria-label="Activity measure">
        {activityMetrics.map(({ key, label }) => (
          <button
            aria-pressed={metric === key}
            className="learning-activity__metric-button"
            key={key}
            onClick={() => setMetric(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="learning-activity__graph">
        <div className="learning-activity__calendar-scroll" ref={scrollerRef}>
          <div
            className="learning-activity__calendar"
            role="group"
            aria-label={`Daily learning activity for ${today.slice(0, 4)}`}
            ref={calendarRef}
            style={{ "--weeks": weeks.length } as CSSProperties}
          >
            <div className="learning-activity__weekday-labels" aria-hidden="true">
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
              <div className="learning-activity__week" key={weekIndex}>
                <span className="learning-activity__month" aria-hidden="true">
                  {monthLabels[weekIndex]}
                </span>
                {week.map((cell, dayIndex) => {
                  if (!cell) {
                    return (
                      <span
                        aria-hidden="true"
                        className="learning-activity__day-empty"
                        key={dayIndex}
                      />
                    )
                  }
                  const { day } = cell
                  if (!day) {
                    return (
                      <span
                        aria-hidden="true"
                        className="learning-activity__day-upcoming"
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
                      className={`learning-activity__day learning-activity__day--level-${level}${
                        day.runState === "failed" ? " learning-activity__day--failed" : ""
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

        <div className="learning-activity__footer">
          <div className="learning-activity__legend" aria-hidden="true">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span
                className={`learning-activity__legend-cell learning-activity__day--level-${level}`}
                key={level}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>

      {selectedDay ? (
        <div className="learning-activity__run-summary" aria-live="polite">
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
          <dl className="learning-activity__run-metrics">
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
