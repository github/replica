const replyLimit = 8192
const binaryAssets =
  /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|mp4|webm|ogg|mp3|wav|zip|gz|wasm)$/i

export function createChecksSnapshot(input, pages, checkScope) {
  const scope = new Map()
  if (checkScope) {
    for (const file of checkScope.files) {
      scope.set(
        file,
        pages.filter((page) => input.pageFiles[page.id]?.includes(file)).map((page) => page.id),
      )
    }
  } else {
    for (const page of pages) {
      for (const file of new Set(input.pageFiles[page.id])) {
        const ids = scope.get(file) ?? []
        ids.push(page.id)
        scope.set(file, ids)
      }
    }
  }
  const names = [
    ...new Set(
      checkScope
        ? [
            ...scope.keys(),
            ...checkScope.contextFiles,
            ...(checkScope.instructionsFile ? [checkScope.instructionsFile] : []),
          ]
        : [...input.files.keys(), ...scope.keys()],
    ),
  ].sort()
  const visible = new Set(names)
  const metadata = new Map()
  const ranges = new Map()
  const requested = new Set()

  function info(file) {
    if (metadata.has(file)) return metadata.get(file)
    const content = input.files.get(file)
    let reason
    if (!content) reason = "missing"
    else if (content.includes(0)) reason = "binary"
    else {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(content)
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        reason = "invalid_utf8"
      }
    }
    const pageIds = scope.get(file) ?? []
    const value = {
      file,
      pageIds,
      totalBytes: content?.length ?? 0,
      required: scope.has(file) && !binaryAssets.test(file),
      reason,
    }
    metadata.set(file, value)
    return value
  }

  function receipt(file) {
    const value = info(file)
    const readBytes = (ranges.get(file) ?? []).reduce((sum, [start, end]) => sum + end - start, 0)
    const status = value.reason
      ? "blocked"
      : requested.has(file) && readBytes === value.totalBytes
        ? "read"
        : readBytes
          ? "partial"
          : "unread"
    return {
      ...value,
      readBytes,
      status,
      reason:
        value.reason ??
        (status === "partial" ? "partial_read" : status === "unread" ? "not_read" : undefined),
    }
  }

  function nextUnread(file) {
    let offset = 0
    for (const [start, end] of ranges.get(file) ?? []) {
      if (start > offset) break
      offset = end
    }
    return receipt(file).status === "read" || info(file).reason ? null : offset
  }

  function failure(message) {
    return { resultType: "failure", textResultForLlm: message }
  }

  return {
    read({ file, offset = 0 }) {
      if (typeof file !== "string" || !visible.has(file))
        return failure("File is not in this snapshot.")
      const value = info(file)
      if (value.reason) return failure(`File cannot be read as text: ${value.reason}.`)
      const content = input.files.get(file)
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > content.length ||
        (offset < content.length && (content[offset] & 0xc0) === 0x80)
      )
        return failure("Use a valid UTF-8 byte offset, preferably the returned nextOffset.")
      let end = Math.min(content.length, offset + 4096)
      let newlines = 0
      for (let index = offset; index < end; index++) {
        if (content[index] === 10 && ++newlines === 80) {
          end = index + 1
          break
        }
      }
      let reply
      while (true) {
        while (end < content.length && (content[end] & 0xc0) === 0x80) end--
        const lastNewline = end > offset ? content.lastIndexOf(10, end - 1) : -1
        if (end < content.length && lastNewline >= offset) end = lastNewline + 1
        let startLine = content.length ? 1 : 0
        for (let index = 0; index < offset; index++) if (content[index] === 10) startLine++
        const text = content.subarray(offset, end).toString("utf8")
        const lines = text ? text.split("\n") : []
        if (text.endsWith("\n")) lines.pop()
        reply = {
          file,
          totalBytes: content.length,
          offset,
          endOffset: end,
          startLine,
          endLine: lines.length ? startLine + lines.length - 1 : startLine,
          startsMidLine: offset > 0 && content[offset - 1] !== 10,
          endsMidLine: end < content.length && content[end - 1] !== 10,
          nextOffset: end < content.length ? end : null,
          content:
            lines.map((line, index) => `${startLine + index}: ${line}`).join("\n") +
            (text.endsWith("\n") ? "\n" : ""),
        }
        if (Buffer.byteLength(JSON.stringify(reply)) <= replyLimit) break
        if (end - offset <= 4)
          return failure("The file's chunk envelope exceeds the response limit.")
        end = offset + Math.floor((end - offset) / 2)
      }
      const merged = []
      for (const range of [...(ranges.get(file) ?? []), [offset, end]].sort(
        (a, b) => a[0] - b[0],
      )) {
        const last = merged.at(-1)
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
        else merged.push([...range])
      }
      ranges.set(file, merged)
      requested.add(file)
      return JSON.stringify(reply)
    },
    list({ offset = 0, limit = 25, requiredOnly = false, incompleteOnly = false } = {}) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > names.length ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        typeof requiredOnly !== "boolean" ||
        typeof incompleteOnly !== "boolean"
      )
        return failure("Use an integer offset and a limit from 1 to 50, with boolean filters.")
      const files = []
      let index = offset
      while (index < names.length && files.length < limit) {
        if (requiredOnly && !scope.has(names[index])) {
          index++
          continue
        }
        const value = receipt(names[index])
        if ((requiredOnly && !value.required) || (incompleteOnly && value.status === "read")) {
          index++
          continue
        }
        files.push({ ...value, pageIds: undefined, nextOffset: nextUnread(value.file) })
        if (
          Buffer.byteLength(JSON.stringify({ files, nextOffset: null })) +
            String(names.length).length >
          replyLimit
        ) {
          files.pop()
          if (!files.length) return failure("File metadata exceeds the response limit.")
          break
        }
        index++
      }
      return JSON.stringify({ files, nextOffset: index < names.length ? index : null })
    },
    coverage() {
      return { version: 1, files: [...scope.keys()].sort().map(receipt) }
    },
    validateCoverage(value) {
      const expected = [...scope.keys()].sort()
      if (
        !value ||
        value.version !== 1 ||
        !Array.isArray(value.files) ||
        value.files.length !== expected.length ||
        Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024
      )
        throw new Error("The check has invalid source-read coverage.")
      const remaining = new Set(expected)
      const files = value.files.map((entry) => {
        if (!entry || !remaining.delete(entry.file))
          throw new Error("Source-read coverage must identify every scoped file once.")
        const known = info(entry.file)
        const validStatus = known.reason
          ? entry.status === "blocked" && entry.readBytes === 0
          : entry.status === "read"
            ? entry.readBytes === known.totalBytes
            : entry.status === "partial"
              ? entry.readBytes > 0 && entry.readBytes < known.totalBytes
              : entry.status === "unread" && entry.readBytes === 0
        const reason =
          known.reason ??
          (entry.status === "partial"
            ? "partial_read"
            : entry.status === "unread"
              ? "not_read"
              : undefined)
        if (
          !validStatus ||
          !Number.isSafeInteger(entry.readBytes) ||
          entry.totalBytes !== known.totalBytes ||
          entry.required !== known.required ||
          JSON.stringify(entry.pageIds) !== JSON.stringify(known.pageIds) ||
          entry.reason !== reason
        )
          throw new Error("Source-read coverage does not match the captured source.")
        return { ...known, readBytes: entry.readBytes, status: entry.status, reason }
      })
      return { version: 1, files }
    },
  }
}
