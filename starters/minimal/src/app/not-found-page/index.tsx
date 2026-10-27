import type { NotFoundPageProps } from "./types"
import styles from "./styles.module.css"

export const notFoundPageConfig = {
  feedbackUrl: "https://github.com/github/replica/issues",
}

export function NotFoundPage({ onBack, startLink }: NotFoundPageProps) {
  const { feedbackUrl } = notFoundPageConfig

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <svg
          className={styles.icon}
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m8 13 15-7 4 8-15 7zM23 6l-1-2M27 14l1 2M8 14l-4 2 2 4 4-2M17 19v9M17 22l-6 6M17 22l6 6" />
        </svg>
        <h1>This page isn't built in the prototype yet</h1>
        <p>
          You've reached a page that hasn't been built.
          {feedbackUrl &&
            " Tell us what you were looking for so we can prioritize what to build next."}
        </p>
        <div className={styles.actions}>
          {feedbackUrl && (
            <a
              className={styles.primary}
              href={feedbackUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Give feedback
            </a>
          )}
          <button
            className={feedbackUrl ? undefined : styles.primary}
            type="button"
            onClick={onBack}
          >
            Back
          </button>
          {!feedbackUrl && startLink}
        </div>
      </div>
    </main>
  )
}
