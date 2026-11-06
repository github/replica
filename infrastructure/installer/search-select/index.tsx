import { useState } from "react"
import { Box, Text } from "ink"
import { Select, TextInput } from "@inkjs/ui"

export function SearchSelect({
  options,
  onChange,
}: {
  options: { label: string; value: string }[]
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState("")
  const search = query.trim().toLowerCase()
  const matches = options.filter(
    ({ label, value }) =>
      label.toLowerCase().includes(search) || value.toLowerCase().includes(search),
  )
  const visibleOptionCount = 5

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text>Search:</Text>
        <TextInput placeholder="Type a name or ID" onChange={setQuery} />
      </Box>
      <Text dimColor>
        {matches.length} of {options.length} options match;{" "}
        {Math.min(matches.length, visibleOptionCount)} visible at a time.
      </Text>
      {matches.length ? (
        <Select options={matches} visibleOptionCount={visibleOptionCount} onChange={onChange} />
      ) : (
        <Text color="yellow">
          No matching options. Change your search or clear it with Backspace.
        </Text>
      )}
      <Text dimColor>Type to filter. Up/Down scrolls the list. Enter selects. Ctrl+C cancels.</Text>
    </Box>
  )
}
