/**
 * Writes Copilot's nano-AIU usage as AI credits in plain digits, so it can be stored and
 * summed as a decimal without floating-point rounding.
 */
export function formatAiCredits(nanoAiu: number) {
  const padded = nanoAiu.toString().padStart(10, "0")
  return `${padded.slice(0, -9)}.${padded.slice(-9)}`.replace(/\.?0+$/, "") || "0"
}
