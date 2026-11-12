export function FeedbackIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5a6.5 6.5 0 0 0-5.44 10.06L2 14.5l3.08-.8A6.5 6.5 0 1 0 8 1.5Z" />
      <path d="M8 11S5 9.25 5 7.5a1.5 1.5 0 0 1 3-.3 1.5 1.5 0 0 1 3 .3C11 9.25 8 11 8 11Z" />
    </svg>
  )
}
