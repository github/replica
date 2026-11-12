import { Box, Text, useInput } from "ink"

export function CloudPicker({ onSelect }: { onSelect: (cloud: "azure") => void }) {
  useInput((_input, key) => {
    if (key.return) onSelect("azure")
  })
  return (
    <Box flexDirection="column">
      <Text bold>Which cloud do you want to deploy to?</Text>
      <Text color="magenta">{"> Azure"}</Text>
      <Text dimColor>{"  AWS (Coming soon - unavailable)"}</Text>
      <Text dimColor>Press Enter to select Azure. Ctrl+C cancels.</Text>
    </Box>
  )
}
