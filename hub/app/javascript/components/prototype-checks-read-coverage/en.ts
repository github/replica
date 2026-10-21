export const readCoverageCopy = {
  summary: (read: number, total: number) => `Read coverage: ${read} of ${total} source files`,
  description:
    "Records source returned to the reviewer, not executed tests or proof that the code is correct.",
  missing: "Read coverage was not recorded for this run.",
  asset: "Binary asset; not required for source review.",
  bytes: (read: number, total: number) =>
    `${read.toLocaleString()} of ${total.toLocaleString()} bytes read`,
  more: (count: number) => `Show ${count} more files`,
  status: {
    read: "Fully read",
    partial: "Partially read",
    unread: "Unread",
    blocked: "Blocked",
  },
  reason: {
    missing: "Missing from the captured snapshot.",
    binary: "Cannot read binary content as source.",
    invalid_utf8: "Not valid UTF-8 text.",
    partial_read: "Only part of this file was returned.",
    not_read: "None of this file's source was returned.",
  },
}
